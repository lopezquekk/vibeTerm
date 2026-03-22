mod git;
mod pty;

use tauri::AppHandle;

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

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running vibeterm");
}
