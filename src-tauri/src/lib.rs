mod git;
mod pty;
mod remote_server;

use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

// ── PTY commands ─────────────────────────────────────────────────────────────

#[tauri::command]
fn create_session(
    app: AppHandle,
    tab_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty::create_session(app, tab_id, cwd, cols, rows)
}

#[tauri::command]
fn write_input(tab_id: String, data: String) -> Result<(), String> {
    pty::write_input(&tab_id, &data)
}

#[tauri::command]
fn resize_session(tab_id: String, cols: u16, rows: u16) -> Result<(), String> {
    pty::resize_session(&tab_id, cols, rows)
}

#[tauri::command]
fn kill_session(tab_id: String) {
    pty::kill_session(&tab_id)
}

// ── Git commands ──────────────────────────────────────────────────────────────

#[tauri::command]
fn get_git_status(path: String) -> Result<git::GitStatus, String> {
    git::get_git_status(&path)
}

#[tauri::command]
fn get_git_diff(path: String) -> Result<String, String> {
    git::get_git_diff(&path)
}

#[tauri::command]
fn get_changed_files(path: String) -> Result<Vec<git::ChangedFile>, String> {
    git::get_changed_files(&path)
}

#[tauri::command]
fn get_file_diff(path: String, file: String) -> Result<String, String> {
    git::get_file_diff(&path, &file)
}

#[tauri::command]
fn get_image_diff(path: String, file: String) -> Result<git::ImageDiff, String> {
    git::get_image_diff(&path, &file)
}

#[tauri::command]
fn get_git_log(path: String) -> Result<Vec<git::CommitInfo>, String> {
    git::get_git_log(&path)
}

#[tauri::command]
fn get_commit_files(path: String, hash: String) -> Result<Vec<git::ChangedFile>, String> {
    git::get_commit_files(&path, &hash)
}

#[tauri::command]
fn get_commit_file_diff(path: String, hash: String, file: String) -> Result<String, String> {
    git::get_commit_file_diff(&path, &hash, &file)
}

#[tauri::command]
fn get_commit_image_diff(path: String, hash: String, file: String) -> Result<git::ImageDiff, String> {
    git::get_commit_image_diff(&path, &hash, &file)
}

#[tauri::command]
fn get_workdir_status(path: String) -> Result<git::WorkdirStatus, String> {
    git::get_workdir_status(&path)
}

#[tauri::command]
fn get_staged_file_diff(path: String, file: String) -> Result<String, String> {
    git::get_staged_file_diff(&path, &file)
}

#[tauri::command]
fn stage_file(path: String, file: String) -> Result<(), String> {
    git::stage_file(&path, &file)
}

#[tauri::command]
fn unstage_file(path: String, file: String) -> Result<(), String> {
    git::unstage_file(&path, &file)
}

#[tauri::command]
fn discard_file(path: String, file: String) -> Result<(), String> {
    git::discard_file(&path, &file)
}

#[tauri::command]
fn stage_all(path: String) -> Result<(), String> {
    git::stage_all(&path)
}

#[tauri::command]
fn git_commit(path: String, message: String) -> Result<(), String> {
    git::git_commit(&path, &message)
}

#[tauri::command]
fn get_branches(path: String) -> Result<Vec<git::BranchInfo>, String> {
    git::get_branches(&path)
}

#[tauri::command]
fn switch_branch(path: String, branch: String) -> Result<(), String> {
    git::switch_branch(&path, &branch)
}

#[tauri::command]
fn create_branch(path: String, branch: String) -> Result<(), String> {
    git::create_branch(&path, &branch)
}

#[tauri::command]
fn open_url(url: String) {
    let _ = std::process::Command::new("open").arg(&url).spawn();
}

#[tauri::command]
fn get_worktree_main(path: String) -> Result<Option<String>, String> {
    git::get_worktree_main(&path)
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let icon: tauri::image::Image<'_> = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128@2x.png"))
                .expect("failed to load app icon");
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(icon).ok();
            }
            app.manage(Arc::new(Mutex::new(remote_server::RemoteServer::default())));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_session,
            write_input,
            resize_session,
            kill_session,
            get_git_status,
            get_git_diff,
            get_changed_files,
            get_file_diff,
            get_image_diff,
            get_git_log,
            get_commit_files,
            get_commit_file_diff,
            get_commit_image_diff,
            get_workdir_status,
            get_staged_file_diff,
            stage_file,
            unstage_file,
            discard_file,
            stage_all,
            git_commit,
            get_branches,
            switch_branch,
            create_branch,
            open_url,
            get_worktree_main,
            remote_server::start_remote_server,
            remote_server::stop_remote_server,
            remote_server::get_remote_server_status,
            remote_server::regenerate_remote_token,
            remote_server::add_remote_allowed_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running vibeterm");
}
