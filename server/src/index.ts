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
