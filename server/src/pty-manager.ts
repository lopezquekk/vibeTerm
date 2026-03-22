// server/src/pty-manager.ts
import * as pty from "node-pty";
import os from "os";
import fs from "fs";
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
  const home = os.homedir();

  // Prefer system-installed shells (no external dylib deps that may be
  // unavailable in the Tauri bundle environment). Only fall back to the
  // user's $SHELL if none of the system paths exist.
  const shellCandidates = [
    "/bin/zsh",
    "/bin/bash",
    "/bin/sh",
    process.env.SHELL,
  ];
  const shell = shellCandidates.find((s) => {
    if (!s) return false;
    try { fs.accessSync(s, fs.constants.X_OK); return true; } catch { return false; }
  }) ?? "/bin/sh";

  // Resolve cwd, fall back to home if directory doesn't exist
  const rawCwd = cwd === "~" ? home : cwd;
  const resolvedCwd = (() => {
    try { if (fs.statSync(rawCwd).isDirectory()) return rawCwd; } catch { /* */ }
    return home;
  })();

  // Build a clean environment — filter undefined values and remove dylib
  // overrides that can prevent shells from loading in the bundle context.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("DYLD_")) env[k] = v;
  }
  env.HOME = home;
  env.SHELL = shell;
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.LANG = process.env.LANG ?? "en_US.UTF-8";
  if (!env.PATH) {
    env.PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin";
  }

  const safeCols = Math.max(cols, 10);
  const safeRows = Math.max(rows, 3);

  const p = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: safeCols,
    rows: safeRows,
    cwd: resolvedCwd,
    env,
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
