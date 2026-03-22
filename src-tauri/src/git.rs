use std::process::Command;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct GitStatus {
    pub branch: String,
    pub is_dirty: bool,
    pub added: u32,
    pub modified: u32,
    pub deleted: u32,
    pub ahead: u32,
    pub behind: u32,
}

pub fn get_git_status(path: &str) -> Result<GitStatus, String> {
    // Get current branch
    let branch_out = Command::new("git")
        .args(["-C", path, "branch", "--show-current"])
        .output()
        .map_err(|e| e.to_string())?;

    if !branch_out.status.success() {
        return Err("Not a git repo".into());
    }

    let branch = String::from_utf8_lossy(&branch_out.stdout)
        .trim()
        .to_string();

    // Get status --porcelain
    let status_out = Command::new("git")
        .args(["-C", path, "status", "--porcelain"])
        .output()
        .map_err(|e| e.to_string())?;

    let status_str = String::from_utf8_lossy(&status_out.stdout).to_string();
    let mut added = 0u32;
    let mut modified = 0u32;
    let mut deleted = 0u32;

    for line in status_str.lines() {
        if line.len() < 2 {
            continue;
        }
        let xy = &line[..2];
        match xy.trim() {
            "A" | "??" => added += 1,
            "M" | "AM" | "MM" => modified += 1,
            "D" | "AD" => deleted += 1,
            _ => modified += 1,
        }
    }

    let is_dirty = added + modified + deleted > 0;

    // Get ahead/behind
    let (ahead, behind) = get_ahead_behind(path, &branch);

    Ok(GitStatus {
        branch,
        is_dirty,
        added,
        modified,
        deleted,
        ahead,
        behind,
    })
}

fn get_ahead_behind(path: &str, branch: &str) -> (u32, u32) {
    let out = Command::new("git")
        .args([
            "-C",
            path,
            "rev-list",
            "--left-right",
            "--count",
            &format!("origin/{}...HEAD", branch),
        ])
        .output();

    match out {
        Ok(o) if o.status.success() => {
            let s = String::from_utf8_lossy(&o.stdout);
            let parts: Vec<&str> = s.trim().split_whitespace().collect();
            if parts.len() == 2 {
                let behind = parts[0].parse().unwrap_or(0);
                let ahead = parts[1].parse().unwrap_or(0);
                (ahead, behind)
            } else {
                (0, 0)
            }
        }
        _ => (0, 0),
    }
}

pub fn get_git_diff(path: &str) -> Result<String, String> {
    let out = Command::new("git")
        .args(["-C", path, "diff", "--unified=3"])
        .output()
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct ChangedFile {
    pub path: String,
    /// Single-letter status from git status --porcelain (M, A, D, R, ?, ...)
    pub status: String,
}

pub fn get_changed_files(repo_path: &str) -> Result<Vec<ChangedFile>, String> {
    let out = Command::new("git")
        .args(["-C", repo_path, "status", "--porcelain"])
        .output()
        .map_err(|e| e.to_string())?;

    let mut files = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        if line.len() < 3 {
            continue;
        }
        let xy = line[..2].trim().to_string();
        let raw_path = line[3..].trim();
        // Renames: "old -> new"
        let path = if raw_path.contains(" -> ") {
            raw_path.split(" -> ").last().unwrap_or(raw_path).to_string()
        } else {
            raw_path.to_string()
        };
        files.push(ChangedFile { path, status: xy });
    }
    Ok(files)
}

fn base64_encode(bytes: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity((bytes.len() + 2) / 3 * 4);
    for c in bytes.chunks(3) {
        let b = [c[0], if c.len() > 1 { c[1] } else { 0 }, if c.len() > 2 { c[2] } else { 0 }];
        out.push(T[(b[0] >> 2) as usize]);
        out.push(T[((b[0] & 3) << 4 | b[1] >> 4) as usize]);
        out.push(if c.len() > 1 { T[((b[1] & 0xf) << 2 | b[2] >> 6) as usize] } else { b'=' });
        out.push(if c.len() > 2 { T[(b[2] & 0x3f) as usize] } else { b'=' });
    }
    String::from_utf8(out).unwrap()
}

