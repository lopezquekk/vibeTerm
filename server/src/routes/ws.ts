import type { IncomingMessage } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { URL } from "url";
import * as ptyManager from "../pty-manager";

// Token is passed as a query parameter on the WebSocket upgrade request.
// (Browser WebSocket API cannot set custom headers — query param is the standard approach.)
// Authentication is enforced at the HTTP upgrade stage (before the 101 response) via
// the `verifyClient` option, so an invalid token returns HTTP 401 and the connection
// is never established. Rate limiting (5 failures / 60s per IP) is applied inside verifyClient.

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
