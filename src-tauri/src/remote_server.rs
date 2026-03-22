// src-tauri/src/remote_server.rs
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct RemoteServer {
    child: Option<Child>,
    stdin: Option<Arc<Mutex<ChildStdin>>>,
    pub port: u16,
    pub token: String,
}

impl Drop for RemoteServer {
    fn drop(&mut self) {
        if let Some(mut c) = self.child.take() { let _ = c.kill(); }
    }
}

#[derive(Serialize, Clone)]
pub struct ServerInfo {
    pub port: u16,
    pub token: String,
    pub local_ip: String,
    pub tailscale_ip: Option<String>,
}

#[derive(Serialize)]
pub struct ServerStatus {
    pub running: bool,
    pub port: u16,
    pub token: String,
    pub local_ip: String,
    pub tailscale_ip: Option<String>,
}

fn find_node() -> Option<String> {
    if let Ok(p) = std::env::var("VIBETERM_NODE_PATH") {
        if std::path::Path::new(&p).exists() { return Some(p); }
    }
    for c in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] {
        if std::path::Path::new(c).exists() { return Some(c.to_string()); }
    }
    Command::new("which").arg("node").output().ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn find_server_script(app: &AppHandle) -> Result<String, String> {
    #[cfg(debug_assertions)]
    {
        let manifest = env!("CARGO_MANIFEST_DIR");
        let p = std::path::Path::new(manifest)
            .parent().unwrap_or(std::path::Path::new("."))
            .join("server/dist/index.js");
        return Ok(p.to_string_lossy().to_string());
    }
    #[cfg(not(debug_assertions))]
    {
        use tauri::Manager;
        let dir = app.path().resource_dir().map_err(|e| e.to_string())?;
        Ok(dir.join("server/dist/index.js").to_string_lossy().to_string())
    }
}

fn detect_local_ip() -> String {
    use std::net::UdpSocket;
    UdpSocket::bind("0.0.0.0:0").ok()
        .and_then(|s| { s.connect("8.8.8.8:80").ok()?; s.local_addr().ok() })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

fn detect_tailscale_ip() -> Option<String> {
    Command::new("tailscale").args(["ip", "-4"]).output().ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s.starts_with("100."))
}

fn gen_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

#[tauri::command]
pub async fn start_remote_server(
    state: tauri::State<'_, Arc<Mutex<RemoteServer>>>,
    app: AppHandle,
    allowed_paths: Vec<String>,
) -> Result<ServerInfo, String> {
    let mut srv = state.lock().map_err(|e| e.to_string())?;
    // Kill any existing server before starting a new one
    if let Some(mut c) = srv.child.take() { let _ = c.kill(); }
    srv.stdin = None;
    srv.port = 0;
    srv.token.clear();

    let node = find_node().ok_or(
        "Node.js not found. Install from nodejs.org or via Homebrew: brew install node"
    )?;
    let script = find_server_script(&app)?;
    let token = gen_token();
    let paths_json = serde_json::to_string(&allowed_paths).unwrap_or_else(|_| "[]".to_string());

    let mut child = Command::new(&node)
        .arg(&script)
        .args(["--port", "0", "--token", &token, "--allowed-paths", &paths_json])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|e| format!("Failed to start server: {e}"))?;

    let stdin = Arc::new(Mutex::new(child.stdin.take().ok_or("Failed to get stdin")?));
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;

    let (tx, rx) = std::sync::mpsc::channel::<String>();
    thread::spawn(move || {
        // Drain stdout fully to prevent the child process blocking on a full pipe buffer.
        // The first line is the startup JSON signal; subsequent lines are discarded.
        for line in BufReader::new(stdout).lines().flatten() {
            let _ = tx.send(line);
        }
    });

    let first = rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "Server did not start within 5 seconds".to_string())?;

    #[derive(Deserialize)]
    struct Startup { status: String, #[serde(default)] port: u16, #[serde(default)] message: String }
    let msg: Startup = serde_json::from_str(&first)
        .map_err(|_| format!("Unexpected output: {first}"))?;
    if msg.status == "error" { let _ = child.kill(); return Err(msg.message); }
    let actual_port = msg.port;

    // Spawn background watcher: emits "remote-server-died" if the process exits unexpectedly
    let state_arc: Arc<Mutex<RemoteServer>> = Arc::clone(&*state);
    let app_handle = app.clone();
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(2));
            let mut srv = state_arc.lock().unwrap_or_else(|e| e.into_inner());
            match srv.child.as_mut().map(|c| c.try_wait()) {
                Some(Ok(Some(_))) | Some(Err(_)) => {
                    // Process has exited
                    srv.child = None;
                    srv.stdin = None;
                    srv.port = 0;
                    srv.token.clear();
                    drop(srv);
                    let _ = app_handle.emit("remote-server-died", ());
                    break;
                }
                None => break, // server was stopped intentionally
                _ => {} // still running
            }
        }
    });

    srv.child = Some(child);
    srv.stdin = Some(stdin);
    srv.port = actual_port;
    srv.token = token.clone();

    Ok(ServerInfo { port: actual_port, token, local_ip: detect_local_ip(), tailscale_ip: detect_tailscale_ip() })
}

#[tauri::command]
pub fn stop_remote_server(
    state: tauri::State<'_, Arc<Mutex<RemoteServer>>>,
) -> Result<(), String> {
    let mut srv = state.lock().map_err(|e| e.to_string())?;
    if let Some(mut c) = srv.child.take() { let _ = c.kill(); }
    srv.stdin = None;
    srv.port = 0;
    srv.token.clear();
    Ok(())
}

#[tauri::command]
pub fn get_remote_server_status(
    state: tauri::State<'_, Arc<Mutex<RemoteServer>>>,
) -> Result<ServerStatus, String> {
    let mut srv = state.lock().map_err(|e| e.to_string())?;
    let running = srv.child.as_mut().map(|c| matches!(c.try_wait(), Ok(None))).unwrap_or(false);
    if !running { srv.child = None; srv.stdin = None; }
    Ok(ServerStatus { running, port: srv.port, token: srv.token.clone(),
        local_ip: detect_local_ip(), tailscale_ip: detect_tailscale_ip() })
}

#[tauri::command]
pub fn regenerate_remote_token(
    state: tauri::State<'_, Arc<Mutex<RemoteServer>>>,
) -> Result<String, String> {
    let mut srv = state.lock().map_err(|e| e.to_string())?;
    let new_token = gen_token();
    if let Some(stdin) = srv.stdin.as_ref() {
        let msg = format!("{{\"type\":\"rotate-token\",\"token\":\"{}\"}}\n", new_token);
        stdin.lock().map_err(|e| e.to_string())?
            .write_all(msg.as_bytes()).map_err(|e| e.to_string())?;
    }
    srv.token = new_token.clone();
    Ok(new_token)
}

#[tauri::command]
pub fn add_remote_allowed_path(
    state: tauri::State<'_, Arc<Mutex<RemoteServer>>>,
    path: String,
) -> Result<(), String> {
    let srv = state.lock().map_err(|e| e.to_string())?;
    if let Some(stdin) = srv.stdin.as_ref() {
        let escaped = path.replace('"', "\\\"");
        let msg = format!("{{\"type\":\"add-path\",\"path\":\"{escaped}\"}}\n");
        stdin.lock().map_err(|e| e.to_string())?
            .write_all(msg.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}