fn mime_for_ext(file: &str) -> &'static str {
    match file.rsplit('.').next().unwrap_or("").to_lowercase().as_str() {
        "png"  => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif"  => "image/gif",
        "webp" => "image/webp",
        "svg"  => "image/svg+xml",
        "ico"  => "image/x-icon",
        "bmp"  => "image/bmp",
        "tiff" | "tif" => "image/tiff",
        "avif" => "image/avif",
        _      => "application/octet-stream",
    }
}

#[derive(serde::Serialize)]
pub struct ImageDiff {
    pub before: Option<String>, // data URI of HEAD version, None if new file
    pub after: Option<String>,  // data URI of current version, None if deleted
}

pub fn get_image_diff(repo_path: &str, file: &str) -> Result<ImageDiff, String> {
    let mime = mime_for_ext(file);

    // HEAD version via `git show HEAD:<path>`
    let before = Command::new("git")
        .args(["-C", repo_path, "show", &format!("HEAD:{}", file)])
        .output()
        .ok()
        .filter(|o| o.status.success() && !o.stdout.is_empty())
        .map(|o| format!("data:{};base64,{}", mime, base64_encode(&o.stdout)));

    // Current working-tree version
    let abs = std::path::Path::new(repo_path).join(file);
    let after = std::fs::read(&abs)
        .ok()
        .map(|b| format!("data:{};base64,{}", mime, base64_encode(&b)));

    Ok(ImageDiff { before, after })
}

// ── History ───────────────────────────────────────────────────────────────────

#[derive(serde::Serialize, Clone, Debug)]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
    pub is_local: bool, // true = not pushed to any remote
}

pub fn get_git_log(repo_path: &str) -> Result<Vec<CommitInfo>, String> {
    // Fetch recent commits with \x01 separator (safe against special chars in messages)
    let out = Command::new("git")
        .args([
            "-C", repo_path,
            "log", "--format=%H\x01%h\x01%an\x01%ar\x01%s",
            "-n", "300",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        return Ok(vec![]);
    }

    // Local-only commits: those that are ahead of their upstream.
    // `@{u}` is the upstream of HEAD; falls back to origin/<branch> if @{u} fails.
    let local_hashes: std::collections::HashSet<String> = {
        let try_upstream = Command::new("git")
            .args(["-C", repo_path, "log", "@{u}..HEAD", "--format=%H"])
            .output();

        let upstream_ok = try_upstream
            .as_ref()
            .map(|o| o.status.success())
            .unwrap_or(false);

        let raw = if upstream_ok {
            String::from_utf8_lossy(&try_upstream.unwrap().stdout).to_string()
        } else {
            // Fallback: try origin/<current-branch>
            let branch = Command::new("git")
                .args(["-C", repo_path, "branch", "--show-current"])
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_default();

            if branch.is_empty() {
                String::new()
            } else {
                let fb = Command::new("git")
                    .args(["-C", repo_path, "log",
                        &format!("origin/{}..HEAD", branch), "--format=%H"])
                    .output()
                    .ok()
                    .filter(|o| o.status.success())
                    .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                    .unwrap_or_default();
                fb
            }
        };

        raw.lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect()
    };

    let mut commits = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let parts: Vec<&str> = line.splitn(5, '\x01').collect();
        if parts.len() < 5 {
            continue;
        }
        let hash = parts[0].trim().to_string();
        let is_local = local_hashes.contains(&hash);
        commits.push(CommitInfo {
            is_local,
            hash,
            short_hash: parts[1].trim().to_string(),
            author: parts[2].trim().to_string(),
            date: parts[3].trim().to_string(),
            message: parts[4].trim().to_string(),
        });
    }
    Ok(commits)
}

