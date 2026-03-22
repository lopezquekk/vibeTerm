# VibeTerm Remote Access — Design Spec

**Date:** 2026-03-22
**Status:** Approved

---

## Goal

Allow the user to access and control VibeTerm from their mobile phone (iOS/Android browser) from anywhere via the internet, with the full UI: terminals, git diff, git history, and changes panel.

---

## Constraints & Decisions

- **Full UI** — all four panels (Terminal, Git Diff, Git History, Changes) must work on mobile.
- **Independent sessions** — mobile has its own PTY sessions, separate from the desktop ones.
- **Integrated toggle** — remote access is activated from within the VibeTerm desktop UI, not a separate manual step.
- **Anywhere access** — works outside home network via Tailscale (free, P2P, private).
- **Approach** — Node.js child process spawned by Tauri, serving the React build + WebSocket PTY + REST git API.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Mac (VibeTerm desktop)                             │
│                                                     │
│  ┌──────────────┐   spawn/control   ┌─────────────┐ │
│  │  Tauri app   │ ────────────────► │  web-server │ │
│  │  (Rust)      │ ◄── status/port ─ │  (Node.js)  │ │
│  └──────────────┘                   │             │ │
│        ▲                            │  node-pty   │ │
│   Tauri IPC                         │  WebSocket  │ │
│        │                            │  HTTP :7788 │ │
│  ┌─────┴──────┐                     └─────────────┘ │
│  │  React UI  │                            ▲         │
│  │ (desktop)  │                       Tailscale      │
└──┴────────────┴────────────────────────────┼─────────┘
                                             │
                                    ┌────────┴──────┐
                                    │  Mobile        │
                                    │  Safari/Chrome │
                                    │  (web UI)      │
                                    └───────────────┘
```

---

## Components

### 1. Transport Abstraction Layer (`src/transport/`)

A new abstraction that decouples UI components from the communication mechanism. The interface must cover **all** existing Tauri commands:

```typescript
// src/transport/index.ts
interface Transport {
  // PTY
  // ptyCreate resolves only after the server sends a {"type":"pty-ready"} frame
  // (or rejects with an error message from {"type":"pty-error","message":...}).
  ptyCreate(tabId: string, cwd: string, cols: number, rows: number): Promise<void>
  // ptyWrite and ptyResize queue data internally if the WS is not OPEN,
  // and flush the queue when the connection is re-established.
  ptyWrite(tabId: string, data: string): void
  ptyResize(tabId: string, cols: number, rows: number): void
  ptyClose(tabId: string): Promise<void>
  onPtyData(tabId: string, cb: (data: string) => void): () => void
  onPtyExit(tabId: string, cb: () => void): () => void

  // Git — working tree
  getChangedFiles(path: string): Promise<ChangedFile[]>
  getWorkdirStatus(path: string): Promise<WorkdirStatus>
  getFileDiff(path: string, file: string): Promise<string>
  getStagedFileDiff(path: string, file: string): Promise<string>
  getImageDiff(path: string, file: string): Promise<ImageDiff>
  stageFile(path: string, file: string): Promise<void>
  unstageFile(path: string, file: string): Promise<void>
  discardFile(path: string, file: string): Promise<void>
  stageAll(path: string): Promise<void>
  commit(path: string, message: string): Promise<void>

  // Git — history
  getHistory(path: string): Promise<Commit[]>
  getCommitFiles(path: string, hash: string): Promise<CommitFile[]>
  getCommitFileDiff(path: string, hash: string, file: string): Promise<string>
  getCommitImageDiff(path: string, hash: string, file: string): Promise<ImageDiff>

  // Git — branches
  getBranches(path: string): Promise<Branch[]>
  switchBranch(path: string, branch: string): Promise<void>
  createBranch(path: string, name: string): Promise<void>

  // Worktrees
  getWorktreeMain(path: string): Promise<string | null>

