# vibeTerm Quality & Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace silent error swallowing with user-visible feedback, replace 3s git polling with fs.watch + smart fallback, and add critical-path tests.

**Architecture:** Three independent modules delivered in sequence. Module 1 (error handling) introduces a Zustand toast store + inline banner component + hook. Module 2 (fs.watch) adds a Rust `notify`-based watcher emitting Tauri events consumed by a new `useGitWatch` React hook that replaces `setInterval`. Module 3 (tests) adds Vitest to the frontend and expands server tests using patterns already established in `auth.test.ts`.

**Tech Stack:** React 18, TypeScript 5.5, Zustand 5, Tauri 2, Rust (`notify` v6), Vitest 1, `@testing-library/react` 14

---

## File Map

### Module 1 — Error Handling

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/store/toastStore.ts` | Toast queue state (Zustand, not persisted) |
| Create | `src/components/ToastContainer.tsx` | Renders toast queue; auto-dismiss logic |
| Create | `src/components/ErrorBanner.tsx` | Inline panel banner (error / warning) |
| Create | `src/hooks/useErrorHandler.ts` | Routes errors to toast or returns message for banner |
| Modify | `src/App.tsx` | Mount `<ToastContainer />` |
| Modify | `src/components/GitDiffPanel.tsx` | Replace `catch(() => {})`, add truncation banner |
| Modify | `src/components/ChangesPanel.tsx` | Replace `catch { /* ignore */ }`, use ErrorBanner for commitError |
| Modify | `src/components/GitHistoryPanel.tsx` | Replace `catch(() => {})` |
| Modify | `src/components/TerminalView.tsx` | Add ErrorBanner for PTY create failure |
| Modify | `src/components/RemoteAccessPanel.tsx` | Replace inline error string with ErrorBanner |

### Module 2 — fs.watch + Smart Polling

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src-tauri/Cargo.toml` | Add `notify = "6"` |
| Create | `src-tauri/src/git_watcher.rs` | Rust: watch `.git/` dir, emit `git-changed` events |
| Modify | `src-tauri/src/lib.rs` | Register `watch_git_dir` / `unwatch_git_dir` commands |
| Modify | `src/transport/types.ts` | Add `watchGitDir` / `unwatchGitDir` to `Transport` interface |
| Modify | `src/transport/tauri.ts` | Implement via `invoke` |
| Modify | `src/transport/websocket.ts` | No-op implementations |
| Create | `src/hooks/useGitWatch.ts` | React hook: Tauri event listener + polling fallback |
| Modify | `src/components/GitDiffPanel.tsx` | Replace `setInterval(3000)` with `useGitWatch` |
| Modify | `src/components/ChangesPanel.tsx` | Replace `setInterval(3000)` with `useGitWatch` |
| Modify | `src/App.tsx` | Call `watchGitDir` when active tab CWD changes |

### Module 3 — Tests

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `package.json` | Add vitest + @testing-library/react dev deps |
| Modify | `vite.config.ts` | Add `test` config block |
| Create | `src/test/setup.ts` | Global test setup |
| Create | `src/test/tabStore.test.ts` | Zustand store mutations |
| Create | `src/test/diff.test.ts` | Diff parser edge cases |
| Create | `server/src/test/pty-manager.test.ts` | Session TTL + reconnect |
| Create | `server/src/test/rate-limit.test.ts` | Rate limiter window + block |

---

## Module 1 — Error Handling

### Task 1: Create toastStore

**Files:**
- Create: `src/store/toastStore.ts`

- [ ] **Step 1: Write `src/store/toastStore.ts`**

```ts
// src/store/toastStore.ts
import { create } from "zustand";

export type ToastType = "info" | "warning" | "error";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (message: string, type: ToastType) => void;
  dismissToast: (id: string) => void;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (message, type) =>
    set((s) => {
      const toast: Toast = { id: makeId(), message, type };
      // Keep at most 3 visible at once; oldest drops off
      const toasts = [...s.toasts, toast].slice(-3);
      return { toasts };
    }),
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

Run: `pnpm build:frontend 2>&1 | head -20`
Expected: no errors mentioning `toastStore`

- [ ] **Step 3: Commit**

```bash
git add src/store/toastStore.ts
git commit -m "feat: add toast store for transient notifications"
```

---

### Task 2: Create ToastContainer component

**Files:**
- Create: `src/components/ToastContainer.tsx`

- [ ] **Step 1: Write `src/components/ToastContainer.tsx`**

```tsx
// src/components/ToastContainer.tsx
import { useEffect } from "react";
import { useToastStore, type Toast } from "../store/toastStore";

const COLORS: Record<Toast["type"], string> = {
  info:    "bg-zinc-800 border-zinc-600 text-zinc-100",
  warning: "bg-yellow-900/80 border-yellow-600 text-yellow-100",
  error:   "bg-red-900/80 border-red-700 text-red-100",
};

const ICONS: Record<Toast["type"], string> = {
  info: "ℹ",
  warning: "⚠",
  error: "✕",
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismissToast = useToastStore((s) => s.dismissToast);

  useEffect(() => {
    const timer = setTimeout(() => dismissToast(toast.id), 4000);
    return () => clearTimeout(timer);
  }, [toast.id, dismissToast]);

  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 rounded border text-sm shadow-lg ${COLORS[toast.type]}`}
      role="alert"
    >
      <span className="flex-shrink-0 opacity-70 mt-px">{ICONS[toast.type]}</span>
      <span className="flex-1 min-w-0 break-words">{toast.message}</span>
      <button
        onClick={() => dismissToast(toast.id)}
        className="flex-shrink-0 opacity-50 hover:opacity-100 ml-1"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Mount ToastContainer in `src/App.tsx`**

Add import at top of file:
```tsx
import { ToastContainer } from "./components/ToastContainer";
```

Inside the `return (...)` block of `App`, add `<ToastContainer />` just before the closing `</div>` of the root element. The root div currently ends at line 101. The result should look like:

```tsx
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface relative">
      {/* ... existing content unchanged ... */}
      <ToastContainer />
    </div>
  );