pub fn get_commit_files(repo_path: &str, hash: &str) -> Result<Vec<ChangedFile>, String> {
    let out = Command::new("git")
        .args([
            "-C", repo_path,
            "diff-tree", "--no-commit-id", "-r", "--name-status", hash,
        ])
        .output()
        .map_err(|e| e.to_string())?;

    let mut files = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        // Format: "<STATUS>\t<path>"  or  "R<score>\t<old>\t<new>"
        let mut cols = line.splitn(3, '\t');
        let status_raw = cols.next().unwrap_or("");
        let status = status_raw.chars().next().unwrap_or('M').to_string();
        let path1 = cols.next().unwrap_or("").to_string();
        let path = cols.next().unwrap_or(&path1).trim().to_string();
        let path = if path.is_empty() { path1 } else { path };
        if path.is_empty() {
            continue;
        }
        files.push(ChangedFile { path, status });
    }
    Ok(files)
}

pub fn get_commit_file_diff(repo_path: &str, hash: &str, file: &str) -> Result<String, String> {
    // `git show` works for all commits including the very first one.
    // --format="" suppresses the commit header so output starts at the diff.
    let out = Command::new("git")
        .args([
            "-C", repo_path,
            "show", "--format=", "--unified=4", hash, "--", file,
        ])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

pub fn get_commit_image_diff(repo_path: &str, hash: &str, file: &str) -> Result<ImageDiff, String> {
    let mime = mime_for_ext(file);

    // Parent version (before this commit). Fails gracefully for initial commit.
    let before = Command::new("git")
        .args(["-C", repo_path, "show", &format!("{}^:{}", hash, file)])
        .output()
        .ok()
        .filter(|o| o.status.success() && !o.stdout.is_empty())
        .map(|o| format!("data:{};base64,{}", mime, base64_encode(&o.stdout)));

    // This commit's version (after).
    let after = Command::new("git")
        .args(["-C", repo_path, "show", &format!("{}:{}", hash, file)])
        .output()
        .ok()
        .filter(|o| o.status.success() && !o.stdout.is_empty())
        .map(|o| format!("data:{};base64,{}", mime, base64_encode(&o.stdout)));

    Ok(ImageDiff { before, after })
}

/// Returns the main worktree path if `path` is inside a linked worktree, or None otherwise.
pub fn get_worktree_main_path(path: &str) -> Option<String> {
    let out = Command::new("git")
        .args(["-C", path, "worktree", "list", "--porcelain"])
        .output()
        .ok()?;

    if !out.status.success() {
        return None;
    }

    let output = String::from_utf8_lossy(&out.stdout);
    let worktrees: Vec<String> = output
        .lines()
        .filter_map(|l| l.strip_prefix("worktree ").map(|p| p.trim().to_string()))
        .collect();

    // Need a main + at least one linked worktree
    if worktrees.len() < 2 {
        return None;
    }

    let main = worktrees[0].clone();
    let canonical_path = std::fs::canonicalize(path).ok()?;

    for linked in &worktrees[1..] {
        let canonical_linked = std::fs::canonicalize(linked).ok()?;
        if canonical_path.starts_with(&canonical_linked) {
            return Some(main);
        }
    }

    None
}

// ── Staging / commit ──────────────────────────────────────────────────────────

#[derive(serde::Serialize, Clone, Debug)]
pub struct WorkdirStatus {
    pub staged: Vec<ChangedFile>,
    pub unstaged: Vec<ChangedFile>,
}

// ── Branch management ─────────────────────────────────────────────────────────

#[derive(serde::Serialize, Clone, Debug)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
}