  // System
  openUrl(url: string): Promise<void>  // web: window.open(url, '_blank')
}
```

- `src/transport/tauri.ts` — existing `invoke`-based implementation (refactored from current hooks/components)
- `src/transport/websocket.ts` — new WebSocket + fetch implementation for browser
- `src/transport/factory.ts` — exports `transport` singleton:
  ```typescript
  export const transport: Transport =
    typeof window.__TAURI__ !== 'undefined'
      ? new TauriTransport()
      : new WebSocketTransport()
  ```

All existing hooks (`usePty`, `useGitDiff`, `useGitHistory`, `useChanges`, etc.) are updated to call `transport.xxx` instead of `invoke` directly. Logic and UI are untouched.

**`@tauri-apps/api` in browser context:** The package gracefully no-ops when `window.__TAURI__` is absent — it will never be called on the web path since the factory routes to `WebSocketTransport` in that case.

---

### 2. Node.js Web Server (`server/`)

```
server/
  src/
    index.ts          ← entry point: HTTP + WebSocket + startup signal
    pty-manager.ts    ← PTY session lifecycle with node-pty
    git-handler.ts    ← git operations via child_process
    middleware/
      auth.ts         ← token validation middleware
      rate-limit.ts   ← brute-force protection
    routes/
      static.ts       ← serves ../dist/ (React build)
      ws.ts           ← WebSocket handler for PTY I/O + resize
      git.ts          ← REST endpoints for git operations
  package.json        ← node-pty, ws, express, @types/*
  tsconfig.json       ← compiles to server/dist/
```

**Build:** The server TypeScript is compiled to `server/dist/` as part of `pnpm build`. The Tauri `beforeBuildCommand` must run `pnpm build:server && pnpm build:frontend`. The compiled `server/dist/` and `server/node_modules/` are bundled into the `.app` via `tauri.conf.json` `bundle.resources`.

**Startup signal:** On successful listen, the server writes a single JSON line to stdout:
```json
{"status":"ready","port":7788}
```
The Rust controller reads this line to confirm the server is up (see Section 3).

#### PTY over WebSocket

- WS endpoint: `ws://host:7788/pty?sessionId=<uuid>&cwd=<encoded>&token=<token>`
- Token is validated on the handshake upgrade request. Invalid token → HTTP 401, connection rejected.
- Server maps `sessionId → IPty` instance.
- Input from client: raw UTF-8 string frames → `pty.write(data)`
- Output from PTY: raw UTF-8 string frames → `ws.send(data)`
- Resize: JSON frame `{ type: "resize", cols: N, rows: N }`
- If `cwd` is absent, defaults to the user's home directory (`os.homedir()`).

**PTY session lifecycle:**
- On WS `close`: a 30-second TTL timer starts.
- If the client reconnects with the same `sessionId` before the timer fires → timer cancelled, existing PTY reattached.
- If the timer fires → `pty.kill()`, session removed. This handles mobile tab suspension and network drops.

**WebSocket reconnection (client side, `WebSocketTransport`):**
- On `close` or `error`: retry with exponential backoff (1s, 2s, 4s, 8s… cap at 30s).
- xterm.js displays a status overlay ("Reconnecting…") during the gap.

#### Git REST API

All endpoints require `Authorization: Bearer <token>` header. POST endpoints require `Content-Type: application/json` (CSRF barrier).

The `path` parameter on every endpoint is validated against an allowlist of permitted root paths passed by the Rust controller at server startup. Requests with a `path` outside the allowlist return 403.

```
GET  /api/git/status?path=...
GET  /api/git/changed-files?path=...
GET  /api/git/file-diff?path=...&file=...
GET  /api/git/staged-file-diff?path=...&file=...
GET  /api/git/image-diff?path=...&file=...         → { before: base64, after: base64, ext: string }
GET  /api/git/history?path=...
GET  /api/git/commit-files?path=...&hash=...
GET  /api/git/commit-file-diff?path=...&hash=...&file=...
GET  /api/git/commit-image-diff?path=...&hash=...&file=...
GET  /api/git/branches?path=...
POST /api/git/stage       { path, file }
POST /api/git/unstage     { path, file }
POST /api/git/discard     { path, file }
POST /api/git/stage-all   { path }
POST /api/git/commit      { path, message }
POST /api/git/switch-branch  { path, branch }
POST /api/git/create-branch  { path, name }
GET  /api/git/worktree-main?path=...
```

**`ImageDiff` JSON schema:**
```json
{ "before": "<base64-encoded-bytes | null>", "after": "<base64-encoded-bytes | null>", "ext": "png" }
```
This matches the Rust `ImageDiff` struct serialized with `serde_json`. The React image diff component consumes the same shape regardless of transport.

#### Security

- **Token:** 16-byte cryptographically random hex string, generated fresh on each server start.
- **Token in URL:** The QR code encodes `http://host:7788/#token=<token>` — the fragment is never sent to the server or logged. On first load, the React app reads the token from `location.hash`, stores it in `sessionStorage`, then replaces the URL without the fragment. **Known limitation:** `sessionStorage` is per-tab and cleared in private browsing; if the user opens a new tab or refreshes after the fragment is gone, they must re-scan the QR code. This is accepted behavior.
- **Token regeneration:** The Rust controller generates a new 16-byte token, sends it to the running Node process via stdin as `{"type":"rotate-token","token":"<new>"}`, and returns the new value. The Node server's stdin reader atomically swaps the active token; in-flight requests using the old token complete normally, subsequent ones require the new token. Existing WS connections are dropped.
- **Brute-force protection:** After 5 failed token attempts from any single IP within 60 seconds, that IP is blocked for 60 seconds. Implemented in `middleware/rate-limit.ts`.
- **Path allowlist:** Passed at startup as `--allowed-paths <json-array>`. Additionally, a `POST /api/control/add-path` endpoint (protected by token) allows the Rust controller to add new paths at runtime as the user opens new tabs — called via `invoke('add_remote_allowed_path', path)` when a new tab is created while the server is running.
- **CORS:** Express is configured with `cors({ origin: false })` — cross-origin requests are blocked. The `Authorization` header is the sole access control.
- **Response size limit:** All git diff endpoints truncate output at 1 MB, returning `{ content: "...", truncated: true }` when the limit is hit. This matches graceful degradation for large files on mobile.

---

### 3. Tauri Remote Server Controller (`src-tauri/src/remote_server.rs`)

**Managed state** — registered in `setup` via `app.manage(Mutex::new(RemoteServer::default()))`. All commands take `State<'_, Mutex<RemoteServer>>`.

```rust
pub struct RemoteServer {
    child: Option<Child>,
    port: u16,
    token: String,
}

impl Default for RemoteServer { ... }

impl Drop for RemoteServer {
    fn drop(&mut self) { self.stop(); }  // ensures server dies with the app
}
```

**Node.js binary resolution** — in order of preference:
1. `VIBETERM_NODE_PATH` env var (dev override)
2. Bundled binary at `<resource_dir>/node/bin/node` (production)
3. Known Homebrew paths: `/opt/homebrew/bin/node`, `/usr/local/bin/node`
4. `which node` fallback

If none found → `start_remote_server` returns a user-friendly error: `"Node.js not found. Install it from nodejs.org or via Homebrew."`

**`server/dist/` path resolution:**
- Dev (`#[cfg(debug_assertions)]`): `<workspace_root>/server/dist/index.js`
- Prod: `app_handle.path().resource_dir()? / "server/dist/index.js"`

**Startup handshake:**
```rust
#[tauri::command]
pub async fn start_remote_server(
    state: State<'_, Mutex<RemoteServer>>,
    app: AppHandle,
) -> Result<ServerInfo, String> {
    // Lock mutex for the ENTIRE duration of spawn + handshake to prevent concurrent calls.
    // If already running → return current ServerInfo immediately (idempotent).
    // Spawn with piped stdout/stderr.
    // Read one line from stdout with 5-second timeout.
    // Parse {"status":"ready","port":N} → confirm running.
    // On {"status":"error","message":...} → return Err(message).
    // Store child + token + stdin handle in state.
    // Spawn a background task that watches child.wait() and emits
    //   a Tauri event "remote-server-died" when the process exits unexpectedly.
    // return ServerInfo { port, token, local_ip, tailscale_ip }
}

#[tauri::command]
pub fn stop_remote_server(state: State<'_, Mutex<RemoteServer>>) -> Result<(), String>

#[tauri::command]
pub fn get_remote_server_status(state: State<'_, Mutex<RemoteServer>>) -> ServerStatus
// Uses child.try_wait() to detect if process has died; returns { running: false } if so.

#[tauri::command]
pub async fn regenerate_remote_token(
    state: State<'_, Mutex<RemoteServer>>,
) -> Result<String, String>
// Writes {"type":"rotate-token","token":"<new-16-byte-hex>"} to child stdin.
// Updates token in state.
// Returns new token.

#[tauri::command]
pub async fn add_remote_allowed_path(
    state: State<'_, Mutex<RemoteServer>>,
    path: String,
) -> Result<(), String>
// Sends {"type":"add-path","path":"<path>"} to child stdin.
// Called when user opens a new tab while server is running.
```

**Server crash detection:** The background task watching `child.wait()` emits a Tauri event `"remote-server-died"`. The React Remote Access Panel listens for this event and transitions the toggle to OFF with an inline error message.

**Port conflict handling:** If the Node server fails to bind port 7788, it writes `{"status":"error","message":"port in use"}` to stdout and exits. The Rust controller reads this, returns an error, and the UI shows "Port 7788 is already in use."

**IP detection:**
- `local_ip`: first non-loopback IPv4 from network interfaces.
- `tailscale_ip`: run `tailscale ip -4` as subprocess; if command not found, fall back to scanning interfaces for `100.64.0.0/10` range (CGNAT) — note this may produce false positives on some carrier networks; the fallback is best-effort only.

**`lib.rs` wiring:**
```rust
// in setup closure:
app.manage(Mutex::new(RemoteServer::default()));

// in generate_handler!:
remote_server::start_remote_server,
remote_server::stop_remote_server,
remote_server::get_remote_server_status,
remote_server::regenerate_remote_token,
remote_server::add_remote_allowed_path,
```

---

### 4. Remote Access Panel (React, desktop only)

A new collapsible section at the bottom of the sidebar:

```
┌─────────────────────────────────┐
│ Remote Access          [ ON  ] │
│                                 │
│ Local:     192.168.1.5:7788     │
│ Tailscale: 100.x.x.x:7788      │
│ Token:     abc123fd  [copy]     │
│                [QR] [Regen]     │
└─────────────────────────────────┘
```

- **Toggle** → `invoke('start_remote_server')` / `invoke('stop_remote_server')`
- **QR code** → encodes `http://<tailscale-ip>:7788/#token=<token>` (fragment, not query string)
- **Regen** → `invoke('regenerate_remote_token')` → updates displayed token and QR
- Error state shown inline if server fails to start (port conflict, Node not found)

---

## Data Flow

**Mobile first connection:**
1. User scans QR → phone opens `http://100.x.x.x:7788/#token=abc123`
2. React app loads from Node server static files
3. App reads token from `location.hash` → stores in `sessionStorage` → cleans URL
4. `factory.ts` detects no `window.__TAURI__` → creates `WebSocketTransport(token)`
5. User opens a terminal tab → `transport.ptyCreate(uuid, homedir, 80, 24)` → WS connect to `/pty?sessionId=uuid&cwd=~&token=abc123`
6. Server spawns PTY → xterm.js renders output, sends input over WS

**Git panels on mobile:**
1. Component calls `transport.getFileDiff(path, file)`
2. `WebSocketTransport` → `fetch('/api/git/file-diff?path=...&file=...', { headers: { Authorization: 'Bearer abc123' } })`
3. Server runs `git diff -- <file>` in `path` → returns JSON
4. Component renders diff as usual

**Mobile reconnect after suspension:**
1. Safari resumes tab → WS was closed
2. `WebSocketTransport` detects close → starts backoff retry loop
3. Reconnects within 30s → server matches `sessionId` → resumes same PTY
4. After 30s → server killed PTY → reconnect creates a new session

---

## Build & Bundling

```
pnpm build:server    # tsc → server/dist/
pnpm build:frontend  # vite build → dist/
pnpm build           # runs both in sequence
```

`tauri.conf.json` additions:
```json
"bundle": {
  "resources": [
    "server/dist/**",
    "server/node_modules/**"
  ]
}
```

**`node-pty` native addon:** `node-pty` compiles a native `.node` binary. Key requirements:
- The binary must be compiled against the Node.js version that will run it at runtime (the bundled Node or the system Node).
- For distribution, `npm rebuild node-pty --runtime=node --target=<version>` must run as part of `pnpm build:server`.
- The compiled `.node` file path is resolved by Node.js relative to the `node_modules/` directory; as long as `server/node_modules/` is bundled with its directory structure intact (via `bundle.resources`), this resolution works correctly inside the `.app`.
- The `.node` binary must be code-signed. Add it to the list of binaries in `tauri.conf.json` `bundle.macOS.frameworks` or sign it explicitly in the CI release workflow via `codesign --sign "$APPLE_SIGNING_IDENTITY" <path-to-.node>`.
- For **universal binary** (x64 + arm64) distribution: build `node-pty` twice (once per arch) and `lipo` the resulting `.node` files. This is complex; the initial release may ship as **arm64 only** (Apple Silicon) given the target hardware, with x64 added later.

---

## Out of Scope

- Sharing desktop PTY sessions with mobile (mobile sessions are always independent)
- Multi-user access / user accounts
- HTTPS/TLS (Tailscale traffic is encrypted end-to-end at network level)
- Mobile-specific UI optimizations beyond the existing responsive layout

---

## Dependencies

| New dependency | Where | Purpose |
|---|---|---|
| `node-pty` | server/ | PTY sessions in Node.js (native addon) |
| `ws` | server/ | WebSocket server |
| `express` | server/ | HTTP server + static serving |
| `qrcode` | src/ (desktop only) | QR code generation in Remote Access panel |

No new Rust crates required.

---

## Setup Required (user, one-time)

1. Install [Tailscale](https://tailscale.com/) on Mac + phone — free, takes ~5 min.
2. Toggle "Remote Access" ON in VibeTerm.
3. Scan QR code from phone.
