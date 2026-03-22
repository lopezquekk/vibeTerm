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
