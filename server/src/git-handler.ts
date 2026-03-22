import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import os from "os";

const MAX_BYTES = 1_048_576; // 1 MB
const GIT = "git";

// ── Path safety ───────────────────────────────────────────────────────────────

export function isPathAllowed(targetPath: string, allowedRoots: string[]): boolean {
  const normalized = path.resolve(targetPath);
  return allowedRoots.some((root) => {
    const r = path.resolve(root);
    return normalized === r || normalized.startsWith(r + path.sep);
  });
}

export function truncateOutput(content: string): { content: string; truncated: boolean } {
  if (Buffer.byteLength(content) <= MAX_BYTES) return { content, truncated: false };
  return { content: content.slice(0, MAX_BYTES), truncated: true };
}

// ── Subprocess helper — NO shell, args are an array ──────────────────────────

function run(args: string[], cwd: string): string {
  try {
    return execFileSync(GIT, args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * MAX_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e: any) {
    return (e.stdout as string | undefined) ?? "";
  }
}

// ── Git operations ────────────────────────────────────────────────────────────

export function getGitStatus(repoPath: string) {
  const branch = run(["rev-parse", "--abbrev-ref", "HEAD"], repoPath).trim();
  const porcelain = run(["status", "--porcelain"], repoPath);
  const lines = porcelain.trim().split("\n").filter(Boolean);
  const isDirty = lines.length > 0;
  const added = lines.filter((l) => l[0] === "A" || l.slice(0, 2) === "??").length;
  const modified = lines.filter((l) => l[0] === "M" || l[1] === "M").length;
  const deleted = lines.filter((l) => l[0] === "D" || l[1] === "D").length;
  const aheadRaw = run(["rev-list", "--count", "@{u}..HEAD"], repoPath).trim();
  const behindRaw = run(["rev-list", "--count", "HEAD..@{u}"], repoPath).trim();
  return {
    branch,
    isDirty,
    added,
    modified,
    deleted,
    ahead: parseInt(aheadRaw) || 0,
    behind: parseInt(behindRaw) || 0,
  };
}

export function getChangedFiles(repoPath: string) {
  const out = run(["status", "--porcelain", "-u"], repoPath);
  return out.trim().split("\n").filter(Boolean).map((line) => ({
    status: line.slice(0, 2).trim(),
    path: line.slice(3),
  }));
}

export function getFileDiff(repoPath: string, file: string) {
  return truncateOutput(run(["diff", "--", file], repoPath));
}

export function getStagedFileDiff(repoPath: string, file: string) {
  return truncateOutput(run(["diff", "--cached", "--", file], repoPath));
}

export function getImageDiff(repoPath: string, file: string) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const readBlob = (rev: string): string | null => {
    try {
      return execFileSync(GIT, ["show", `${rev}:${file}`], { cwd: repoPath }).toString("base64");
    } catch { return null; }
  };
  const after = (() => {
    try { return readFileSync(path.join(repoPath, file)).toString("base64"); } catch { return null; }
  })();
  return { before: readBlob("HEAD"), after, ext };
}

export function getWorkdirStatus(repoPath: string) {
  const out = run(["status", "--porcelain"], repoPath);
  const lines = out.trim().split("\n").filter(Boolean);
  const staged: { path: string; status: string }[] = [];
  const unstaged: { path: string; status: string }[] = [];
  for (const line of lines) {
    const x = line[0], y = line[1], p = line.slice(3);
    if (x !== " " && x !== "?") staged.push({ path: p, status: x });
    if (y !== " ") unstaged.push({ path: p, status: y === "?" ? "?" : y });
  }
  return { staged, unstaged };
}

export function getGitLog(repoPath: string) {
  const sep = "\x00";
  const out = run(
    ["log", "--format=%H%x00%h%x00%an%x00%ai%x00%s", "-100"],
    repoPath
  );
  const pushedOut = run(["log", "--format=%H", "@{u}..HEAD"], repoPath);
  const localHashes = new Set(pushedOut.trim().split("\n").filter(Boolean));
  return out.trim().split("\n").filter(Boolean).map((line) => {
    const [hash, short_hash, author, date, ...msgParts] = line.split(sep);
    return { hash, short_hash, author, date, message: msgParts.join(sep), is_local: localHashes.has(hash) };
  });
}

export function getCommitFiles(repoPath: string, hash: string) {
  const out = run(["diff-tree", "--no-commit-id", "-r", "--name-status", hash], repoPath);
  return out.trim().split("\n").filter(Boolean).map((line) => {
    const [status, ...parts] = line.split("\t");
    return { status: status.trim(), path: parts.join("\t") };
  });
}

export function getCommitFileDiff(repoPath: string, hash: string, file: string) {
  return truncateOutput(run(["show", hash, "--", file], repoPath));
}

export function getCommitImageDiff(repoPath: string, hash: string, file: string) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const readBlob = (rev: string): string | null => {
    try { return execFileSync(GIT, ["show", `${rev}:${file}`], { cwd: repoPath }).toString("base64"); }
    catch { return null; }
  };
  return { before: readBlob(`${hash}~1`), after: readBlob(hash), ext };
}

export function getBranches(repoPath: string) {
  const out = run(["branch", "--format=%(refname:short)|%(HEAD)"], repoPath);
  return out.trim().split("\n").filter(Boolean).map((line) => {
    const [name, head] = line.split("|");
    return { name: name.trim(), is_current: head === "*" };
  });
}

export function stageFile(repoPath: string, file: string): void {
  run(["add", "--", file], repoPath);
}

export function unstageFile(repoPath: string, file: string): void {
  run(["reset", "HEAD", "--", file], repoPath);
}

export function discardFile(repoPath: string, file: string): void {
  run(["checkout", "--", file], repoPath);
}

export function stageAll(repoPath: string): void {
  run(["add", "-A"], repoPath);
}

export function gitCommit(repoPath: string, message: string): void {
  execFileSync(GIT, ["commit", "-m", message], { cwd: repoPath, stdio: "pipe" });
}

export function switchBranch(repoPath: string, branch: string): void {
  run(["checkout", branch], repoPath);
}

export function createBranch(repoPath: string, branch: string): void {
  run(["checkout", "-b", branch], repoPath);
}

export function getWorktreeMain(repoPath: string): string | null {
  try {
    const out = run(["worktree", "list", "--porcelain"], repoPath);
    const blocks = out.trim().split("\n\n").filter(Boolean);
    const main = blocks[0];
    const pathLine = main?.split("\n").find((l) => l.startsWith("worktree "));
    const mainPath = pathLine?.slice(9).trim();
    if (mainPath && path.resolve(mainPath) !== path.resolve(repoPath)) return mainPath;
    return null;
  } catch { return null; }
}
