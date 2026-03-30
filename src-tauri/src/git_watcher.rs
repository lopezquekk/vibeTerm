// src-tauri/src/git_watcher.rs
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

struct WatchedRepo {
    _watcher: RecommendedWatcher, // kept alive by owning this struct
    tab_ids: Arc<Mutex<Vec<String>>>,
}

static WATCHERS: Lazy<Mutex<HashMap<String, WatchedRepo>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Walk up from `path` until we find a directory containing `.git`.
fn find_git_root(path: &str) -> Option<PathBuf> {
    let mut current = PathBuf::from(path);
    loop {
        if current.join(".git").exists() {
            return Some(current);
        }
        if !current.pop() {
            return None;
        }
    }
}

/// Returns true for events that mean the working tree or index changed.
fn is_relevant(event: &Event) -> bool {
    match event.kind {
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {
            event.paths.iter().any(|p| {
                let s = p.to_string_lossy();
                s.contains("HEAD")
                    || s.contains("/index")
                    || s.contains("/refs/")
                    || s.contains("COMMIT_EDITMSG")
            })
        }
        _ => false,
    }
}

#[tauri::command]
pub fn watch_git_dir(tab_id: String, path: String, app: AppHandle) -> Result<(), String> {
    let repo_root = match find_git_root(&path) {
        Some(r) => r,
        None => {
            // Not a git repo — signal frontend to fall back to polling
            let _ = app.emit("git-watch-failed", &path);
            return Ok(());
        }
    };
    let repo_key = repo_root.to_string_lossy().to_string();

    let mut watchers = WATCHERS.lock().map_err(|e| format!("lock poisoned: {e}"))?;

    // If already watching this repo, just register the additional tab
    if let Some(watched) = watchers.get_mut(&repo_key) {
        if let Ok(mut ids) = watched.tab_ids.lock() {
            if !ids.contains(&tab_id) {
                ids.push(tab_id);
            }
        }
        return Ok(());
    }

    let app_clone = app.clone();
    let tab_ids_arc: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
    let tab_ids_clone = Arc::clone(&tab_ids_arc);

    let handler = move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            if is_relevant(&event) {
                if let Ok(ids) = tab_ids_clone.lock() {
                    for tab_id in ids.iter() {
                        let _ = app_clone.emit(&format!("git-changed-{tab_id}"), ());
                    }
                }
            }
        }
    };

    let mut watcher = match RecommendedWatcher::new(handler, Config::default()) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("git_watcher: failed to create watcher: {e}");
            let _ = app.emit("git-watch-failed", &repo_key);
            return Ok(());
        }
    };

    let git_dir = repo_root.join(".git");
    if let Err(e) = watcher.watch(Path::new(&git_dir), RecursiveMode::Recursive) {
        eprintln!("git_watcher: failed to watch {git_dir:?}: {e}");
        let _ = app.emit("git-watch-failed", &repo_key);
        return Ok(());
    }

    tab_ids_arc.lock().unwrap().push(tab_id);

    watchers.insert(
        repo_key,
        WatchedRepo {
            _watcher: watcher,
            tab_ids: tab_ids_arc,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn unwatch_git_dir(tab_id: String) -> Result<(), String> {
    let mut watchers = WATCHERS.lock().map_err(|e| format!("lock poisoned: {e}"))?;
    // Remove the tab_id from every repo; drop repos with no remaining tabs
    watchers.retain(|_, watched| {
        if let Ok(mut ids) = watched.tab_ids.lock() {
            ids.retain(|id| id != &tab_id);
            !ids.is_empty()
        } else {
            true // keep on lock failure to avoid accidentally dropping a watcher
        }
    });
    Ok(())
}
