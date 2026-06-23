// server/src/index.ts
import express from "express";
import http from "http";
import cors from "cors";
import { WebSocketServer } from "ws";
import crypto from "crypto";
import path from "path";
import os from "os";
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

// Expand a leading "~" to the home directory — the desktop's default tab uses "~",
// and path.resolve would otherwise turn it into "<cwd>/~" (a nonexistent dir),
// breaking git operations and the project list for remote clients.
const expandHome = (p: string) =>
  p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p;
const resolvePath = (p: string) => path.resolve(expandHome(p));

const allowedPaths = [...initialPaths.map(resolvePath)];
const addPath = (p: string) => { const r = resolvePath(p); if (!allowedPaths.includes(r)) allowedPaths.push(r); };
const getToken = () => TOKEN;

// Full tab list mirrored from the desktop (alias/path/type) so the remote browser
// can render exactly the tabs the desktop has open. Paths are resolved/expanded.
interface RemoteTab { id: string; alias: string; path: string; type: string }
let remoteTabs: RemoteTab[] = [];

// Stdin reader for Tauri control messages
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.type === "rotate-token" && typeof msg.token === "string") TOKEN = msg.token;
    else if (msg.type === "add-path" && typeof msg.path === "string") addPath(msg.path);
    else if (msg.type === "set-tabs" && Array.isArray(msg.tabs)) {
      remoteTabs = msg.tabs
        .filter((t: any) => t && typeof t.path === "string")
        .map((t: any) => ({
          id: String(t.id),
          alias: String(t.alias ?? ""),
          path: resolvePath(t.path),
          type: String(t.type ?? "project"),
        }));
      // Keep these paths allowed so the remote's git/PTY calls pass validation.
      for (const t of remoteTabs) addPath(t.path);
    }
  } catch { /* ignore */ }
});

const rateLimiter = createRateLimiter();
const app = express();
app.use(cors({ origin: false }));
app.use(express.json());
app.use("/api", rateLimiter, createAuthMiddleware(getToken));
app.use("/api/git", createGitRouter(() => allowedPaths));
app.use("/api/control", createControlRouter(addPath, () => remoteTabs));
app.get("/api/ping", (_req, res) => res.json({ ok: true }));
app.use(createStaticRouter());
app.get("*", (_req, res) => {
  const idx = path.resolve(__dirname, "../../dist/index.html");
  res.sendFile(idx);
});

const server = http.createServer(app);

// WebSocket server: token validated at HTTP upgrade stage via verifyClient (returns 401 before 101)
// Rate limiting (5 failures / 60s window per IP) is applied inside verifyClient before the 101 response.
const wss = new WebSocketServer({ server, path: "/pty", ...createWssOptions(getToken) });
setupWsServer(wss, getToken);
// Prevent unhandled error events from crashing the process when the underlying
// http server fails (e.g. EADDRINUSE); that case is handled by server.on("error").
wss.on("error", () => {});

server.listen(PORT, "0.0.0.0", () => {
  const addr = server.address() as { port: number } | null;
  const actualPort = addr?.port ?? PORT;
  process.stdout.write(JSON.stringify({ status: "ready", port: actualPort }) + "\n");
}).on("error", (err: NodeJS.ErrnoException) => {
  const message = err.code === "EADDRINUSE" ? "port in use" : err.message;
  process.stdout.write(JSON.stringify({ status: "error", message }) + "\n");
  process.exit(1);
});
