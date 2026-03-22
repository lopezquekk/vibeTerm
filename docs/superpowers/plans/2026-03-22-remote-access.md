# Remote Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add remote mobile access to VibeTerm — a toggle in the desktop UI spawns a Node.js web server that serves the React app + WebSocket PTY + REST git API, accessible from phone via Tailscale.

**Architecture:** Tauri desktop app spawns a Node.js child process on toggle. The React frontend uses a `Transport` abstraction that routes calls through Tauri IPC (desktop) or WebSocket+fetch (browser). The Node server manages independent PTY sessions and exposes all git operations as REST endpoints. Tailscale handles "anywhere" access with no port forwarding.

**Tech Stack:** Node.js (v18+) · Express · ws · node-pty · Vitest (server tests) · Rust (Tauri controller) · React + TypeScript (transport layer + UI panel)

**Spec:** `docs/superpowers/specs/2026-03-22-remote-access-design.md`

**Security note:** All git subprocess calls in the server use `execFileSync` with argument arrays (never string interpolation) to prevent command injection.

---

## File Map

**New files:**
- `src/transport/types.ts` — Transport interface + all shared types
- `src/transport/tauri.ts` — TauriTransport (wraps existing `invoke`/`listen`)
- `src/transport/websocket.ts` — WebSocketTransport (WebSocket + fetch)
- `src/transport/token.ts` — token init from URL hash
- `src/transport/factory.ts` — exports `transport` singleton based on context
- `server/package.json` — server dependencies
- `server/tsconfig.json` — TypeScript config for server
- `server/src/index.ts` — entry point: HTTP + WS server, startup signal
- `server/src/pty-manager.ts` — PTY session lifecycle with node-pty
- `server/src/git-handler.ts` — git operations via execFileSync (no shell injection)
- `server/src/middleware/auth.ts` — Bearer token validation
- `server/src/middleware/rate-limit.ts` — brute-force IP lockout
- `server/src/routes/ws.ts` — WebSocket handler for PTY
- `server/src/routes/git.ts` — REST git endpoints
- `server/src/routes/static.ts` — serves `../dist/`
- `server/src/routes/control.ts` — dynamic path allowlist updates
- `server/src/test/auth.test.ts` — auth middleware tests
- `server/src/test/git-handler.test.ts` — git handler tests
- `src-tauri/src/remote_server.rs` — Rust controller: spawn/stop/status/token
- `src/components/RemoteAccessPanel.tsx` — toggle + QR + IP display

**Modified files:**
- `src/components/TerminalView.tsx` — replace `invoke`/`listen` with `transport`
- `src/components/GitDiffPanel.tsx` — replace `invoke` with `transport`
- `src/components/GitHistoryPanel.tsx` — replace `invoke` with `transport`
- `src/components/ChangesPanel.tsx` — replace `invoke` with `transport`
- `src/components/BranchPicker.tsx` — replace `invoke` with `transport`
- `src/components/Sidebar.tsx` — replace `invoke` + add `<RemoteAccessPanel />`
- `src-tauri/src/lib.rs` — add `mod remote_server`, manage state, register commands
- `src-tauri/Cargo.toml` — add `hex`, `serde_json` deps
- `src-tauri/tauri.conf.json` — add `bundle.resources` for server files
- `package.json` — add `build:server`, update `build` script

---

## Task 1: Transport types

**Files:**
- Create: `src/transport/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/transport/types.ts
git commit -m "feat(transport): add Transport interface and shared types"
```

---

## Task 2: TauriTransport + factory placeholder

**Files:**
- Create: `src/transport/tauri.ts`
- Create: `src/transport/factory.ts`

- [ ] **Step 1: Create TauriTransport**

```typescript
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
```

- [ ] **Step 2: Create factory (placeholder — completed in Task 13)**

```typescript
// src/transport/factory.ts
import { TauriTransport } from "./tauri";
import type { Transport } from "./types";

// WebSocketTransport added in Task 13
export const transport: Transport = new TauriTransport();
```

- [ ] **Step 3: Commit**

```bash
git add src/transport/
git commit -m "feat(transport): add TauriTransport and factory stub"
```

---

## Task 3: Refactor TerminalView

**Files:**
- Modify: `src/components/TerminalView.tsx`

- [ ] **Step 1: Replace imports**

Remove:
```typescript
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
```

Add:
```typescript
import { transport } from "../transport/factory";
```

Keep `getCurrentWindow` import — wrap its usage in an `isTauri` guard.

- [ ] **Step 2: Replace invoke + listen calls**

In the main `useEffect`, replace each call:

| Old | New |
|-----|-----|
| `invoke("create_session", { tabId, cwd: path, cols, rows })` | `transport.ptyCreate(tabId, path, cols, rows)` |
| `invoke("resize_session", { tabId, cols: term.cols, rows: term.rows })` | `transport.ptyResize(tabId, term.cols, term.rows)` |
| `invoke("write_input", { tabId, data })` | `transport.ptyWrite(tabId, data)` |
| `invoke("kill_session", { tabId })` | `transport.ptyClose(tabId)` |
| `invoke<string \| null>("get_worktree_main", { path: p })` | `transport.getWorktreeMain(p)` |
| `invoke<GitStatus>("get_git_status", { path: newPath })` | `transport.getGitStatus(newPath)` |

Replace the three `listen(...)` blocks:

```typescript
// PTY output
const unsubData = transport.onPtyData(tabId, (data) => {
  term.write(data);
  if (activeTabIdRef.current !== tabId) updateTab(tabId, { hasActivity: true });
});
unlisten.current = unsubData;

// CWD changes
const unsubCwd = transport.onCwdChanged(tabId, (newPath) => {
  updateTab(tabId, { path: newPath });
  transport.getGitStatus(newPath)
    .then((git) => updateTab(tabId, { git }))
    .catch(() => updateTab(tabId, { git: null }));
  refreshWorktree(newPath);
});
unlistenCwd.current = unsubCwd;

// Port detection
const unsubPort = transport.onPortDetected(tabId, (port) => {
  updateTab(tabId, { detectedPort: port });
});
unlistenPort.current = unsubPort;
```

