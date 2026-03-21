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
