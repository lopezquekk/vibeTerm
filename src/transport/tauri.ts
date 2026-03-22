// src/transport/tauri.ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  Transport, GitStatus, ChangedFile, WorkdirStatus,
  ImageDiff, CommitInfo, CommitFile, BranchInfo,
} from "./types";

export class TauriTransport implements Transport {
  ptyCreate(tabId: string, cwd: string, cols: number, rows: number): Promise<void> {
    return invoke("create_session", { tabId, cwd, cols, rows });
  }
  ptyWrite(tabId: string, data: string): void {
    invoke("write_input", { tabId, data }).catch(console.error);
  }
  ptyResize(tabId: string, cols: number, rows: number): void {
    invoke("resize_session", { tabId, cols, rows }).catch(console.error);
  }
  ptyClose(tabId: string): Promise<void> {
    return invoke("kill_session", { tabId });
  }
  onPtyData(tabId: string, cb: (data: string) => void): () => void {
    let unlisten: (() => void) | null = null;
    listen(`pty-output-${tabId}`, (e) => cb(e.payload as string)).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }
  onPtyExit(tabId: string, cb: () => void): () => void {
    let unlisten: (() => void) | null = null;
    listen(`pty-exit-${tabId}`, () => cb()).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }
  onCwdChanged(tabId: string, cb: (path: string) => void): () => void {
    let unlisten: (() => void) | null = null;
    listen(`cwd-changed-${tabId}`, (e) => cb(e.payload as string)).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }
  onPortDetected(tabId: string, cb: (port: string) => void): () => void {
    let unlisten: (() => void) | null = null;
    listen(`port-detected-${tabId}`, (e) => cb(e.payload as string)).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }
  getGitStatus(path: string): Promise<GitStatus> { return invoke("get_git_status", { path }); }
  getChangedFiles(path: string): Promise<ChangedFile[]> { return invoke("get_changed_files", { path }); }
  getFileDiff(path: string, file: string): Promise<string> { return invoke("get_file_diff", { path, file }); }
  getStagedFileDiff(path: string, file: string): Promise<string> { return invoke("get_staged_file_diff", { path, file }); }
  getImageDiff(path: string, file: string): Promise<ImageDiff> { return invoke("get_image_diff", { path, file }); }
  getWorkdirStatus(path: string): Promise<WorkdirStatus> { return invoke("get_workdir_status", { path }); }
  stageFile(path: string, file: string): Promise<void> { return invoke("stage_file", { path, file }); }
  unstageFile(path: string, file: string): Promise<void> { return invoke("unstage_file", { path, file }); }
  discardFile(path: string, file: string): Promise<void> { return invoke("discard_file", { path, file }); }
  stageAll(path: string): Promise<void> { return invoke("stage_all", { path }); }
  gitCommit(path: string, message: string): Promise<void> { return invoke("git_commit", { path, message }); }
  getGitLog(path: string): Promise<CommitInfo[]> { return invoke("get_git_log", { path }); }
  getCommitFiles(path: string, hash: string): Promise<CommitFile[]> { return invoke("get_commit_files", { path, hash }); }
  getCommitFileDiff(path: string, hash: string, file: string): Promise<string> { return invoke("get_commit_file_diff", { path, hash, file }); }
  getCommitImageDiff(path: string, hash: string, file: string): Promise<ImageDiff> { return invoke("get_commit_image_diff", { path, hash, file }); }
  getBranches(path: string): Promise<BranchInfo[]> { return invoke("get_branches", { path }); }
  switchBranch(path: string, branch: string): Promise<void> { return invoke("switch_branch", { path, branch }); }
  createBranch(path: string, branch: string): Promise<void> { return invoke("create_branch", { path, branch }); }
  getWorktreeMain(path: string): Promise<string | null> { return invoke("get_worktree_main", { path }); }
  openUrl(url: string): void { invoke("open_url", { url }).catch(console.error); }
}