Wrap `getCurrentWindow` in isTauri guard:
```typescript
const isTauri = typeof (window as any).__TAURI__ !== "undefined";
if (isTauri) {
  import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) scheduleFit();
      })
      .then((fn) => { unlistenFocus.current = fn; });
  });
}
```

- [ ] **Step 3: Build and verify**

```bash
pnpm tauri dev
```

Expected: terminal tabs work identically.

- [ ] **Step 4: Commit**

```bash
git add src/components/TerminalView.tsx
git commit -m "refactor(terminal): use transport abstraction"
```

---

## Task 4: Refactor remaining components

**Files:**
- Modify: `src/components/GitDiffPanel.tsx`
- Modify: `src/components/GitHistoryPanel.tsx`
- Modify: `src/components/ChangesPanel.tsx`
- Modify: `src/components/BranchPicker.tsx`
- Modify: `src/components/Sidebar.tsx`

In every file: remove `import { invoke } from "@tauri-apps/api/core"`, add `import { transport } from "../transport/factory"`.

- [ ] **Step 1: GitDiffPanel.tsx**

| Old | New |
|-----|-----|
| `invoke<ChangedFile[]>("get_changed_files", { path })` | `transport.getChangedFiles(path)` |
| `invoke<ImageDiff>("get_image_diff", { path, file })` | `transport.getImageDiff(path, file)` |
| `invoke<string>("get_file_diff", { path, file })` | `transport.getFileDiff(path, file)` |

- [ ] **Step 2: GitHistoryPanel.tsx**

| Old | New |
|-----|-----|
| `invoke<CommitInfo[]>("get_git_log", { path })` | `transport.getGitLog(path)` |
| `invoke<CommitFile[]>("get_commit_files", { path, hash })` | `transport.getCommitFiles(path, hash)` |
| `invoke<string>("get_commit_file_diff", { path, hash, file })` | `transport.getCommitFileDiff(path, hash, file)` |
| `invoke<ImageDiff>("get_commit_image_diff", { path, hash, file })` | `transport.getCommitImageDiff(path, hash, file)` |

- [ ] **Step 3: ChangesPanel.tsx**

Replace the `act(cmd, file?)` helper that uses `invoke(cmd, args)` with dynamic command names:

```typescript
// NEW act helper — explicit actions, no dynamic command names
const act = async (
  action: "stage" | "unstage" | "discard" | "stageAll",
  file?: string
) => {
  if (!tab?.path) return;
  try {
    if (action === "stage" && file)        await transport.stageFile(tab.path, file);
    else if (action === "unstage" && file) await transport.unstageFile(tab.path, file);
    else if (action === "discard" && file) await transport.discardFile(tab.path, file);
    else if (action === "stageAll")        await transport.stageAll(tab.path);
  } catch { /* ignore */ }
  await refresh();
};
```

Update all call sites from `act("stage_file", f.path)` → `act("stage", f.path)`, etc.

Also replace:
- `invoke<WorkdirStatus>("get_workdir_status", { path })` → `transport.getWorkdirStatus(path)`
- `invoke<ImageDiff>("get_image_diff", { path, file })` → `transport.getImageDiff(path, file)`
- `invoke<string>(cmd, { path, file })` → `selection.area === "staged" ? transport.getStagedFileDiff(path, file) : transport.getFileDiff(path, file)`
- `invoke("git_commit", { path, message })` → `transport.gitCommit(path, message)`

- [ ] **Step 4: BranchPicker.tsx**

| Old | New |
|-----|-----|
| `invoke<BranchInfo[]>("get_branches", { path: repoPath })` | `transport.getBranches(repoPath)` |
| `invoke("switch_branch", { path: repoPath, branch: name })` | `transport.switchBranch(repoPath, name)` |
| `invoke("create_branch", { path: repoPath, branch: name })` | `transport.createBranch(repoPath, name)` |

- [ ] **Step 5: Sidebar.tsx**

| Old | New |
|-----|-----|
| `invoke("open_url", { url: tab.detectedPort })` | `transport.openUrl(tab.detectedPort!)` |

- [ ] **Step 6: Build and verify all panels**

```bash
pnpm tauri dev
```

Test: git diff, history, changes, branch picker, URL opening all work.

- [ ] **Step 7: Commit**

```bash
git add src/components/
git commit -m "refactor(components): replace all invoke calls with transport"
```

---

