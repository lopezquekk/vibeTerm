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

A new abstraction that decouples UI components from the communication mechanism.

```typescript
// src/transport/index.ts
interface Transport {
  ptyWrite(tabId: string, data: string): void
  ptyResize(tabId: string, cols: number, rows: number): void
  onPtyData(tabId: string, cb: (data: string) => void): () => void
  gitDiff(path: string): Promise<DiffResult>
  gitHistory(path: string): Promise<Commit[]>
  gitStage(path: string, file: string): Promise<void>
  gitUnstage(path: string, file: string): Promise<void>
  gitDiscard(path: string, file: string): Promise<void>
  gitCommit(path: string, message: string): Promise<void>
  // additional git/pty commands as needed
}
```

- `src/transport/tauri.ts` — existing `invoke`-based implementation (refactored from current hooks)
- `src/transport/websocket.ts` — new WebSocket/fetch implementation for browser
- `src/transport/factory.ts` — exports `transport` singleton: `window.__TAURI__ ? new TauriTransport() : new WebSocketTransport()`

All existing hooks (`usePty`, `useGitDiff`, `useGitHistory`, `useChanges`) are updated to call `transport.xxx` instead of `invoke` directly. Logic and UI are untouched.

### 2. Node.js Web Server (`server/`)

```
server/
  index.ts          ← entry point: HTTP + WebSocket server
  pty-manager.ts    ← PTY session lifecycle with node-pty
  git-handler.ts    ← git operations via child_process
  routes/
    static.ts       ← serves dist/ (React build)
    ws.ts           ← WebSocket handler for PTY I/O + resize
    git.ts          ← REST endpoints for git operations
  package.json      ← node-pty, ws, express (or fastify)
  tsconfig.json
```

**PTY over WebSocket:**
- Each tab gets a `sessionId` (UUID).
- WS handshake: `ws://host:7788/pty?sessionId=xxx&token=yyy`
- Server maps `sessionId → IPty` instance.
- Input from client → `pty.write(data)`
- Output from PTY → `ws.send(data)`
- Resize: JSON message `{ type: "resize", cols, rows }`

**Git REST endpoints:**
```
GET  /api/git/diff?path=...
GET  /api/git/history?path=...
GET  /api/git/status?path=...
POST /api/git/stage    { path, file }
POST /api/git/unstage  { path, file }
POST /api/git/discard  { path, file }
POST /api/git/commit   { path, message }
```

**Security:**
- A random token (16-byte hex) is generated on server start.
- All requests must include `?token=<token>` or `Authorization: Bearer <token>` header.
- Requests without valid token → 401.
- Server binds to `0.0.0.0` so it's reachable over Tailscale.

### 3. Tauri Remote Server Controller (`src-tauri/src/remote_server.rs`)

```rust
pub struct RemoteServer {
    child: Option<Child>,
    port: u16,
    token: String,
}

#[tauri::command]
pub fn start_remote_server() -> Result<ServerInfo, String>
// Spawns: `node <app_dir>/server/index.js --port 7788 --token <token>`
// Returns: { port, token, local_ip, tailscale_ip }

#[tauri::command]
pub fn stop_remote_server() -> Result<(), String>
// Sends SIGTERM to child process

#[tauri::command]
pub fn get_remote_server_status() -> ServerStatus
// Returns: { running, port, token, local_ip, tailscale_ip }
```

The `local_ip` is detected from network interfaces (first non-loopback IPv4). The `tailscale_ip` is detected by checking the `100.x.x.x` range on available interfaces (optional, shown only if Tailscale is active).

The child process is killed when:
- User toggles OFF
- The Tauri app is closed (Rust Drop impl on RemoteServer)

### 4. Remote Access Panel (React, desktop only)

A new section in the VibeTerm sidebar or settings area:

```
┌─────────────────────────────────┐
│ Remote Access          [ ON  ] │
│                                 │
│ Local:     192.168.1.5:7788     │
│ Tailscale: 100.x.x.x:7788      │
│ Token:     abc123fd  [copy]     │
│                      [QR code]  │
└─────────────────────────────────┘
```

- Toggle calls `invoke('start_remote_server')` / `invoke('stop_remote_server')`
- QR code encodes full URL: `http://100.x.x.x:7788?token=<token>`
- One scan → phone opens VibeTerm web UI authenticated

---

## Data Flow

**Mobile connects:**
1. User scans QR or types URL in phone browser
2. React app loads from `http://<tailscale-ip>:7788`
3. `factory.ts` detects no `window.__TAURI__` → uses `WebSocketTransport`
4. Each terminal tab opens a WS connection: `/pty?sessionId=<uuid>&token=<token>`
5. Server creates a new PTY session for that tab
6. xterm.js renders output, sends input over WS

**Git panels on mobile:**
1. Component calls `transport.gitDiff(path)`
2. `WebSocketTransport` → `fetch('/api/git/diff?path=...&token=...')`
3. Server runs `git diff` in the given path → returns JSON
4. Component renders the diff as usual

---

## Out of Scope

- Sharing desktop PTY sessions with mobile (mobile sessions are always independent)
- Authentication beyond the single token (no user accounts, no multi-user)
- Mobile-specific UI optimizations (the existing responsive layout handles it)
- HTTPS/TLS (Tailscale traffic is encrypted end-to-end at network level)

---

## Dependencies

| New dependency | Where | Purpose |
|---|---|---|
| `node-pty` | server/ | PTY sessions in Node.js |
| `ws` | server/ | WebSocket server |
| `express` or `fastify` | server/ | HTTP server + static serving |
| `qrcode` (npm) | src/ | QR code generation in desktop UI |

No new Rust crates required (uses `std::process::Command` for spawn).

---

## Setup Required (user, one-time)

1. Install [Tailscale](https://tailscale.com/) on Mac + phone — free, takes ~5 min.
2. Toggle ON in VibeTerm.
3. Scan QR code from phone.