```

- [ ] **Step 3: Build to confirm no errors**

Run: `pnpm build:frontend 2>&1 | tail -5`
Expected: `✓ built in` line, zero errors

- [ ] **Step 4: Commit**

```bash
git add src/components/ToastContainer.tsx src/App.tsx
git commit -m "feat: add ToastContainer component and mount in App"
```

---

### Task 3: Create ErrorBanner component

**Files:**
- Create: `src/components/ErrorBanner.tsx`

- [ ] **Step 1: Write `src/components/ErrorBanner.tsx`**

```tsx
// src/components/ErrorBanner.tsx
interface ErrorBannerProps {
  message: string;
  type: "error" | "warning";
  onDismiss?: () => void;
}

const STYLES = {
  error:   "bg-red-900/40 border-red-700/60 text-red-200",
  warning: "bg-yellow-900/40 border-yellow-700/60 text-yellow-200",
};

const ICONS = {
  error: "✕",
  warning: "⚠",
};

export function ErrorBanner({ message, type, onDismiss }: ErrorBannerProps) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 border-b text-xs ${STYLES[type]}`}
      role="alert"
    >
      <span className="flex-shrink-0 opacity-70">{ICONS[type]}</span>
      <span className="flex-1 min-w-0 break-words">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="flex-shrink-0 opacity-50 hover:opacity-100 ml-1"
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build to confirm no errors**

Run: `pnpm build:frontend 2>&1 | tail -5`
Expected: `✓ built in` line

- [ ] **Step 3: Commit**

```bash
git add src/components/ErrorBanner.tsx
git commit -m "feat: add ErrorBanner component for inline panel errors"
```

---

### Task 4: Create useErrorHandler hook

**Files:**
- Create: `src/hooks/useErrorHandler.ts`

- [ ] **Step 1: Write `src/hooks/useErrorHandler.ts`**

```ts
// src/hooks/useErrorHandler.ts
import { useToastStore } from "../store/toastStore";

/** Returns helpers to route errors: git errors → toast, others → caller renders ErrorBanner */
export function useErrorHandler() {
  const addToast = useToastStore((s) => s.addToast);

  /** Show a toast for non-critical errors (git operations, etc.) */
  const toastError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    addToast(message, "error");
  };

  const toastInfo = (message: string) => addToast(message, "info");
  const toastWarning = (message: string) => addToast(message, "warning");

  /** Extract error message string (use when the component renders its own ErrorBanner) */
  const extractMessage = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);

  return { toastError, toastInfo, toastWarning, extractMessage };
}
```

- [ ] **Step 2: Build**

Run: `pnpm build:frontend 2>&1 | tail -5`
Expected: `✓ built in`

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useErrorHandler.ts
git commit -m "feat: add useErrorHandler hook for routing errors to toast/banner"
```

---

### Task 5: Wire error handling into GitDiffPanel

**Files:**
- Modify: `src/components/GitDiffPanel.tsx`

- [ ] **Step 1: Add imports to `GitDiffPanel.tsx`**

At the top of the file, after the existing imports, add:
```tsx
import { useState } from "react";
import { ErrorBanner } from "./ErrorBanner";
import { useErrorHandler } from "../hooks/useErrorHandler";
```

Note: `useState` is already imported — just add the two new component/hook imports.

- [ ] **Step 2: Add error state and hook inside the component**

Inside `GitDiffPanel`, after the existing `useState` declarations (around line 30), add:
```tsx
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const { toastError, extractMessage } = useErrorHandler();
```

- [ ] **Step 3: Replace the silent `catch` in the file-list polling effect**

Find this block (around line 36–43):
```tsx
    const fetch = async () => {
      try {
        const list = await transport.getChangedFiles(tab.path);
        setFiles(list);
      } catch {
        setFiles([]);
      }
    };
```

Replace with:
```tsx
    const fetch = async () => {
      try {
        const list = await transport.getChangedFiles(tab.path);
        setFiles(list);
        setFetchError(null);
      } catch (err) {
        setFiles([]);
        setFetchError(extractMessage(err));
      }
    };
```

- [ ] **Step 4: Replace the silent `catch` in the diff fetch effect**

Find (around line 73–79):
```tsx
      transport.getImageDiff(tab.path, selected)
        .then((result) => {
          setImageDiff(result);
          diffRef.current?.scrollTo({ top: 0 });
        })
        .catch(() => setImageDiff(null))
        .finally(() => setDiffLoading(false));
```

Replace with:
```tsx
      transport.getImageDiff(tab.path, selected)
        .then((result) => {
          setImageDiff(result);
          diffRef.current?.scrollTo({ top: 0 });
        })
        .catch((err) => {
          setImageDiff(null);
          toastError(err);
        })
        .finally(() => setDiffLoading(false));
```

- [ ] **Step 5: Read the rest of the diff fetch effect, fix the text diff catch, and wire truncation detection**

Read `src/components/GitDiffPanel.tsx` lines 80–110 to find the text diff fetch block.

Replace the `.then((raw) => { setDiffLines(parseDiffLines(raw)); ... })` and `.catch(() => setDiffLines([]))` with:
```tsx
        .then((raw) => {
          if (raw.length >= 1_000_000) setTruncated(true);
          setDiffLines(parseDiffLines(raw));
          diffRef.current?.scrollTo({ top: 0 });
        })
        .catch((err) => {
          setDiffLines([]);
          toastError(err);
        })
```

- [ ] **Step 6: Add ErrorBanner and truncation banner to JSX**

Find the `return (` of `GitDiffPanel`. At the very top of the returned `<div>`, before any other content, add:
```tsx
      {fetchError && (
        <ErrorBanner
          message={fetchError}
          type="error"
          onDismiss={() => setFetchError(null)}
        />
      )}
      {truncated && (
        <ErrorBanner
          message="Diff output truncated — file exceeds 1 MB. Use the terminal for the full diff."
          type="warning"
          onDismiss={() => setTruncated(false)}
        />
      )}
```

- [ ] **Step 7: Build and verify**

