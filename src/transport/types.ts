// src/transport/types.ts

export interface GitStatus {
  branch: string;
  isDirty: boolean;
  added: number;
  modified: number;
  deleted: number;
  ahead: number;
  behind: number;
}

export interface ChangedFile {
  path: string;
  status: string;
}

export interface WorkdirStatus {
  staged: ChangedFile[];
  unstaged: ChangedFile[];
}

export interface ImageDiff {
  before: string | null; // base64
  after: string | null;  // base64
  ext: string;
}

export interface CommitInfo {
  hash: string;
  short_hash: string;
  author: string;
  date: string;
  message: string;
  is_local: boolean;
}

export interface CommitFile {
  path: string;
  status: string;
}

export interface BranchInfo {
  name: string;
  is_current: boolean;
}

export interface Transport {
  // PTY
  ptyCreate(tabId: string, cwd: string, cols: number, rows: number): Promise<void>;
  ptyWrite(tabId: string, data: string): void;
  ptyResize(tabId: string, cols: number, rows: number): void;
  ptyClose(tabId: string): Promise<void>;
  onPtyData(tabId: string, cb: (data: string) => void): () => void;
  onPtyExit(tabId: string, cb: () => void): () => void;
  // No-ops in web mode:
  onCwdChanged(tabId: string, cb: (path: string) => void): () => void;
  onPortDetected(tabId: string, cb: (port: string) => void): () => void;

  // Git — working tree
  getGitStatus(path: string): Promise<GitStatus>;
  getChangedFiles(path: string): Promise<ChangedFile[]>;
  getFileDiff(path: string, file: string): Promise<string>;
  getStagedFileDiff(path: string, file: string): Promise<string>;
  getImageDiff(path: string, file: string): Promise<ImageDiff>;
  getWorkdirStatus(path: string): Promise<WorkdirStatus>;
  stageFile(path: string, file: string): Promise<void>;
  unstageFile(path: string, file: string): Promise<void>;
  discardFile(path: string, file: string): Promise<void>;
  stageAll(path: string): Promise<void>;
  gitCommit(path: string, message: string): Promise<void>;

  // Git — history
  getGitLog(path: string): Promise<CommitInfo[]>;
  getCommitFiles(path: string, hash: string): Promise<CommitFile[]>;
  getCommitFileDiff(path: string, hash: string, file: string): Promise<string>;
  getCommitImageDiff(path: string, hash: string, file: string): Promise<ImageDiff>;

  // Git — branches
  getBranches(path: string): Promise<BranchInfo[]>;
  switchBranch(path: string, branch: string): Promise<void>;
  createBranch(path: string, branch: string): Promise<void>;

  // Worktrees
  getWorktreeMain(path: string): Promise<string | null>;

  // System
  openUrl(url: string): void;
}