pub fn get_branches(repo_path: &str) -> Result<Vec<BranchInfo>, String> {
    let out = Command::new("git")
        .args(["-C", repo_path, "branch"])
        .output()
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        return Ok(vec![]);
    }

    let branches = String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|line| {
            let is_current = line.starts_with("* ");
            let name = line
                .trim_start_matches("* ")
                .trim_start_matches("  ")
                .trim()
                .to_string();
            if name.is_empty() { None } else { Some(BranchInfo { name, is_current }) }
        })
        .collect();

    Ok(branches)
}

pub fn switch_branch(repo_path: &str, branch: &str) -> Result<(), String> {
    let out = Command::new("git")
        .args(["-C", repo_path, "switch", branch])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}

pub fn create_branch(repo_path: &str, branch: &str) -> Result<(), String> {
    let out = Command::new("git")
        .args(["-C", repo_path, "switch", "-c", branch])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}

pub fn get_workdir_status(repo_path: &str) -> Result<WorkdirStatus, String> {
    let out = Command::new("git")
        .args(["-C", repo_path, "status", "--porcelain"])
        .output()
        .map_err(|e| e.to_string())?;

    let mut staged: Vec<ChangedFile> = Vec::new();
    let mut unstaged: Vec<ChangedFile> = Vec::new();

    for line in String::from_utf8_lossy(&out.stdout).lines() {
        if line.len() < 3 {
            continue;
        }
        let x = line.chars().nth(0).unwrap_or(' ');
        let y = line.chars().nth(1).unwrap_or(' ');
        let raw = line[3..].trim();
        let path = if raw.contains(" -> ") {
            raw.split(" -> ").last().unwrap_or(raw).to_string()
        } else {
            raw.to_string()
        };

        // Staged: index column is not space/untracked
        if x != ' ' && x != '?' {
            staged.push(ChangedFile { path: path.clone(), status: x.to_string() });
        }

        // Unstaged: worktree column is not space, or untracked (??)
        if y != ' ' {
            let status = if x == '?' && y == '?' { "??".to_string() } else { y.to_string() };
            unstaged.push(ChangedFile { path, status });
        }
    }

    Ok(WorkdirStatus { staged, unstaged })
}

pub fn get_staged_file_diff(repo_path: &str, file: &str) -> Result<String, String> {
    let out = Command::new("git")
        .args(["-C", repo_path, "diff", "--cached", "--unified=4", "--", file])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

pub fn stage_file(repo_path: &str, file: &str) -> Result<(), String> {
    let out = Command::new("git")
        .args(["-C", repo_path, "add", "--", file])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).to_string()) }
}

pub fn unstage_file(repo_path: &str, file: &str) -> Result<(), String> {
    let out = Command::new("git")
        .args(["-C", repo_path, "restore", "--staged", "--", file])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).to_string()) }
}

pub fn discard_file(repo_path: &str, file: &str) -> Result<(), String> {
    let out = Command::new("git")
        .args(["-C", repo_path, "restore", "--", file])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).to_string()) }
}

pub fn stage_all(repo_path: &str) -> Result<(), String> {
    let out = Command::new("git")
        .args(["-C", repo_path, "add", "-A"])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).to_string()) }
}

pub fn git_commit(repo_path: &str, message: &str) -> Result<(), String> {
    let out = Command::new("git")
        .args(["-C", repo_path, "commit", "-m", message])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).to_string()) }
}

pub fn get_file_diff(repo_path: &str, file: &str) -> Result<String, String> {
    // diff vs HEAD includes both staged and unstaged changes against the last commit
    let out = Command::new("git")
        .args(["-C", repo_path, "diff", "HEAD", "--unified=4", "--", file])
        .output()
        .map_err(|e| e.to_string())?;

    let result = String::from_utf8_lossy(&out.stdout).to_string();
    if !result.is_empty() {
        return Ok(result);
    }

    // Fallback for newly staged files (added but no prior commit, or after git add)
    let staged = Command::new("git")
        .args(["-C", repo_path, "diff", "--cached", "--unified=4", "--", file])
        .output()
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&staged.stdout).to_string())
}
