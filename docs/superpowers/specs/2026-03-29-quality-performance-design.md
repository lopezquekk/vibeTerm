# vibeTerm — Quality & Performance Improvements

**Date:** 2026-03-29
**Status:** Approved
**Scope:** Error handling, fs.watch + smart polling, critical path tests

---

## Context

vibeTerm is a Tauri 2 desktop terminal workspace with React frontend, Rust backend, and an optional Node.js WebSocket server for remote access. The codebase is well-architected and secure, but has three clear gaps:

1. Errors are silently swallowed — users get no feedback when git/PTY/remote operations fail
2. Git status polling runs every 3s unconditionally — wastes CPU and battery
3. Zero frontend tests and incomplete server tests — changes to critical paths are unvalidated

---

## Approach

Three independent modules delivered in sequence, each verifiable before the next begins.

**Order:** Error Handling → fs.watch + Polling → Tests

---

## Module 1: Error Handling

### Goal

Replace all silent `catch(() => {})` with user-visible feedback. Errors that block the user's workflow appear as banners; background errors appear as dismissible toasts.

### Components

**`src/components/Toast.tsx`**
- Dismissible notification component (auto-dismiss after 4s, manual ✕)
- Types: `info`, `warning`, `error`
- Position: bottom-right corner (never overlaps terminal)
- Max 3 visible simultaneously; excess queued

**`src/components/ToastContainer.tsx`**
- Renders the toast queue from `toastStore`
- Mounted once at App root

**`src/store/toastStore.ts`**
- Zustand store (not persisted): `toasts[]`, `addToast()`, `dismissToast()`

**`src/components/ErrorBanner.tsx`**
- Inline banner rendered inside the relevant panel
- Props: `message: string`, `type: 'error' | 'warning'`, `onDismiss?: () => void`
- Red for critical errors (blocks workflow), yellow for warnings (informational)

**`src/hooks/useErrorHandler.ts`**
- `handleError(err: unknown, context: ErrorContext): void`
- Context values: `'git' | 'pty' | 'remote' | 'transport'`
- Routing:
  - `pty` / `transport` → ErrorBanner (critical, blocks terminal)
  - `remote` → ErrorBanner (server died)
  - `git` → toast (non-blocking, informational)

### Changes to Existing Code

| File | Change |
|------|--------|
| `GitDiffPanel.tsx` | Replace `catch(() => {})` with `handleError(err, 'git')` |
| `ChangesPanel.tsx` | Replace `catch(() => {})` with `handleError(err, 'git')` |
| `GitHistoryPanel.tsx` | Replace `catch(() => {})` with `handleError(err, 'git')` |
| `TerminalView.tsx` | Add ErrorBanner when PTY fails to create or reconnect |
| `RemoteAccessPanel.tsx` | Add ErrorBanner when Node.js server dies |
| `GitDiffPanel.tsx` | Add warning banner when diff output is truncated at 1MB |

### Error Routing Table

| Scenario | Component | Type |
|----------|-----------|------|
| Git command fails | Toast | error |
| Git output truncated (>1MB) | ErrorBanner | warning |
| PTY failed to start | ErrorBanner | error |
| PTY disconnected | ErrorBanner | error |
| Remote server died | ErrorBanner | error |
| Remote server reconnecting | Toast | info |
| Branch checkout failed | Toast | error |
| Stage/unstage failed | Toast | error |

---

## Module 2: fs.watch + Smart Polling

### Goal

Replace the unconditional 3s polling interval with real-time file-system watching in Tauri mode. In WebSocket (remote) mode, reduce polling to 30s and pause when the window is not focused.

### Backend — Rust

**New file: `src-tauri/src/git_watcher.rs`**
- Uses the `notify` crate (v6, async-friendly) to watch `.git/HEAD`, `.git/index`, `.git/refs/`
- Global watcher registry: `Mutex<HashMap<String, Watcher>>` keyed by repo root path — prevents duplicate watchers when multiple tabs share the same repo
- On change detected → emit Tauri event `git-changed` with payload `{ tab_id: String, path: String }`
- On `notify` initialization failure → log warning, emit `git-watch-failed` event so frontend can activate polling fallback

**New Tauri commands:**
- `watch_git_dir(tab_id: String, path: String)` — register watcher for a path
- `unwatch_git_dir(tab_id: String)` — deregister watcher

**`Cargo.toml` additions:**
```toml
notify = "6"
```

### Frontend — Hook

**New file: `src/hooks/useGitWatch.ts`**

```
useGitWatch(tabId, cwd, onChanged)
  In Tauri mode:
    - Calls transport.watchGitDir(tabId, cwd) on mount
    - Listens for "git-changed" Tauri event → calls onChanged()
    - Listens for "git-watch-failed" → activates 30s fallback polling
    - Pauses fallback polling on document visibilitychange (hidden)
    - Calls transport.unwatchGitDir(tabId) on unmount
  In WebSocket mode:
    - 30s polling interval (not 3s)
    - Pauses when document.visibilityState === 'hidden'
    - Resumes immediately on visibility restored
```

**Transport interface additions (`src/transport/types.ts`):**
```ts
watchGitDir(tabId: string, path: string): Promise<void>
unwatchGitDir(tabId: string): Promise<void>
```

