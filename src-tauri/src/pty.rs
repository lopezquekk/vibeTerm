use once_cell::sync::Lazy;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{mpsc, Mutex},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter};

pub struct PtySession {
    pub writer: Box<dyn Write + Send>,
    pub master: Box<dyn portable_pty::MasterPty + Send>,
}

static SESSIONS: Lazy<Mutex<HashMap<String, PtySession>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Expand leading `~` to the user's home directory.
fn expand_home(path: &str) -> String {
    if path == "~" || path.starts_with("~/") {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        path.replacen('~', &home, 1)
    } else {
        path.to_string()
    }
}

pub fn create_session(
    app: AppHandle,
    tab_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    // Kill any existing session with this id before creating a new one.
    // Guards against double-mount scenarios (e.g. React dev double-effect).
    kill_session(&tab_id);

    let cwd = expand_home(&cwd);

    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {e}"))?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&cwd);
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
    }
    // Override terminal capabilities so TUI apps (claude, vim, htop…) work correctly.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    // Identify ourselves so apps like Claude CLI can adapt their rendering.
    cmd.env("TERM_PROGRAM", "vibeTerm");
    // Ensure UTF-8 locale is set — needed for correct wide-char/emoji width calculation.
    // Only override if not already set by the user's environment.
    if std::env::var("LANG").is_err() {
        cmd.env("LANG", "en_US.UTF-8");
    }
    if std::env::var("LC_ALL").is_err() {
        cmd.env("LC_CTYPE", "en_US.UTF-8");
    }

    // Spawn shell on slave side — must happen before taking reader/writer
    let _child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn failed: {e}"))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone_reader failed: {e}"))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer failed: {e}"))?;

    let tab_id_reader = tab_id.clone();

    // Reader thread: stream PTY output → frontend via Tauri event.
    //
    // Design: an inner thread does the blocking read() and forwards raw chunks
    // over an mpsc channel. The outer loop uses recv_timeout(10ms) so the
    // accumulator is always flushed within 10ms of the last byte arriving —
    // even when the PTY goes idle (e.g. shell prompt, Claude waiting for input).
    //
    // Without the timeout, a plain blocking read() only checks elapsed time
    // when new data arrives, so the last chunk of a burst (clear, TUI redraw)
    // would stay buffered forever until the next keystroke.
    thread::spawn(move || {
        const BATCH_INTERVAL: Duration = Duration::from_millis(10);
        const MAX_ACCUM: usize = 65536; // also flush early if > 64 KB accumulated

        let mut seen_urls = std::collections::HashSet::<String>::new();
        let mut accum: Vec<u8> = Vec::with_capacity(65536);

        let (tx, rx) = mpsc::channel::<Option<Vec<u8>>>();

        // Inner thread: blocking reads, sends raw chunks (None = EOF/error)
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => { tx.send(None).ok(); break; }
                    Ok(n) => {
                        if tx.send(Some(buf[..n].to_vec())).is_err() { break; }
                    }
                }
            }
        });

        let emit = |data: &[u8]| {
            let s = String::from_utf8_lossy(data).to_string();
            let _ = app.emit(&format!("pty-output-{}", tab_id_reader), s);
        };

        loop {
            match rx.recv_timeout(BATCH_INTERVAL) {
                Ok(Some(chunk)) => {
                    // Side-channel parsing runs per-chunk so OSC7/URL events fire promptly.
                    let chunk_str = String::from_utf8_lossy(&chunk);
                    if let Some(path) = extract_osc7_path(&chunk_str) {
                        let _ = app.emit(&format!("cwd-changed-{}", tab_id_reader), path);
                    }
                    if let Some(url) = extract_local_url(&chunk_str) {
                        if seen_urls.insert(url.clone()) {
                            let _ = app.emit(&format!("port-detected-{}", tab_id_reader), url);
                        }
                    }
                    accum.extend_from_slice(&chunk);
                    if accum.len() >= MAX_ACCUM {
                        emit(&accum);
                        accum.clear();
                    }
                }
                Ok(None) => {
                    // EOF: flush remaining data and exit
                    if !accum.is_empty() { emit(&accum); }
                    break;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // 10 ms with no new data → flush so the screen updates promptly
                    if !accum.is_empty() {
                        emit(&accum);
                        accum.clear();
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    let session = PtySession {
        writer,
        master: pair.master,
    };

    SESSIONS
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?
        .insert(tab_id, session);

    Ok(())
}

pub fn write_input(tab_id: &str, data: &str) -> Result<(), String> {
    let mut sessions = SESSIONS
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;

    let session = sessions
        .get_mut(tab_id)
        .ok_or_else(|| format!("no session for tab {tab_id}"))?;

    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())
}

pub fn resize_session(tab_id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = SESSIONS
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;

    if let Some(session) = sessions.get(tab_id) {
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Extract the filesystem path from an OSC 7 escape sequence if present.
/// Format: ESC ] 7 ; file://hostname/path BEL  or  ESC ] 7 ; file://hostname/path ESC \
fn extract_osc7_path(data: &str) -> Option<String> {
    let marker = "\x1b]7;";
    let start = data.find(marker)?;
    let rest = &data[start + marker.len()..];
    let end = rest
        .find('\x07')
        .or_else(|| rest.find("\x1b\\"))
        .unwrap_or(rest.len());
    let raw = &rest[..end];
    if let Some(without_scheme) = raw.strip_prefix("file://") {
        // Strip hostname (everything before the first '/')
        if let Some(slash) = without_scheme.find('/') {
            return Some(without_scheme[slash..].to_string());
        }
    }
    None
}

/// Extract a local server URL from terminal output.
/// Matches http(s)://localhost:PORT and http(s)://127.0.0.1:PORT patterns
/// emitted by common dev servers (Vite, Next.js, CRA, Express, Django, etc.).
fn extract_local_url(data: &str) -> Option<String> {
    let prefixes: &[&str] = &[
        "http://localhost:",
        "https://localhost:",
        "http://127.0.0.1:",
        "https://127.0.0.1:",
        "http://0.0.0.0:",
        "https://0.0.0.0:",
    ];

    for prefix in prefixes {
        if let Some(pos) = data.find(prefix) {
            let rest = &data[pos..];
            // URL ends at whitespace, control chars, or common delimiters
            let end = rest
                .find(|c: char| c.is_whitespace() || c == '\x1b' || c == '\x07' || c == '"' || c == '\'' || c == ')')
                .unwrap_or(rest.len());
            let raw = rest[..end].trim_end_matches(|c| c == '/' || c == '.');
            // Validate there's a port digit after the prefix
            if raw.len() <= prefix.len() {
                continue;
            }
            // Normalize 0.0.0.0 → localhost
            let url = raw
                .replace("//0.0.0.0:", "//localhost:")
                .replace("//127.0.0.1:", "//localhost:");
            return Some(url);
        }
    }
    None
}

pub fn kill_session(tab_id: &str) {
    if let Ok(mut sessions) = SESSIONS.lock() {
        sessions.remove(tab_id);
    }
}