Run: `pnpm build:frontend 2>&1 | tail -5`
Expected: `✓ built in`

- [ ] **Step 8: Commit**

```bash
git add src/components/GitDiffPanel.tsx
git commit -m "feat: replace silent catches with error feedback in GitDiffPanel"
```

---

### Task 6: Wire error handling into ChangesPanel

**Files:**
- Modify: `src/components/ChangesPanel.tsx`

- [ ] **Step 1: Add imports**

Add after existing imports:
```tsx
import { ErrorBanner } from "./ErrorBanner";
import { useErrorHandler } from "../hooks/useErrorHandler";
```

- [ ] **Step 2: Add hook inside component**

After the `useState` declarations at the top of `ChangesPanel`, add:
```tsx
  const { toastError } = useErrorHandler();
```

- [ ] **Step 3: Replace silent catch in `act()`**

Find (around line 191):
```tsx
    } catch { /* ignore */ }
```

Replace with:
```tsx
    } catch (err) {
      toastError(err);
    }
```

- [ ] **Step 4: Replace silent catch in diff fetch effect**

Find (around line 169):
```tsx
        .catch(() => setImageDiff(null))
```
Replace with:
```tsx
        .catch((err) => { setImageDiff(null); toastError(err); })
```

Find (around line 176):
```tsx
        .catch(() => setDiffLines([]))
```
Replace with:
```tsx
        .catch((err) => { setDiffLines([]); toastError(err); })
```

- [ ] **Step 5: Replace inline commitError string with ErrorBanner**

`ChangesPanel` already has a `commitError` state (line 133) and renders it somewhere in the JSX. Find where `commitError` is rendered (search for `{commitError &&`) and replace the inline text rendering with:
```tsx
      {commitError && (
        <ErrorBanner
          message={commitError}
          type="error"
          onDismiss={() => setCommitError(null)}
        />
      )}
```

- [ ] **Step 6: Build**

Run: `pnpm build:frontend 2>&1 | tail -5`
Expected: `✓ built in`

- [ ] **Step 7: Commit**

```bash
git add src/components/ChangesPanel.tsx
git commit -m "feat: replace silent catches with error feedback in ChangesPanel"
```

---

### Task 7: Wire error handling into GitHistoryPanel and TerminalView

**Files:**
- Modify: `src/components/GitHistoryPanel.tsx`
- Modify: `src/components/TerminalView.tsx`

- [ ] **Step 1: Read `GitHistoryPanel.tsx` to find all `.catch(() => {})` patterns**

Run: `grep -n "catch" src/components/GitHistoryPanel.tsx`

- [ ] **Step 2: Add imports and hook to GitHistoryPanel**

Add after existing imports:
```tsx
import { useErrorHandler } from "../hooks/useErrorHandler";
```

Inside the component, add:
```tsx
  const { toastError } = useErrorHandler();
```

Replace every `.catch(() => {})` with `.catch((err) => toastError(err))`.

- [ ] **Step 3: Add ErrorBanner to TerminalView for PTY create failure**

In `TerminalView.tsx`, add import:
```tsx
import { useState } from "react"; // already imported
import { ErrorBanner } from "./ErrorBanner";
```

Add state:
```tsx
  const [ptyError, setPtyError] = useState<string | null>(null);
```

Find the PTY create call (line 166):
```tsx
    transport.ptyCreate(tabId, path, initCols, initRows).catch((err) => {
      term.writeln(`\r\n\x1b[31mConnection error: ${err?.message ?? err}\x1b[0m`);
      console.error(err);
    });
```

Replace with:
```tsx
    transport.ptyCreate(tabId, path, initCols, initRows).catch((err) => {
      const msg = err?.message ?? String(err);
      term.writeln(`\r\n\x1b[31mConnection error: ${msg}\x1b[0m`);
      setPtyError(msg);
      console.error(err);
    });
```

In the returned JSX of `TerminalView`, wrap the existing content to add the banner at top. Find the outer `<div className="flex flex-col h-full ...">` or equivalent and add before the terminal container div:
```tsx
      {ptyError && (
        <ErrorBanner
          message={`Terminal connection failed: ${ptyError}`}
          type="error"
          onDismiss={() => setPtyError(null)}
        />
      )}
```

- [ ] **Step 4: Build**

Run: `pnpm build:frontend 2>&1 | tail -5`
Expected: `✓ built in`

- [ ] **Step 5: Commit**

```bash
git add src/components/GitHistoryPanel.tsx src/components/TerminalView.tsx
git commit -m "feat: add error banners to GitHistoryPanel and TerminalView"
```

---

### Task 8: Wire error handling into RemoteAccessPanel

**Files:**
- Modify: `src/components/RemoteAccessPanel.tsx`

- [ ] **Step 1: Add ErrorBanner import**

Add after existing imports:
```tsx
import { ErrorBanner } from "./ErrorBanner";
```

- [ ] **Step 2: Replace inline error rendering**

`RemoteAccessPanel` already has `const [error, setError] = useState<string | null>(null)` (line 29) and already sets it on server death. Find where `{error && ...}` is rendered in the JSX and replace with:
```tsx
      {error && (
        <ErrorBanner
          message={error}
          type="error"
          onDismiss={() => setError(null)}
        />
      )}
```

- [ ] **Step 3: Build**

Run: `pnpm build:frontend 2>&1 | tail -5`
Expected: `✓ built in`

- [ ] **Step 4: Commit**

```bash
git add src/components/RemoteAccessPanel.tsx
git commit -m "feat: use ErrorBanner in RemoteAccessPanel for server errors"
```

---

## Module 2 — fs.watch + Smart Polling

### Task 9: Add `notify` crate and create git_watcher.rs

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/git_watcher.rs`

- [ ] **Step 1: Add `notify` dependency to `Cargo.toml`**

In `src-tauri/Cargo.toml`, after the `once_cell = "1"` line, add:
```toml
notify = "6"
```

- [ ] **Step 2: Verify `notify` resolves**

Run: `cd src-tauri && cargo fetch 2>&1 | tail -5`
Expected: Downloading crates, no errors

- [ ] **Step 3: Write `src-tauri/src/git_watcher.rs`**

```rust
// src-tauri/src/git_watcher.rs
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

struct WatchedRepo {
    _watcher: RecommendedWatcher, // field kept alive by owning this struct
    tab_ids: Vec<String>,
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
                // HEAD, index, refs/heads/*, COMMIT_EDITMSG, MERGE_HEAD
                s.contains("HEAD")
                    || s.contains("/index")
                    || s.contains("/refs/")
                    || s.contains("COMMIT_EDITMSG")
                    || s.contains("MERGE_HEAD")
            })
        }
        _ => false,
    }
}

