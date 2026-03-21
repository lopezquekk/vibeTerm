use once_cell::sync::Lazy;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::Mutex,
    thread,
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

    // Reader thread: stream PTY output → frontend via Tauri event
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let event = format!("pty-output-{}", tab_id_reader);
                    let _ = app.emit(&event, data);
                }
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

pub fn kill_session(tab_id: &str) {
    if let Ok(mut sessions) = SESSIONS.lock() {
        sessions.remove(tab_id);
    }
}