- Tauri transport: implements via `invoke('watch_git_dir', ...)`
- WebSocket transport: no-op (polling handles it)

### Changes to Existing Code

| File | Change |
|------|--------|
| `GitDiffPanel.tsx:46` | Replace `setInterval(3000)` with `useGitWatch` hook |
| `App.tsx` | Call `watchGitDir` when active tab's CWD changes (OSC 7 event) |
| `src/transport/types.ts` | Add `watchGitDir` and `unwatchGitDir` to interface |
| `src/transport/tauri.ts` | Implement `watchGitDir`/`unwatchGitDir` via invoke |
| `src/transport/websocket.ts` | No-op implementations |

### Flow

```
CWD changes (OSC 7 escape sequence)
  → App.tsx: transport.watchGitDir(tabId, newCwd)
  → Rust: notify::watcher.watch(".git/HEAD", .git/index, .git/refs/)
  → File changes in .git/
  → notify fires callback
  → Tauri emit "git-changed" { tab_id, path }
  → Frontend: onChanged() → re-fetch git status + diff
  → UI updates in <100ms

If notify fails to initialize:
  → Tauri emit "git-watch-failed"
  → Frontend: activate 30s polling fallback
  → Pause polling when window hidden
```

---

## Module 3: Critical Path Tests

### Goal

~70% coverage of critical paths. No full component render tests (high maintenance, low value). Focus: logic that processes external data or manages state.

### Frontend Tests — `src/test/`

**`transport.test.ts`**
- Mock `@tauri-apps/api/core` invoke and WebSocket global
- `factory.ts` selects correct transport based on `window.__TAURI_INTERNALS__`
- WebSocket transport: reconnection with exponential backoff
- WebSocket transport: write queue drains after reconnect
- WebSocket transport: 401 response triggers token re-read from URL hash
- Tauri transport: invoke calls map to correct command names

**`tabStore.test.ts`**
- Create tab: generates unique ID, appends to list, sets as active
- Close tab: removes tab, selects adjacent tab, handles last-tab edge case
- Rename tab: updates name in-place, does not change ID
- Sidebar mode toggle: cycles through docked → floating → hidden
- Worktree grouping: tabs in same repo root grouped together
- localStorage persistence: store hydrates correctly on reload

**`diff.test.ts`**
- Unified diff parsing: added lines, removed lines, context lines
- New file diff (no `---` header): parsed correctly
- Binary file diff: returns empty hunks, sets `isBinary: true`
- Renamed file diff: captures old and new paths
- Image file detection: PNG, JPG, SVG, GIF, WEBP, AVIF all detected
- Truncation threshold: diff >1MB triggers `isTruncated: true`

### Server Tests — `server/src/test/`

**`pty-manager.test.ts`**
- Session created: stored with correct tabId and timestamp
- Session reconnect within TTL: returns existing PTY, resets TTL timer
- Session TTL expiry: PTY killed after 30s of no WebSocket connection
- Concurrent sessions: multiple sessions independent, no cross-contamination
- Mock: `node-pty` spawn mocked, no real processes created

**`rate-limit.test.ts`**
- Under limit: 4 failures → request proceeds
- At limit: 5th failure → 429 response
- Block expires: after 60s window, counter resets
- Per-IP isolation: IP A blocked does not affect IP B
- Uses fake timers (vitest `vi.useFakeTimers`) for 60s window

**Existing (keep):** `auth.test.ts` ✅

### Test Setup

**Frontend (`package.json` additions):**
```json
"@testing-library/react": "^14",
"@testing-library/user-event": "^14",
"jsdom": "^24",
"vitest": "^1"
```

**`vite.config.ts` additions:**
```ts
test: {
  environment: 'jsdom',
  setupFiles: ['src/test/setup.ts'],
  globals: true
}
```

---

## Delivery Sequence

1. **Module 1 — Error Handling**
   - New files: `Toast.tsx`, `ToastContainer.tsx`, `toastStore.ts`, `ErrorBanner.tsx`, `useErrorHandler.ts`
   - Modified: `GitDiffPanel.tsx`, `ChangesPanel.tsx`, `GitHistoryPanel.tsx`, `TerminalView.tsx`, `RemoteAccessPanel.tsx`, `App.tsx` (mount ToastContainer)

2. **Module 2 — fs.watch**
   - New files: `src-tauri/src/git_watcher.rs`, `src/hooks/useGitWatch.ts`
   - Modified: `Cargo.toml`, `src-tauri/src/lib.rs`, `GitDiffPanel.tsx`, `App.tsx`, `transport/types.ts`, `transport/tauri.ts`, `transport/websocket.ts`

3. **Module 3 — Tests**
   - New files: `src/test/transport.test.ts`, `src/test/tabStore.test.ts`, `src/test/diff.test.ts`, `server/src/test/pty-manager.test.ts`, `server/src/test/rate-limit.test.ts`
   - Modified: `package.json` (frontend), `vite.config.ts`

---

## Non-Goals

- Full component render tests (snapshot tests)
- Git Stash / Reflog UI (separate scope)
- Submodule support
- Changes to security model
- Windows/Linux support (macOS only per current README)