#[tauri::command]
pub fn watch_git_dir(tab_id: String, path: String, app: AppHandle) {
    let repo_root = match find_git_root(&path) {
        Some(r) => r,
        None => return, // not a git repo, do nothing (frontend falls back to polling)
    };
    let repo_key = repo_root.to_string_lossy().to_string();

    let mut watchers = WATCHERS.lock().unwrap();

    // If we're already watching this repo, just register the additional tab
    if let Some(watched) = watchers.get_mut(&repo_key) {
        if !watched.tab_ids.contains(&tab_id) {
            watched.tab_ids.push(tab_id);
        }
        return;
    }

    // Create a new watcher for this repo
    let app_clone = app.clone();
    let repo_key_clone = repo_key.clone();

    let handler = move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            if is_relevant(&event) {
                let _ = app_clone.emit("git-changed", &repo_key_clone);
            }
        }
    };

    let mut watcher = match RecommendedWatcher::new(handler, Config::default()) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("git_watcher: failed to create watcher: {e}");
            let _ = app.emit("git-watch-failed", &repo_key);
            return;
        }
    };

    let git_dir = repo_root.join(".git");
    if let Err(e) = watcher.watch(Path::new(&git_dir), RecursiveMode::Recursive) {
        eprintln!("git_watcher: failed to watch {git_dir:?}: {e}");
        let _ = app.emit("git-watch-failed", &repo_key);
        return;
    }

    watchers.insert(
        repo_key,
        WatchedRepo {
            _watcher: watcher,
            tab_ids: vec![tab_id],
        },
    );
}

#[tauri::command]
pub fn unwatch_git_dir(tab_id: String) {
    let mut watchers = WATCHERS.lock().unwrap();
    // Remove the tab_id from every repo; drop repos with no remaining tabs
    watchers.retain(|_, watched| {
        watched.tab_ids.retain(|id| id != &tab_id);
        !watched.tab_ids.is_empty()
    });
}
```

- [ ] **Step 4: Add module declaration in `lib.rs`**

In `src-tauri/src/lib.rs`, add `mod git_watcher;` at the top, after the existing `mod` lines:
```rust
mod git;
mod git_watcher;
mod pty;
mod remote_server;
```

- [ ] **Step 5: Register commands in `lib.rs`**

In the `tauri::generate_handler![]` macro call (around line 157), add the two new commands:
```rust
            git_watcher::watch_git_dir,
            git_watcher::unwatch_git_dir,
```

- [ ] **Step 6: Compile check**

Run: `cd src-tauri && cargo check 2>&1 | grep -E "^error" | head -20`
Expected: no output (zero errors)

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/git_watcher.rs src-tauri/src/lib.rs
git commit -m "feat(rust): add notify-based git directory watcher"
```

---

### Task 10: Add watchGitDir to Transport interface and implementations

**Files:**
- Modify: `src/transport/types.ts`
- Modify: `src/transport/tauri.ts`
- Modify: `src/transport/websocket.ts`

- [ ] **Step 1: Add methods to `Transport` interface in `types.ts`**

In `src/transport/types.ts`, add two methods to the `Transport` interface, after `openUrl`:
```ts
  // Git watching (Tauri only; no-op in WebSocket mode)
  watchGitDir(tabId: string, path: string): Promise<void>;
  unwatchGitDir(tabId: string): Promise<void>;
```

- [ ] **Step 2: Implement in TauriTransport**

In `src/transport/tauri.ts`, add at the end of the class body (before the closing `}`):
```ts
  watchGitDir(tabId: string, path: string): Promise<void> {
    return invoke("watch_git_dir", { tabId, path });
  }
  unwatchGitDir(tabId: string): Promise<void> {
    return invoke("unwatch_git_dir", { tabId });
  }
```

- [ ] **Step 3: Add no-op implementations to WebSocketTransport**

In `src/transport/websocket.ts`, after `openUrl` (last method, line 162), add:
```ts
  watchGitDir(_tabId: string, _path: string): Promise<void> { return Promise.resolve(); }
  unwatchGitDir(_tabId: string): Promise<void> { return Promise.resolve(); }
```

- [ ] **Step 4: Build to confirm no TypeScript errors**

Run: `pnpm build:frontend 2>&1 | tail -5`
Expected: `✓ built in`

- [ ] **Step 5: Commit**

```bash
git add src/transport/types.ts src/transport/tauri.ts src/transport/websocket.ts
git commit -m "feat: add watchGitDir/unwatchGitDir to Transport interface"
```

---

### Task 11: Create useGitWatch hook

**Files:**
- Create: `src/hooks/useGitWatch.ts`

- [ ] **Step 1: Write `src/hooks/useGitWatch.ts`**