## Task 5: Server package setup

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`

- [ ] **Step 1: Create server/package.json**

```json
{
  "name": "vibeterm-server",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.18.3",
    "node-pty": "^1.0.0",
    "ws": "^8.17.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.0.0",
    "@types/ws": "^8.5.10",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create server/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Install server dependencies**

```bash
cd server && npm install
```

Expected: `node_modules/` created. If `node-pty` native compilation fails, run `xcode-select --install` first.

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/tsconfig.json server/package-lock.json
git commit -m "feat(server): add Node.js server package setup"
```

---

## Task 6: Auth + rate-limit middleware

**Files:**
- Create: `server/src/middleware/auth.ts`
- Create: `server/src/middleware/rate-limit.ts`
- Create: `server/src/test/auth.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// server/src/test/auth.test.ts
import { describe, it, expect, vi } from "vitest";
import { createAuthMiddleware } from "../middleware/auth";
import type { Request, Response, NextFunction } from "express";

const makeReq = (auth?: string): Request =>
  ({ headers: { authorization: auth } } as any);
const makeRes = () =>
  ({ status: vi.fn().mockReturnThis(), json: vi.fn() } as any as Response);

describe("createAuthMiddleware", () => {
  const mw = createAuthMiddleware(() => "secret123");

  it("passes with valid Bearer token", () => {
    const next = vi.fn() as NextFunction;
    mw(makeReq("Bearer secret123"), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 401 with wrong token", () => {
    const res = makeRes();
    mw(makeReq("Bearer wrong"), res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 401 with no auth header", () => {
    const res = makeRes();
    mw(makeReq(), res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
cd server && npm test
```

Expected: FAIL — "Cannot find module '../middleware/auth'"

- [ ] **Step 3: Implement auth middleware**

```typescript
// server/src/middleware/auth.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";

export function createAuthMiddleware(getToken: () => string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = req.headers.authorization ?? "";
    if (auth === `Bearer ${getToken()}`) { next(); return; }
    res.status(401).json({ error: "Unauthorized" });
  };
}
```

Note: `getToken` is a function (not a string) so token rotation takes effect on the next request. The test already uses the function form.

- [ ] **Step 4: Run test — verify passes**

```bash
cd server && npm test
```

Expected: PASS

- [ ] **Step 5: Create rate-limit middleware**

```typescript
// server/src/middleware/rate-limit.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";

interface IpRecord { count: number; windowStart: number; blockedUntil: number | null }

export function createRateLimiter(
  maxAttempts = 5,
  windowMs = 60_000,
  blockMs = 60_000
): RequestHandler {
  const map = new Map<string, IpRecord>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const rec = map.get(ip) ?? { count: 0, windowStart: now, blockedUntil: null };

    if (rec.blockedUntil !== null) {
      if (now < rec.blockedUntil) {
        res.status(429).json({ error: "Too many failed attempts, try again later" });
        return;
      }
      // Block expired — reset
      rec.blockedUntil = null;
      rec.count = 0;
      rec.windowStart = now;
    }

    // Intercept 401s to record failures within the rolling window
    const origJson = res.json.bind(res);
    (res as any).json = (body: unknown) => {
      if (res.statusCode === 401) {
        const r = map.get(ip) ?? { count: 0, windowStart: Date.now(), blockedUntil: null };
        const t = Date.now();
        if (t - r.windowStart > windowMs) {
          // Rolling window expired — start a fresh one
          r.count = 1;
          r.windowStart = t;
        } else {
          r.count += 1;
        }
        if (r.count >= maxAttempts) {
          r.blockedUntil = t + blockMs;
          r.count = 0;
        }
        map.set(ip, r);
      }
      return origJson(body);
    };

    next();
  };
}
```

- [ ] **Step 6: Commit**

```bash
cd .. && git add server/src/middleware/ server/src/test/auth.test.ts
git commit -m "feat(server): add auth and rate-limit middleware"
```

---

## Task 7: Git handler (injection-safe)

**Files:**
- Create: `server/src/git-handler.ts`
- Create: `server/src/test/git-handler.test.ts`

**Key rule:** All subprocess calls use `execFileSync(binary, argsArray, { cwd })` — never string interpolation into shell commands. This prevents command injection from filenames or paths.

- [ ] **Step 1: Write failing test**

```typescript
// server/src/test/git-handler.test.ts
import { describe, it, expect } from "vitest";
import { isPathAllowed, truncateOutput } from "../git-handler";

describe("isPathAllowed", () => {
  it("allows exact match", () => {
    expect(isPathAllowed("/home/cam/repo", ["/home/cam/repo"])).toBe(true);
  });
  it("allows subpath", () => {
    expect(isPathAllowed("/home/cam/repo/sub", ["/home/cam/repo"])).toBe(true);
  });
  it("rejects unrelated path", () => {
    expect(isPathAllowed("/etc/passwd", ["/home/cam/repo"])).toBe(false);
  });
  it("rejects path traversal", () => {
    expect(isPathAllowed("/home/cam/repo/../secret", ["/home/cam/repo"])).toBe(false);
  });
});

describe("truncateOutput", () => {
  it("passes short output unchanged", () => {
    const r = truncateOutput("hello");
    expect(r).toEqual({ content: "hello", truncated: false });
  });
  it("truncates at 1MB", () => {
    const r = truncateOutput("x".repeat(1_100_000));
    expect(r.truncated).toBe(true);
    expect(r.content.length).toBeLessThanOrEqual(1_048_576);
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
cd server && npm test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement git handler**

```typescript
// server/src/git-handler.ts
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
    // First block is the main worktree
    const main = blocks[0];
    const pathLine = main?.split("\n").find((l) => l.startsWith("worktree "));
    const mainPath = pathLine?.slice(9).trim();
    if (mainPath && path.resolve(mainPath) !== path.resolve(repoPath)) return mainPath;
    return null;
  } catch { return null; }
}
```

- [ ] **Step 4: Run tests — verify passes**

```bash
cd server && npm test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd .. && git add server/src/git-handler.ts server/src/test/git-handler.test.ts
git commit -m "feat(server): add injection-safe git handler using execFileSync with arg arrays"
```

---

## Task 8: PTY manager

**Files:**
- Create: `server/src/pty-manager.ts`

- [ ] **Step 1: Create PTY manager**

```typescript
// server/src/pty-manager.ts
import * as pty from "node-pty";
import os from "os";
import type WebSocket from "ws";

const SESSION_TTL_MS = 30_000;

interface Session {
  pty: pty.IPty;
  ws: WebSocket | null;
  ttlTimer: ReturnType<typeof setTimeout> | null;
  dataHandlerDispose: pty.IDisposable | null;
}

const sessions = new Map<string, Session>();

export function createSession(
  sessionId: string,
  cwd: string,
  cols: number,
  rows: number,
  ws: WebSocket
): void {
  const shell = process.env.SHELL ??
    (os.platform() === "win32" ? "powershell.exe" : "/bin/bash");
  const resolvedCwd = cwd === "~" ? os.homedir() : cwd;

  const p = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: resolvedCwd,
    env: { ...process.env } as Record<string, string>,
  });

  const session: Session = { pty: p, ws, ttlTimer: null, dataHandlerDispose: null };
  sessions.set(sessionId, session);

  session.dataHandlerDispose = p.onData((data) => {
    if (session.ws?.readyState === 1 /* OPEN */) session.ws.send(data);
  });

  p.onExit(() => { sessions.delete(sessionId); });

  ws.send(JSON.stringify({ type: "pty-ready" }));
}

export function attachSession(sessionId: string, ws: WebSocket): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (session.ttlTimer) { clearTimeout(session.ttlTimer); session.ttlTimer = null; }
  // Dispose old data handler and attach new ws
  session.dataHandlerDispose?.dispose();
  session.ws = ws;
  session.dataHandlerDispose = session.pty.onData((data) => {
    if (session.ws?.readyState === 1) session.ws.send(data);
  });
  ws.send(JSON.stringify({ type: "pty-ready" }));
  return true;
}

export function detachSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.ws = null;
  session.ttlTimer = setTimeout(() => {
    session.pty.kill();
    sessions.delete(sessionId);
  }, SESSION_TTL_MS);
}

export function writeToSession(sessionId: string, data: string): void {
  sessions.get(sessionId)?.pty.write(data);
}

export function resizeSession(sessionId: string, cols: number, rows: number): void {
  sessions.get(sessionId)?.pty.resize(cols, rows);
}

export function killSession(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  if (s.ttlTimer) clearTimeout(s.ttlTimer);
  s.dataHandlerDispose?.dispose();
  s.pty.kill();
  sessions.delete(sessionId);
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/pty-manager.ts
git commit -m "feat(server): add PTY session manager with 30s TTL reconnect"
```

---

## Task 9: WebSocket + REST routes

**Files:**
- Create: `server/src/routes/ws.ts`
- Create: `server/src/routes/git.ts`
- Create: `server/src/routes/static.ts`
- Create: `server/src/routes/control.ts`

- [ ] **Step 1: WebSocket route**

```typescript
// server/src/routes/ws.ts
import type { IncomingMessage } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { URL } from "url";
import * as ptyManager from "../pty-manager";

// Token is passed as a query parameter on the WebSocket upgrade request.
// (Browser WebSocket API cannot set custom headers — query param is the standard approach.)
// Authentication is enforced at the HTTP upgrade stage (before the 101 response) via
// the `verifyClient` option, so an invalid token returns HTTP 401 and the connection
// is never established. Rate limiting (5 failures / 60s per IP) is also applied inside
// verifyClient to prevent brute-forcing the WS token.

interface IpRecord { count: number; windowStart: number; blockedUntil: number | null }
const wsIpMap = new Map<string, IpRecord>();
const WS_MAX = 5, WS_WINDOW = 60_000, WS_BLOCK = 60_000;

export function createWssOptions(getToken: () => string) {
  return {
    verifyClient: (
      info: { req: IncomingMessage },
      cb: (res: boolean, code?: number, message?: string) => void
    ) => {
      const ip = (info.req.socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
      const now = Date.now();
      const rec = wsIpMap.get(ip) ?? { count: 0, windowStart: now, blockedUntil: null };

      if (rec.blockedUntil !== null && now < rec.blockedUntil) {
        cb(false, 429, "Too many failed attempts");
        return;
      }

      const url = new URL(`http://localhost${info.req.url ?? ""}`);
      const tokenOk = url.searchParams.get("token") === getToken();

      if (!tokenOk) {
        if (now - rec.windowStart > WS_WINDOW) { rec.count = 1; rec.windowStart = now; }
        else rec.count += 1;
        if (rec.count >= WS_MAX) { rec.blockedUntil = now + WS_BLOCK; rec.count = 0; }
        wsIpMap.set(ip, rec);
        cb(false, 401, "Unauthorized");
        return;
      }

      if (!url.searchParams.get("sessionId")) { cb(false, 400, "Missing sessionId"); return; }
      // Reset on success
      wsIpMap.delete(ip);
      cb(true);
    },
  };
}

export function setupWsServer(wss: WebSocketServer, _getToken: () => string): void {
  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    // Token already verified by verifyClient — proceed directly
    const url = new URL(`http://localhost${req.url ?? ""}`);
    const sessionId = url.searchParams.get("sessionId")!;
    const cwd = decodeURIComponent(url.searchParams.get("cwd") ?? "~");
    const cols = parseInt(url.searchParams.get("cols") ?? "80");
    const rows = parseInt(url.searchParams.get("rows") ?? "24");

    const reattached = ptyManager.attachSession(sessionId, ws);
    if (!reattached) {
      try {
        ptyManager.createSession(sessionId, cwd, cols, rows, ws);
      } catch (e) {
        ws.send(JSON.stringify({ type: "pty-error", message: String(e) }));
        ws.close(4003, "PTY creation failed");
        return;
      }
    }

    ws.on("message", (raw) => {
      const msg = raw.toString();
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === "resize") ptyManager.resizeSession(sessionId, parsed.cols, parsed.rows);
      } catch {
        ptyManager.writeToSession(sessionId, msg);
      }
    });

    ws.on("close", () => ptyManager.detachSession(sessionId));
  });
}
```

- [ ] **Step 2: Git REST router**

```typescript
// server/src/routes/git.ts
import { Router } from "express";
import * as git from "../git-handler";
import { isPathAllowed } from "../git-handler";

export function createGitRouter(getAllowedPaths: () => string[]) {
  const router = Router();

  // Validate path on every request
  router.use((req, res, next) => {
    const p = (req.query.path ?? req.body?.path) as string | undefined;
    if (!p || !isPathAllowed(p, getAllowedPaths())) {
      res.status(403).json({ error: "Path not allowed" }); return;
    }
    next();
  });

  const qp = (req: any, k: string) => req.query[k] as string;
  const bp = (req: any, k: string) => req.body?.[k] as string;

  router.get("/status",           (req, res) => res.json(git.getGitStatus(qp(req, "path"))));
  router.get("/changed-files",    (req, res) => res.json(git.getChangedFiles(qp(req, "path"))));
  router.get("/file-diff",        (req, res) => res.json(git.getFileDiff(qp(req, "path"), qp(req, "file"))));
  router.get("/staged-file-diff", (req, res) => res.json(git.getStagedFileDiff(qp(req, "path"), qp(req, "file"))));
  router.get("/image-diff",       (req, res) => res.json(git.getImageDiff(qp(req, "path"), qp(req, "file"))));
  router.get("/workdir-status",   (req, res) => res.json(git.getWorkdirStatus(qp(req, "path"))));
  router.get("/log",              (req, res) => res.json(git.getGitLog(qp(req, "path"))));
  router.get("/commit-files",     (req, res) => res.json(git.getCommitFiles(qp(req, "path"), qp(req, "hash"))));
  router.get("/commit-file-diff", (req, res) => res.json(git.getCommitFileDiff(qp(req, "path"), qp(req, "hash"), qp(req, "file"))));
  router.get("/commit-image-diff",(req, res) => res.json(git.getCommitImageDiff(qp(req, "path"), qp(req, "hash"), qp(req, "file"))));
  router.get("/branches",         (req, res) => res.json(git.getBranches(qp(req, "path"))));
  router.get("/worktree-main",    (req, res) => res.json({ main: git.getWorktreeMain(qp(req, "path")) }));

  router.post("/stage",         (req, res) => { git.stageFile(bp(req,"path"), bp(req,"file")); res.json({ ok: true }); });
  router.post("/unstage",       (req, res) => { git.unstageFile(bp(req,"path"), bp(req,"file")); res.json({ ok: true }); });
  router.post("/discard",       (req, res) => { git.discardFile(bp(req,"path"), bp(req,"file")); res.json({ ok: true }); });
  router.post("/stage-all",     (req, res) => { git.stageAll(bp(req,"path")); res.json({ ok: true }); });
  router.post("/commit",        (req, res) => { git.gitCommit(bp(req,"path"), bp(req,"message")); res.json({ ok: true }); });
  router.post("/switch-branch", (req, res) => { git.switchBranch(bp(req,"path"), bp(req,"branch")); res.json({ ok: true }); });
  router.post("/create-branch", (req, res) => { git.createBranch(bp(req,"path"), bp(req,"branch")); res.json({ ok: true }); });

  return router;
}
```

- [ ] **Step 3: Static + control routes**

```typescript
// server/src/routes/static.ts
import express from "express";
import path from "path";

export function createStaticRouter() {
  const distPath = path.resolve(__dirname,
    process.env.NODE_ENV === "production" ? "../../../dist" : "../../dist");
  return express.static(distPath, { index: "index.html" });
}

// server/src/routes/control.ts
import { Router } from "express";
import path from "path";

export function createControlRouter(addPath: (p: string) => void) {
  const router = Router();
  router.post("/add-path", (req, res) => {
    const p = req.body?.path as string;
    if (!p) { res.status(400).json({ error: "Missing path" }); return; }
    addPath(path.resolve(p));
    res.json({ ok: true });
  });
  return router;
}
```

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/
git commit -m "feat(server): add WebSocket, git REST, static, and control routes"
```

---

## Task 10: Server entry point

**Files:**
- Create: `server/src/index.ts`

- [ ] **Step 1: Create entry point**

```typescript
// server/src/index.ts
import express from "express";
import http from "http";
import cors from "cors";
import { WebSocketServer } from "ws";
import crypto from "crypto";
import path from "path";
import readline from "readline";
import { createAuthMiddleware } from "./middleware/auth";
import { createRateLimiter } from "./middleware/rate-limit";
import { createGitRouter } from "./routes/git";
import { createControlRouter } from "./routes/control";
import { createStaticRouter } from "./routes/static";
import { setupWsServer, createWssOptions } from "./routes/ws";

// CLI args
const args = process.argv.slice(2);
const arg = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] ?? def : def;
};

const PORT = parseInt(arg("port", "7788"));
let TOKEN = arg("token", crypto.randomBytes(16).toString("hex"));
const initialPaths: string[] = JSON.parse(arg("allowed-paths", "[]"));

const allowedPaths = [...initialPaths.map(p => path.resolve(p))];
const addPath = (p: string) => { if (!allowedPaths.includes(p)) allowedPaths.push(p); };
const getToken = () => TOKEN;

// Stdin reader for Tauri control messages
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.type === "rotate-token" && typeof msg.token === "string") TOKEN = msg.token;
    else if (msg.type === "add-path" && typeof msg.path === "string") addPath(path.resolve(msg.path));
  } catch { /* ignore */ }
});

const rateLimiter = createRateLimiter();
const app = express();
app.use(cors({ origin: false }));
app.use(express.json());
app.use("/api", rateLimiter, createAuthMiddleware(getToken));
app.use("/api/git", createGitRouter(() => allowedPaths));
app.use("/api/control", createControlRouter(addPath));
app.use(createStaticRouter());
app.get("*", (_req, res) => {
  const idx = path.resolve(__dirname,
    process.env.NODE_ENV === "production" ? "../../../dist/index.html" : "../../dist/index.html");
  res.sendFile(idx);
});

const server = http.createServer(app);

// WebSocket server: token validated at HTTP upgrade stage via verifyClient (returns 401 before 101)
// Rate limiting (5 failures / 60s window per IP) is applied inside verifyClient before the 101 response.
const wss = new WebSocketServer({ server, path: "/pty", ...createWssOptions(getToken) });
setupWsServer(wss, getToken);

server.listen(PORT, "0.0.0.0", () => {
  process.stdout.write(JSON.stringify({ status: "ready", port: PORT }) + "\n");
}).on("error", (err: NodeJS.ErrnoException) => {
  const message = err.code === "EADDRINUSE" ? "port in use" : err.message;
  process.stdout.write(JSON.stringify({ status: "error", message }) + "\n");
  process.exit(1);
});
```

- [ ] **Step 2: Build**

```bash
cd server && npm run build
```

Expected: `server/dist/` created with no errors.

- [ ] **Step 3: Commit**

```bash
cd .. && git add server/src/index.ts
git commit -m "feat(server): add server entry point"
```

---

## Task 11: WebSocketTransport

**Files:**
- Create: `src/transport/websocket.ts`

- [ ] **Step 1: Create WebSocketTransport**

```typescript
// src/transport/websocket.ts
import type {
  Transport, GitStatus, ChangedFile, WorkdirStatus,
  ImageDiff, CommitInfo, CommitFile, BranchInfo,
} from "./types";

const MAX_QUEUE = 500;

export class WebSocketTransport implements Transport {
  private token: string;
  private wsBase: string;
  private sockets = new Map<string, WebSocket>();
  private dataCallbacks = new Map<string, (data: string) => void>();
  private exitCallbacks = new Map<string, () => void>();
  private writeQueues = new Map<string, string[]>();
  private sessionMeta = new Map<string, { cwd: string; cols: number; rows: number }>();

  constructor(token: string) {
    this.token = token;
    this.wsBase = window.location.origin.replace(/^http/, "ws");
  }

  ptyCreate(tabId: string, cwd: string, cols: number, rows: number): Promise<void> {
    this.sessionMeta.set(tabId, { cwd, cols, rows });
    this.writeQueues.set(tabId, []);
    return new Promise((resolve, reject) => {
      const url = `${this.wsBase}/pty?sessionId=${tabId}&cwd=${encodeURIComponent(cwd)}&cols=${cols}&rows=${rows}&token=${this.token}`;
      const ws = new WebSocket(url);
      this.sockets.set(tabId, ws);

      ws.onopen = () => {
        const q = this.writeQueues.get(tabId) ?? [];
        q.forEach((d) => ws.send(d));
        this.writeQueues.set(tabId, []);
      };

      ws.onmessage = (e) => {
        const msg = e.data as string;
        try {
          const p = JSON.parse(msg);
          if (p.type === "pty-ready") { resolve(); return; }
          if (p.type === "pty-error") { reject(new Error(p.message)); return; }
        } catch { /* not JSON */ }
        this.dataCallbacks.get(tabId)?.(msg);
      };

      ws.onerror = () => reject(new Error("WS connection failed"));
      ws.onclose = () => {
        this.reconnect(tabId);
        this.exitCallbacks.get(tabId)?.();
      };
    });
  }

  private reconnect(tabId: string, delay = 1000): void {
    const meta = this.sessionMeta.get(tabId);
    if (!meta) return;
    const { cwd, cols, rows } = meta;
    setTimeout(() => {
      if (!this.sessionMeta.has(tabId)) return; // tab was closed
      const url = `${this.wsBase}/pty?sessionId=${tabId}&cwd=${encodeURIComponent(cwd)}&cols=${cols}&rows=${rows}&token=${this.token}`;
      const ws = new WebSocket(url);
      this.sockets.set(tabId, ws);
      ws.onopen = () => {
        const q = this.writeQueues.get(tabId) ?? [];
        q.forEach((d) => ws.send(d));
        this.writeQueues.set(tabId, []);
      };
      ws.onmessage = (e) => {
        const msg = e.data as string;
        try { const p = JSON.parse(msg); if (p.type === "pty-ready" || p.type === "pty-error") return; } catch {}
        this.dataCallbacks.get(tabId)?.(msg);
      };
      ws.onclose = () => this.reconnect(tabId, Math.min(delay * 2, 30_000));
    }, delay);
  }

  ptyWrite(tabId: string, data: string): void {
    const ws = this.sockets.get(tabId);
    if (ws?.readyState === WebSocket.OPEN) { ws.send(data); return; }
    const q = this.writeQueues.get(tabId) ?? [];
    if (q.length < MAX_QUEUE) { q.push(data); this.writeQueues.set(tabId, q); }
  }

  ptyResize(tabId: string, cols: number, rows: number): void {
    const meta = this.sessionMeta.get(tabId);
    if (meta) { meta.cols = cols; meta.rows = rows; }
    const ws = this.sockets.get(tabId);
    const msg = JSON.stringify({ type: "resize", cols, rows });
    if (ws?.readyState === WebSocket.OPEN) ws.send(msg);
  }

  ptyClose(tabId: string): Promise<void> {
    this.sockets.get(tabId)?.close();
    this.sockets.delete(tabId);
    this.dataCallbacks.delete(tabId);
    this.exitCallbacks.delete(tabId);
    this.writeQueues.delete(tabId);
    this.sessionMeta.delete(tabId);
    return Promise.resolve();
  }

  onPtyData(tabId: string, cb: (d: string) => void): () => void {
    this.dataCallbacks.set(tabId, cb);
    return () => this.dataCallbacks.delete(tabId);
  }

  onPtyExit(tabId: string, cb: () => void): () => void {
    this.exitCallbacks.set(tabId, cb);
    return () => this.exitCallbacks.delete(tabId);
  }

  onCwdChanged(_id: string, _cb: (p: string) => void): () => void { return () => {}; }
  onPortDetected(_id: string, _cb: (p: string) => void): () => void { return () => {}; }

  private async get<T>(ep: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`/api/git/${ep}`, window.location.origin);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${this.token}` } });
    if (!r.ok) throw new Error(`${ep}: ${r.status}`);
    return r.json();
  }

  private async post<T>(ep: string, body: Record<string, string>): Promise<T> {
    const r = await fetch(`/api/git/${ep}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${ep}: ${r.status}`);
    return r.json();
  }

  getGitStatus(p: string): Promise<GitStatus>       { return this.get("status", { path: p }); }
  getChangedFiles(p: string): Promise<ChangedFile[]> { return this.get("changed-files", { path: p }); }
  async getFileDiff(p: string, f: string): Promise<string> {
    const r: any = await this.get("file-diff", { path: p, file: f }); return r.content ?? r;
  }
  async getStagedFileDiff(p: string, f: string): Promise<string> {
    const r: any = await this.get("staged-file-diff", { path: p, file: f }); return r.content ?? r;
  }
  getImageDiff(p: string, f: string): Promise<ImageDiff>   { return this.get("image-diff", { path: p, file: f }); }
  getWorkdirStatus(p: string): Promise<WorkdirStatus>       { return this.get("workdir-status", { path: p }); }
  getGitLog(p: string): Promise<CommitInfo[]>               { return this.get("log", { path: p }); }
  getCommitFiles(p: string, h: string): Promise<CommitFile[]>{ return this.get("commit-files", { path: p, hash: h }); }
  async getCommitFileDiff(p: string, h: string, f: string): Promise<string> {
    const r: any = await this.get("commit-file-diff", { path: p, hash: h, file: f }); return r.content ?? r;
  }
  getCommitImageDiff(p: string, h: string, f: string): Promise<ImageDiff> {
    return this.get("commit-image-diff", { path: p, hash: h, file: f });
  }
  getBranches(p: string): Promise<BranchInfo[]>              { return this.get("branches", { path: p }); }
  async getWorktreeMain(p: string): Promise<string | null> {
    const r: any = await this.get("worktree-main", { path: p }); return r.main ?? null;
  }
  stageFile(p: string, f: string): Promise<void>   { return this.post("stage", { path: p, file: f }); }
  unstageFile(p: string, f: string): Promise<void> { return this.post("unstage", { path: p, file: f }); }
  discardFile(p: string, f: string): Promise<void> { return this.post("discard", { path: p, file: f }); }
  stageAll(p: string): Promise<void>               { return this.post("stage-all", { path: p }); }
  gitCommit(p: string, m: string): Promise<void>   { return this.post("commit", { path: p, message: m }); }
  switchBranch(p: string, b: string): Promise<void>{ return this.post("switch-branch", { path: p, branch: b }); }
  createBranch(p: string, b: string): Promise<void>{ return this.post("create-branch", { path: p, branch: b }); }
  openUrl(url: string): void { window.open(url, "_blank"); }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/transport/websocket.ts