```ts
// src/hooks/useGitWatch.ts
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { transport } from "../transport/factory";

const IS_TAURI = typeof (window as any).__TAURI_INTERNALS__ !== "undefined";
const FALLBACK_POLL_MS = 30_000;

/**
 * Watches for git changes in `cwd` and calls `onChanged` when detected.
 *
 * In Tauri mode: registers a Rust fs.watch on `.git/`, falls back to
 * 30-second polling if the watcher fails to initialize.
 *
 * In WebSocket mode: 30-second polling that pauses when the window is hidden.
 */
export function useGitWatch(
  tabId: string,
  cwd: string | null,
  onChanged: () => void
): void {
  // Keep a ref so the interval/listener always calls the latest version
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useEffect(() => {
    if (!cwd) return;

    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let unlistenChanged: (() => void) | null = null;
    let unlistenFailed: (() => void) | null = null;
    let destroyed = false;

    const startPolling = () => {
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(() => {
        if (!destroyed && document.visibilityState !== "hidden") {
          onChangedRef.current();
        }
      }, FALLBACK_POLL_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !destroyed) {
        onChangedRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    if (IS_TAURI) {
      // Primary: Tauri fs.watch + 30s heartbeat
      transport.watchGitDir(tabId, cwd).catch(() => {/* watcher failed — Rust emits git-watch-failed */});

      listen<string>("git-changed", () => {
        if (!destroyed) onChangedRef.current();
      }).then((fn) => { unlistenChanged = fn; });

      listen<string>("git-watch-failed", () => {
        if (!destroyed) startPolling();
      }).then((fn) => { unlistenFailed = fn; });

      // Heartbeat: catches edge cases where fs events are missed
      startPolling();
    } else {
      // WebSocket mode: polling only
      startPolling();
    }

    return () => {
      destroyed = true;
      if (pollInterval) clearInterval(pollInterval);
      unlistenChanged?.();
      unlistenFailed?.();
      document.removeEventListener("visibilitychange", onVisibility);
      if (IS_TAURI) transport.unwatchGitDir(tabId).catch(() => {});
    };
  }, [tabId, cwd]);
}
```

- [ ] **Step 2: Build**

Run: `pnpm build:frontend 2>&1 | tail -5`
Expected: `✓ built in`

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useGitWatch.ts
git commit -m "feat: add useGitWatch hook (fs.watch + 30s fallback polling)"
```

---

### Task 12: Replace polling in GitDiffPanel and ChangesPanel

**Files:**
- Modify: `src/components/GitDiffPanel.tsx`
- Modify: `src/components/ChangesPanel.tsx`

- [ ] **Step 1: Update GitDiffPanel**

Add import at the top of `src/components/GitDiffPanel.tsx`:
```tsx
import { useGitWatch } from "../hooks/useGitWatch";
```

Find the polling effect (lines 33–48):
```tsx
  // Poll changed files every 3 s
  useEffect(() => {
    if (!tab?.path) return;

    const fetch = async () => {
      try {
        const list = await transport.getChangedFiles(tab.path);
        setFiles(list);
        setFetchError(null);
      } catch (err) {
        setFiles([]);
        setFetchError(extractMessage(err));
      }
    };

    fetch();
    const id = setInterval(fetch, 3000);
    return () => clearInterval(id);
  }, [tab?.path]);
```

Replace with:
```tsx
  // Fetch changed files — triggered by fs.watch (Tauri) or 30s heartbeat (WebSocket)
  const fetchFiles = async () => {
    if (!tab?.path) return;
    try {
      const list = await transport.getChangedFiles(tab.path);
      setFiles(list);
      setFetchError(null);
    } catch (err) {
      setFiles([]);
      setFetchError(extractMessage(err));
    }
  };

  useEffect(() => { fetchFiles(); }, [tab?.path]);
  useGitWatch(tabId, tab?.path ?? null, fetchFiles);
```

- [ ] **Step 2: Update ChangesPanel**

Add import at the top of `src/components/ChangesPanel.tsx`:
```tsx
import { useGitWatch } from "../hooks/useGitWatch";
```

Find the polling effect (lines 148–152):
```tsx
  // Poll every 3 s
  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refresh]);
```

Replace with:
```tsx
  useEffect(() => { refresh(); }, [refresh]);
  useGitWatch(tabId, tab?.path ?? null, refresh);