git commit -m "feat(transport): add WebSocketTransport with reconnect backoff"
```

---

## Task 12: Token init + factory update

**Files:**
- Create: `src/transport/token.ts`
- Modify: `src/transport/factory.ts`

- [ ] **Step 1: Token initializer**

```typescript
// src/transport/token.ts
export function initToken(): string | null {
  // QR scan flow: token is in URL hash fragment
  const match = window.location.hash.match(/[#&]token=([^&]+)/);
  if (match) {
    const token = decodeURIComponent(match[1]);
    sessionStorage.setItem("vibeterm_token", token);
    // Remove fragment so token is not visible in address bar or Referer headers
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return token;
  }
  // Page refresh: token already in sessionStorage
  return sessionStorage.getItem("vibeterm_token");
}
```

- [ ] **Step 2: Update factory.ts**

```typescript
// src/transport/factory.ts
import { TauriTransport } from "./tauri";
import { WebSocketTransport } from "./websocket";
import { initToken } from "./token";
import type { Transport } from "./types";

const isTauri = typeof (window as any).__TAURI__ !== "undefined";

function createTransport(): Transport {
  if (isTauri) return new TauriTransport();
  const token = initToken();
  if (!token) console.warn("VibeTerm: no auth token — scan the QR code to connect.");
  return new WebSocketTransport(token ?? "");
}

export const transport: Transport = createTransport();
```

- [ ] **Step 3: Commit**

```bash
git add src/transport/token.ts src/transport/factory.ts
git commit -m "feat(transport): token init from URL hash, factory uses WebSocketTransport in browser"
```

---

## Task 13: Rust remote_server.rs

**Files:**
- Create: `src-tauri/src/remote_server.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add Cargo dependencies**

In `src-tauri/Cargo.toml` under `[dependencies]`, add:
```toml
hex = "0.4"
serde_json = "1"
rand = "0.8"
```

- [ ] **Step 2: Create remote_server.rs**

```rust
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
    if srv.child.is_some() {
        return Ok(ServerInfo { port: srv.port, token: srv.token.clone(),
            local_ip: detect_local_ip(), tailscale_ip: detect_tailscale_ip() });
    }

    let node = find_node().ok_or(
        "Node.js not found. Install from nodejs.org or via Homebrew: brew install node"
    )?;
    let script = find_server_script(&app)?;
    let token = gen_token();
    let paths_json = serde_json::to_string(&allowed_paths).unwrap_or_else(|_| "[]".to_string());

    let mut child = Command::new(&node)
        .arg(&script)
        .args(["--port", "7788", "--token", &token, "--allowed-paths", &paths_json])
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
    struct Startup { status: String, #[serde(default)] message: String }
    let msg: Startup = serde_json::from_str(&first)
        .map_err(|_| format!("Unexpected output: {first}"))?;
    if msg.status == "error" { let _ = child.kill(); return Err(msg.message); }

    // Spawn background watcher: emits "remote-server-died" if the process exits unexpectedly
    let state_arc: Arc<Mutex<RemoteServer>> = Arc::clone(&state);
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
    srv.port = 7788;
    srv.token = token.clone();

    Ok(ServerInfo { port: 7788, token, local_ip: detect_local_ip(), tailscale_ip: detect_tailscale_ip() })
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

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/remote_server.rs src-tauri/Cargo.toml
git commit -m "feat(rust): add remote server Rust controller"
```

---

## Task 14: Wire into lib.rs

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Update lib.rs**

Add at the top:
```rust
mod remote_server;
use std::sync::{Arc, Mutex};
```

In `setup`:
```rust
app.manage(Arc::new(Mutex::new(remote_server::RemoteServer::default())));
```

In `invoke_handler`:
```rust
remote_server::start_remote_server,
remote_server::stop_remote_server,
remote_server::get_remote_server_status,
remote_server::regenerate_remote_token,
remote_server::add_remote_allowed_path,
```

- [ ] **Step 2: Build**

```bash
pnpm tauri dev
```

Expected: compiles, app runs, all existing functionality still works.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(rust): wire remote server commands into Tauri app"
```

---

## Task 15: RemoteAccessPanel UI

**Files:**
- Create: `src/components/RemoteAccessPanel.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `package.json` (add qrcode dep)

- [ ] **Step 1: Install qrcode**

```bash
pnpm add qrcode && pnpm add -D @types/qrcode
```

- [ ] **Step 2: Create RemoteAccessPanel**

```typescript
// src/components/RemoteAccessPanel.tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import QRCode from "qrcode";
import { useTabStore } from "../store/tabStore";

interface ServerInfo {
  port: number; token: string; local_ip: string; tailscale_ip: string | null;
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-[9px] text-zinc-500 hover:text-zinc-300 px-1 py-0.5 rounded border border-zinc-700 hover:border-zinc-500 transition-colors"
    >{copied ? "✓" : "copy"}</button>
  );
}

export default function RemoteAccessPanel() {
  const tabs = useTabStore((s) => s.tabs);
  const [on, setOn] = useState(false);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qrRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const p = listen("remote-server-died", () => { setOn(false); setInfo(null); setError("Server stopped unexpectedly"); });
    return () => { p.then((fn) => fn()); };
  }, []);

  const primaryIp = info?.tailscale_ip ?? info?.local_ip;
  const qrUrl = primaryIp ? `http://${primaryIp}:${info!.port}/#token=${info!.token}` : null;

  useEffect(() => {
    if (!qrRef.current || !qrUrl) return;
    QRCode.toCanvas(qrRef.current, qrUrl, { width: 96, color: { dark: "#ffffff", light: "#18181b" } });
  }, [qrUrl]);

  const toggle = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (on) {
        await invoke("stop_remote_server");
        setOn(false); setInfo(null);
      } else {
        const allowedPaths = tabs.map((t) => t.path);
        const result = await invoke<ServerInfo>("start_remote_server", { allowedPaths });
        setInfo(result); setOn(true);
      }
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [on, tabs]);

  const regen = useCallback(async () => {
    try {
      const t = await invoke<string>("regenerate_remote_token");
      setInfo((prev) => prev ? { ...prev, token: t } : prev);
    } catch (e) { setError(String(e)); }
  }, []);

  const buildUrl = (ip: string) => `http://${ip}:${info!.port}/#token=${info!.token}`;

  return (
    <div className="px-3 py-2 border-t border-border mt-auto shrink-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Remote</span>
        <button
          onClick={toggle} disabled={loading}
          className={`relative w-8 h-4 rounded-full transition-colors ${on ? "bg-accent" : "bg-zinc-700"} ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
        >
          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
        </button>
      </div>

      {error && <p className="text-[10px] text-red-400 mb-1">{error}</p>}

      {on && info && (
        <div className="space-y-1 text-[10px]">
          {info.local_ip && (
            <div className="flex items-center gap-1">
              <span className="text-zinc-500 w-10 shrink-0">Local</span>
              <span className="text-zinc-300 font-mono truncate flex-1">{info.local_ip}:{info.port}</span>
              <CopyBtn text={buildUrl(info.local_ip)} />
            </div>
          )}
          {info.tailscale_ip && (
            <div className="flex items-center gap-1">
              <span className="text-zinc-500 w-10 shrink-0">TS</span>
              <span className="text-zinc-300 font-mono truncate flex-1">{info.tailscale_ip}:{info.port}</span>
              <CopyBtn text={buildUrl(info.tailscale_ip)} />
            </div>
          )}
          <div className="flex items-center gap-1">
            <span className="text-zinc-500 w-10 shrink-0">Token</span>
            <span className="text-zinc-300 font-mono truncate flex-1">{info.token.slice(0, 8)}…</span>
            <CopyBtn text={info.token} />
            <button onClick={regen} className="text-[9px] text-zinc-500 hover:text-zinc-300 px-1 py-0.5 rounded border border-zinc-700 hover:border-zinc-500 transition-colors">regen</button>
          </div>
          {qrUrl && (
            <div className="pt-1">
              <canvas ref={qrRef} className="rounded border border-zinc-700" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add to Sidebar**

At the very bottom of `Sidebar.tsx`, inside the outermost sidebar `<div>`, just before the closing tag, add:

```typescript
import RemoteAccessPanel from "./RemoteAccessPanel";
// ... in JSX:
<RemoteAccessPanel />
```

- [ ] **Step 4: Test toggle in dev**

```bash
pnpm tauri dev
```

- Toggle Remote ON → IP, token, QR appear
- Click copy next to local IP → URL in clipboard
- Click regen → token rotates
- Toggle OFF → clears

- [ ] **Step 5: Commit**

```bash
git add src/components/RemoteAccessPanel.tsx src/components/Sidebar.tsx
git commit -m "feat(ui): add Remote Access panel with QR code, IP display, and token controls"
```

---

## Task 16: Build config + tauri resources

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Update package.json scripts**

```json
{
  "scripts": {
    "dev": "vite",
    "build:frontend": "tsc && vite build",
    "build:server": "cd server && npm install && npm rebuild node-pty && npm run build",
    "build": "pnpm build:server && pnpm build:frontend",
    "preview": "vite preview",
    "tauri": "tauri"
  }
}
```

Update `beforeBuildCommand` in `src-tauri/tauri.conf.json`:
```json
"build": {
  "beforeDevCommand": "pnpm dev",
  "devUrl": "http://localhost:1420",
  "beforeBuildCommand": "pnpm build",
  "frontendDist": "../dist"
}
```

- [ ] **Step 2: Add server resources to tauri.conf.json**

In `src-tauri/tauri.conf.json`, `bundle` section, add:
```json
"resources": {
  "server/dist": "server/dist",
  "server/node_modules": "server/node_modules"
}
```

**Note on native addon codesigning:** `node-pty` builds a native `.node` binary. For macOS distribution (`.dmg`), this binary must be codesigned. When running `pnpm tauri build`, Tauri will codesign all bundled resources automatically if `APPLE_CERTIFICATE` and signing identity are configured. For development builds, no codesigning is needed.

- [ ] **Step 3: Full build test**

```bash
pnpm build
```

Expected: `server/dist/` built, then `dist/` built — no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json src-tauri/tauri.conf.json
git commit -m "feat(build): add build:server script and tauri resource bundling for server"
```

---

## Task 17: End-to-end verification

- [ ] **Step 1: Smoke test desktop (Tauri)**

```bash
pnpm tauri dev
```

Open all four panels for an existing git repo tab. Confirm: terminal works, git diff loads, history loads, changes panel works.

- [ ] **Step 2: Enable remote + test in desktop browser**

Toggle Remote ON. Copy local URL + token. Open `http://127.0.0.1:7788/#token=<token>` in Chrome/Safari.

Verify:
- App UI loads
- Create a terminal tab → can type + see output
- Open git diff on a path that has changes
- Open git history

- [ ] **Step 3: Test reconnect**

With the browser tab open, restart the Node server (toggle OFF then ON). Refresh the browser page. Verify it reconnects (token changes — need to re-scan or use new URL).

- [ ] **Step 4: Test via Tailscale (requires Tailscale installed)**

Open Tailscale on Mac + phone. Toggle Remote ON on desktop. Scan QR code from phone. Verify the full UI loads on the phone browser.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: remote access complete — mobile access to VibeTerm via Node.js server + Tailscale"
```