```

You can also remove `const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);` since it's no longer needed.

- [ ] **Step 3: Build**

Run: `pnpm build:frontend 2>&1 | tail -5`
Expected: `✓ built in`

- [ ] **Step 4: Commit**

```bash
git add src/components/GitDiffPanel.tsx src/components/ChangesPanel.tsx
git commit -m "perf: replace 3s polling with useGitWatch (fs.watch + smart fallback)"
```

---

### Task 13: Call watchGitDir from App on CWD change

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update `src/App.tsx` to start watching when an active tab's CWD is known**

The existing startup effect (lines 21–31) already calls `transport.getGitStatus` for all persisted tabs. Extend it to also call `watchGitDir` for each tab. Replace lines 21–31 with:

```tsx
  // On startup: eagerly populate git status + worktree info, and register watchers (Tauri only)
  useEffect(() => {
    if (!IS_TAURI) return;
    for (const tab of tabs) {
      transport.getGitStatus(tab.path)
        .then((git) => updateTab(tab.id, { git }))
        .catch(() => {});
      transport.getWorktreeMain(tab.path)
        .then((main) => updateTab(tab.id, { worktreeOf: main ?? null }))
        .catch(() => {});
      transport.watchGitDir(tab.id, tab.path).catch(() => {});
    }
    // Cleanup: unwatch all tabs on unmount
    return () => {
      for (const tab of tabs) {
        transport.unwatchGitDir(tab.id).catch(() => {});
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 2: Build**

Run: `pnpm build:frontend 2>&1 | tail -5`
Expected: `✓ built in`

- [ ] **Step 3: Do a full Tauri dev smoke test (manual)**

Run: `pnpm tauri dev`
- Open the app, verify the terminal loads
- Stage a file in a git repo, verify the Changes panel updates without waiting 3s
- Check the browser console for no uncaught errors

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: register git watchers on startup for all persisted tabs"
```

---

## Module 3 — Tests

### Task 14: Set up frontend test environment

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Create: `src/test/setup.ts`

- [ ] **Step 1: Add test dependencies to `package.json`**

In the `devDependencies` block of `package.json`, add:
```json
    "@testing-library/react": "^14",
    "@testing-library/user-event": "^14",
    "@types/node": "^20",
    "jsdom": "^24",
    "vitest": "^1"
```

Add a `test` script in `scripts`:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 2: Add test config to `vite.config.ts`**

Replace the entire file with:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    globals: true,
  },
});
```

- [ ] **Step 3: Write `src/test/setup.ts`**

```ts
// src/test/setup.ts
// Mock Tauri APIs — they don't exist in jsdom
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

// Mock xterm — it requires a real DOM canvas
vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    loadAddon: vi.fn(),
    onData: vi.fn(),
    onKey: vi.fn(),
    attachCustomKeyEventHandler: vi.fn(),
    writeln: vi.fn(),
    dispose: vi.fn(),
    cols: 80,
    rows: 24,
    focus: vi.fn(),
  })),
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: vi.fn().mockImplementation(() => ({ fit: vi.fn(), dispose: vi.fn() })) }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: vi.fn().mockImplementation(() => ({ findNext: vi.fn(), findPrevious: vi.fn() })) }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: vi.fn().mockImplementation(() => ({})) }));
```

- [ ] **Step 4: Install dependencies**

Run: `pnpm install`
Expected: packages resolved, lockfile updated

- [ ] **Step 5: Verify test runner works**

Run: `pnpm test 2>&1 | tail -10`
Expected: `No test files found` or zero test failures (no errors)

- [ ] **Step 6: Commit**

```bash
git add package.json vite.config.ts src/test/setup.ts
git commit -m "test: set up Vitest + jsdom test environment for frontend"
```

---

### Task 15: Write tabStore tests

**Files:**
- Create: `src/test/tabStore.test.ts`

- [ ] **Step 1: Write `src/test/tabStore.test.ts`**

```ts
// src/test/tabStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore } from "../store/tabStore";

// Reset store state before each test
beforeEach(() => {
  useTabStore.setState({
    tabs: [],
    activeTabId: null,
    activePanelTab: "terminal",
    sidebarMode: "docked",
  });
});

describe("addTab", () => {
  it("appends a new tab and sets it as active", () => {
    useTabStore.getState().addTab({ alias: "My Project", path: "~/code" });
    const { tabs, activeTabId } = useTabStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].alias).toBe("My Project");
    expect(tabs[0].path).toBe("~/code");
    expect(tabs[0].type).toBe("project");
    expect(activeTabId).toBe(tabs[0].id);
  });

  it("generates a unique id for each tab", () => {
    useTabStore.getState().addTab({ alias: "A", path: "~/a" });
    useTabStore.getState().addTab({ alias: "B", path: "~/b" });
    const { tabs } = useTabStore.getState();
    expect(tabs[0].id).not.toBe(tabs[1].id);
  });

  it("respects the type option", () => {
    useTabStore.getState().addTab({ alias: "API", path: "~/api", type: "backend" });
    expect(useTabStore.getState().tabs[0].type).toBe("backend");
  });
});

describe("removeTab", () => {
  it("removes the tab by id", () => {
    useTabStore.getState().addTab({ alias: "X", path: "~" });
    const id = useTabStore.getState().tabs[0].id;
    useTabStore.getState().removeTab(id);
    expect(useTabStore.getState().tabs).toHaveLength(0);
  });

  it("activates the first remaining tab when the active tab is removed", () => {
    useTabStore.getState().addTab({ alias: "A", path: "~/a" });
    useTabStore.getState().addTab({ alias: "B", path: "~/b" });
    const { tabs } = useTabStore.getState();
    // Set A as active, then remove A
    useTabStore.getState().setActiveTab(tabs[0].id);
    useTabStore.getState().removeTab(tabs[0].id);
    expect(useTabStore.getState().activeTabId).toBe(tabs[1].id);
  });

  it("sets activeTabId to null when the last tab is removed", () => {
    useTabStore.getState().addTab({ alias: "Solo", path: "~" });
    const id = useTabStore.getState().tabs[0].id;
    useTabStore.getState().removeTab(id);
    expect(useTabStore.getState().activeTabId).toBeNull();
  });
});

describe("updateTab", () => {
  it("patches the specified tab without changing others", () => {
    useTabStore.getState().addTab({ alias: "A", path: "~/a" });
    useTabStore.getState().addTab({ alias: "B", path: "~/b" });
    const { tabs } = useTabStore.getState();
    useTabStore.getState().updateTab(tabs[0].id, { alias: "Renamed" });
    const after = useTabStore.getState().tabs;
    expect(after[0].alias).toBe("Renamed");
    expect(after[1].alias).toBe("B");
  });
});

describe("setSidebarMode", () => {
  it("cycles through docked → floating → hidden", () => {
    const store = useTabStore.getState();
    store.setSidebarMode("floating");
    expect(useTabStore.getState().sidebarMode).toBe("floating");
    store.setSidebarMode("hidden");
    expect(useTabStore.getState().sidebarMode).toBe("hidden");
    store.setSidebarMode("docked");
    expect(useTabStore.getState().sidebarMode).toBe("docked");
  });
});

describe("reorderTabs", () => {
  it("moves a tab from one index to another", () => {
    useTabStore.getState().addTab({ alias: "A", path: "~/a" });
    useTabStore.getState().addTab({ alias: "B", path: "~/b" });
    useTabStore.getState().addTab({ alias: "C", path: "~/c" });
    useTabStore.getState().reorderTabs(0, 2); // move A to end
    const aliases = useTabStore.getState().tabs.map((t) => t.alias);
    expect(aliases).toEqual(["B", "C", "A"]);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm test src/test/tabStore.test.ts 2>&1 | tail -20`
Expected: All tests pass, no failures

- [ ] **Step 3: Commit**

```bash
git add src/test/tabStore.test.ts
git commit -m "test: add tabStore unit tests covering add/remove/update/reorder"
```

---

### Task 16: Write diff parser tests

**Files:**
- Create: `src/test/diff.test.ts`

- [ ] **Step 1: Read `src/utils/diff.tsx` to understand the `parseDiffLines` signature**

Run: `grep -n "export\|parseDiffLines\|isImageFile\|DiffLine" src/utils/diff.tsx | head -30`

- [ ] **Step 2: Write `src/test/diff.test.ts`**

```ts
// src/test/diff.test.ts
import { describe, it, expect } from "vitest";
import { parseDiffLines, isImageFile } from "../utils/diff";

describe("isImageFile", () => {
  it("detects common image extensions", () => {
    expect(isImageFile("photo.png")).toBe(true);
    expect(isImageFile("icon.jpg")).toBe(true);
    expect(isImageFile("logo.svg")).toBe(true);
    expect(isImageFile("animation.gif")).toBe(true);
    expect(isImageFile("thumbnail.webp")).toBe(true);
    expect(isImageFile("cover.avif")).toBe(true);
  });

  it("returns false for non-image files", () => {
    expect(isImageFile("README.md")).toBe(false);
    expect(isImageFile("index.ts")).toBe(false);
    expect(isImageFile("data.json")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isImageFile("ICON.PNG")).toBe(true);
    expect(isImageFile("Photo.JPG")).toBe(true);
  });
});

describe("parseDiffLines", () => {
  const simpleDiff = `--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 const x = 1;
-const y = 2;
+const y = 3;
+const z = 4;
 export { x };`;

  it("parses added lines with type 'add'", () => {
    const lines = parseDiffLines(simpleDiff);
    const added = lines.filter((l) => l.type === "add");
    expect(added.length).toBeGreaterThan(0);
    expect(added.some((l) => l.content.includes("const y = 3"))).toBe(true);
  });

  it("parses removed lines with type 'del'", () => {
    const lines = parseDiffLines(simpleDiff);
    const removed = lines.filter((l) => l.type === "del");
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.some((l) => l.content.includes("const y = 2"))).toBe(true);
  });

  it("parses context lines with type 'ctx'", () => {
    const lines = parseDiffLines(simpleDiff);
    const ctx = lines.filter((l) => l.type === "ctx");
    expect(ctx.length).toBeGreaterThan(0);
  });

  it("returns empty array for empty input", () => {
    expect(parseDiffLines("")).toEqual([]);
  });

  it("handles new file diff (no --- header)", () => {
    const newFileDiff = `--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const hello = "world";
+export default hello;`;
    const lines = parseDiffLines(newFileDiff);
    const added = lines.filter((l) => l.type === "add");
    expect(added.length).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm test src/test/diff.test.ts 2>&1 | tail -20`
Expected: All tests pass

If a test fails because `parseDiffLines` uses a different property name than `type`/`content`, read the actual `DiffLine` type from `src/utils/diff.tsx` and adjust the test assertions to match.

- [ ] **Step 4: Commit**

```bash
git add src/test/diff.test.ts
git commit -m "test: add diff parser unit tests"
```

---

### Task 17: Write server pty-manager tests

**Files:**
- Create: `server/src/test/pty-manager.test.ts`

- [ ] **Step 1: Write `server/src/test/pty-manager.test.ts`**

```ts
// server/src/test/pty-manager.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock node-pty before importing the module under test
vi.mock("node-pty", () => ({
  default: { spawn: vi.fn() },
  spawn: vi.fn(),
}));

// Mock fs so shell detection doesn't hit the real filesystem
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    accessSync: vi.fn(), // always succeeds → /bin/zsh is considered valid
    statSync: vi.fn().mockReturnValue({ isDirectory: () => true }),
  };
});

import * as nodePty from "node-pty";
import {
  createSession,
  attachSession,
  detachSession,
  writeToSession,
  killSession,
} from "../pty-manager";
import type WebSocket from "ws";

function makeMockPty() {
  const onDataCallbacks: Array<(data: string) => void> = [];
  const onExitCallbacks: Array<() => void> = [];
  return {
    onData: vi.fn((cb: (data: string) => void) => {
      onDataCallbacks.push(cb);
      return { dispose: vi.fn() };
    }),
    onExit: vi.fn((cb: () => void) => { onExitCallbacks.push(cb); }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    _triggerData: (d: string) => onDataCallbacks.forEach((cb) => cb(d)),
    _triggerExit: () => onExitCallbacks.forEach((cb) => cb()),
  };
}

function makeMockWs(): WebSocket {
  return {
    send: vi.fn(),
    readyState: 1, // OPEN
    close: vi.fn(),
  } as unknown as WebSocket;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createSession", () => {
  it("creates a PTY and sends pty-ready to the WebSocket", () => {
    const mockPty = makeMockPty();
    vi.mocked(nodePty.spawn).mockReturnValue(mockPty as any);
    const ws = makeMockWs();

    createSession("tab-1", "~/code", 80, 24, ws);

    expect(nodePty.spawn).toHaveBeenCalledOnce();
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: "pty-ready" }));
  });

  it("forwards PTY output to the WebSocket", () => {
    const mockPty = makeMockPty();
    vi.mocked(nodePty.spawn).mockReturnValue(mockPty as any);
    const ws = makeMockWs();

    createSession("tab-2", "~", 80, 24, ws);
    mockPty._triggerData("hello world");

    expect(ws.send).toHaveBeenCalledWith("hello world");
  });
});

describe("detachSession + TTL", () => {
  it("kills the PTY after SESSION_TTL_MS (30s) when detached", () => {
    const mockPty = makeMockPty();
    vi.mocked(nodePty.spawn).mockReturnValue(mockPty as any);
    const ws = makeMockWs();

    createSession("tab-ttl", "~", 80, 24, ws);
    detachSession("tab-ttl");

    expect(mockPty.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(mockPty.kill).toHaveBeenCalledOnce();
  });

  it("does not kill PTY if reattached within TTL", () => {
    const mockPty = makeMockPty();
    vi.mocked(nodePty.spawn).mockReturnValue(mockPty as any);
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();

    createSession("tab-reattach", "~", 80, 24, ws1);
    detachSession("tab-reattach");

    // Reconnect after 10s (within 30s TTL)
    vi.advanceTimersByTime(10_000);
    const reattached = attachSession("tab-reattach", ws2);

    expect(reattached).toBe(true);
    vi.advanceTimersByTime(30_000); // advance past original TTL
    expect(mockPty.kill).not.toHaveBeenCalled();
  });
});

describe("attachSession", () => {
  it("returns false when session does not exist", () => {
    expect(attachSession("nonexistent", makeMockWs())).toBe(false);
  });
});

describe("killSession", () => {
  it("kills the PTY immediately and removes the session", () => {
    const mockPty = makeMockPty();
    vi.mocked(nodePty.spawn).mockReturnValue(mockPty as any);
    const ws = makeMockWs();

    createSession("tab-kill", "~", 80, 24, ws);
    killSession("tab-kill");

    expect(mockPty.kill).toHaveBeenCalledOnce();
    // Session is gone — attach returns false
    expect(attachSession("tab-kill", makeMockWs())).toBe(false);
  });
});
```

- [ ] **Step 2: Run server tests**

Run: `cd server && npm test 2>&1 | tail -20`
Expected: All tests pass (auth.test.ts + new pty-manager.test.ts)

If `nodePty.spawn` mock isn't picked up correctly (default vs named export), adjust the mock:
```ts
vi.mock("node-pty", () => ({
  spawn: vi.fn(),
}));
// and import as: import { spawn } from "node-pty";
```

Read the top of `pty-manager.ts` to confirm: `import * as pty from "node-pty"` — the mock above matches this.

- [ ] **Step 3: Commit**

```bash
cd server && git add src/test/pty-manager.test.ts && cd ..
git add server/src/test/pty-manager.test.ts
git commit -m "test: add pty-manager session lifecycle tests"
```

---

### Task 18: Write server rate-limiter tests

**Files:**
- Create: `server/src/test/rate-limit.test.ts`

- [ ] **Step 1: Write `server/src/test/rate-limit.test.ts`**

```ts
// server/src/test/rate-limit.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRateLimiter } from "../middleware/rate-limit";
import type { Request, Response, NextFunction } from "express";

function makeReq(ip = "1.2.3.4"): Request {
  return { ip, socket: { remoteAddress: ip } } as any;
}

function makeRes(): Response & { _status: number; _body: unknown } {
  const res: any = {};
  res._status = 200;
  res._body = null;
  res.status = vi.fn((code: number) => { res._status = code; return res; });
  res.json = vi.fn((body: unknown) => { res._body = body; return res; });
  Object.defineProperty(res, "statusCode", {
    get: () => res._status,
    set: (v: number) => { res._status = v; },
  });
  return res;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("createRateLimiter", () => {
  it("allows requests under the failure threshold", () => {
    const mw = createRateLimiter(5, 60_000, 60_000);
    const next = vi.fn() as unknown as NextFunction;

    // 4 failed attempts — should all call next()
    for (let i = 0; i < 4; i++) {
      const res = makeRes();
      mw(makeReq(), res, next);
      res.status(401);
      res.json({ error: "Unauthorized" });
    }

    // 5th request — should still pass (block triggers on 5th *recorded* failure)
    const res5 = makeRes();
    mw(makeReq(), res5, vi.fn() as unknown as NextFunction);
    expect(res5._status).not.toBe(429);
  });

  it("blocks after maxAttempts failures within the window", () => {
    const mw = createRateLimiter(5, 60_000, 60_000);

    // Trigger 5 failures
    for (let i = 0; i < 5; i++) {
      const res = makeRes();
      mw(makeReq(), res, vi.fn() as unknown as NextFunction);
      res.status(401);
      res.json({ error: "Unauthorized" });
    }

    // Next request should be blocked
    const res = makeRes();
    mw(makeReq(), res, vi.fn() as unknown as NextFunction);
    expect(res._status).toBe(429);
  });

  it("unblocks after blockMs expires", () => {
    const mw = createRateLimiter(5, 60_000, 60_000);

    for (let i = 0; i < 5; i++) {
      const res = makeRes();
      mw(makeReq(), res, vi.fn() as unknown as NextFunction);
      res.status(401);
      res.json({ error: "Unauthorized" });
    }

    // Advance past the 60s block window
    vi.advanceTimersByTime(61_000);

    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    mw(makeReq(), res, next);
    expect(next).toHaveBeenCalled();
    expect(res._status).not.toBe(429);
  });

  it("tracks IPs independently", () => {
    const mw = createRateLimiter(5, 60_000, 60_000);

    // Block IP A
    for (let i = 0; i < 5; i++) {
      const res = makeRes();
      mw(makeReq("1.1.1.1"), res, vi.fn() as unknown as NextFunction);
      res.status(401);
      res.json({ error: "Unauthorized" });
    }

    // IP B should be unaffected
    const resB = makeRes();
    const nextB = vi.fn() as unknown as NextFunction;
    mw(makeReq("2.2.2.2"), resB, nextB);
    expect(nextB).toHaveBeenCalled();
    expect(resB._status).not.toBe(429);

    // IP A should be blocked
    const resA = makeRes();
    mw(makeReq("1.1.1.1"), resA, vi.fn() as unknown as NextFunction);
    expect(resA._status).toBe(429);
  });
});
```

- [ ] **Step 2: Run all server tests**

Run: `cd server && npm test 2>&1 | tail -20`
Expected: All tests pass (auth + pty-manager + rate-limit)

- [ ] **Step 3: Run all frontend tests**

Run: `pnpm test 2>&1 | tail -20`
Expected: All tests pass (tabStore + diff)

- [ ] **Step 4: Commit**

```bash
git add server/src/test/rate-limit.test.ts
git commit -m "test: add rate-limiter tests covering block/unblock/IP isolation"
```

---

## Final Verification

- [ ] **Full frontend build**

Run: `pnpm build:frontend 2>&1 | tail -5`
Expected: `✓ built in`

- [ ] **All frontend tests**

Run: `pnpm test 2>&1 | tail -10`
Expected: all pass

- [ ] **All server tests**

Run: `cd server && npm test 2>&1 | tail -10`
Expected: all pass

- [ ] **Cargo check**

Run: `cd src-tauri && cargo check 2>&1 | grep "^error" | wc -l`
Expected: `0`

- [ ] **Final commit**

```bash
git commit --allow-empty -m "chore: all quality & performance modules complete"
```
