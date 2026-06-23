import type {
  Transport, GitStatus, ChangedFile, WorkdirStatus,
  ImageDiff, CommitInfo, CommitFile, BranchInfo, StashInfo,
} from "./types";
import { useConnectionStore } from "../store/connectionStore";
import { classifyProbe, type ConnStatus } from "./classifyFailure";
import { parseOsc7Cwd, parseDevServerUrl } from "./parsePtyOutput";

const MAX_QUEUE = 500;

export class WebSocketTransport implements Transport {
  private token: string;
  private wsBase: string;
  private sockets = new Map<string, WebSocket>();
  private dataCallbacks = new Map<string, (data: string) => void>();
  private exitCallbacks = new Map<string, () => void>();
  private cwdCallbacks = new Map<string, (p: string) => void>();
  private portCallbacks = new Map<string, (p: string) => void>();
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
      this.setStatus("connecting");
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
          if (p.type === "pty-ready") { this.setStatus("connected"); resolve(); return; }
          if (p.type === "pty-error") { reject(new Error(p.message)); return; }
          if (p.type === "exit") { this.exitCallbacks.get(tabId)?.(); return; }
        } catch { /* not JSON */ }
        this.dataCallbacks.get(tabId)?.(msg);
        const cwd = parseOsc7Cwd(msg); if (cwd) this.cwdCallbacks.get(tabId)?.(cwd);
        const port = parseDevServerUrl(msg); if (port) this.portCallbacks.get(tabId)?.(port);
      };

      ws.onerror = () => reject(new Error("WS connection failed"));
      ws.onclose = (ev) => {
        if (ev.code === 1000) { this.exitCallbacks.get(tabId)?.(); return; } // clean exit (Task 6)
        void this.scheduleReconnect(tabId, 1000, ev.code);
      };
    });
  }

  private async scheduleReconnect(tabId: string, delay: number, closeCode?: number): Promise<void> {
    if (closeCode !== undefined && closeCode >= 4000 && closeCode <= 4999) {
      this.setStatus("offline");
      return;
    }
    if (!this.sessionMeta.has(tabId)) return; // tab closed
    const status = await this.probeAndClassify();
    this.setStatus(status === "connected" ? "reconnecting" : status);
    if (status === "auth-failed") return;            // stop: needs a fresh QR/token
    const nextDelay = status === "rate-limited" ? 60_000 : Math.min(delay * 2, 30_000);
    setTimeout(() => {
      if (!this.sessionMeta.has(tabId)) return;
      const meta = this.sessionMeta.get(tabId)!;
      const url = `${this.wsBase}/pty?sessionId=${tabId}&cwd=${encodeURIComponent(meta.cwd)}&cols=${meta.cols}&rows=${meta.rows}&token=${this.token}`;
      const ws = new WebSocket(url);
      this.sockets.set(tabId, ws);
      ws.onopen = () => {
        const q = this.writeQueues.get(tabId) ?? [];
        q.forEach((d) => ws.send(d));
        this.writeQueues.set(tabId, []);
      };
      ws.onmessage = (e) => {
        const msg = e.data as string;
        try { const p = JSON.parse(msg); if (p.type === "pty-ready") { this.setStatus("connected"); return; } if (p.type === "pty-error") return; } catch {}
        this.dataCallbacks.get(tabId)?.(msg);
        const cwd = parseOsc7Cwd(msg); if (cwd) this.cwdCallbacks.get(tabId)?.(cwd);
        const port = parseDevServerUrl(msg); if (port) this.portCallbacks.get(tabId)?.(port);
      };
      ws.onclose = (ev) => { if (ev.code === 1000) { this.exitCallbacks.get(tabId)?.(); return; } void this.scheduleReconnect(tabId, nextDelay, ev.code); };
    }, delay);
  }

  private async probeAndClassify(): Promise<ConnStatus> {
    try {
      const url = new URL("/api/ping", window.location.origin);
      const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${this.token}` } });
      return classifyProbe(r.status);
    } catch {
      return classifyProbe("network-error");
    }
  }
  private setStatus(s: ConnStatus) { useConnectionStore.getState().setStatus(s); }

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
    this.cwdCallbacks.delete(tabId);
    this.portCallbacks.delete(tabId);
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

  onCwdChanged(id: string, cb: (p: string) => void): () => void {
    this.cwdCallbacks.set(id, cb); return () => this.cwdCallbacks.delete(id);
  }
  onPortDetected(id: string, cb: (p: string) => void): () => void {
    this.portCallbacks.set(id, cb); return () => this.portCallbacks.delete(id);
  }

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
  listStashes(p: string): Promise<StashInfo[]>               { return this.get("stash-list", { path: p }); }
  stashPush(p: string, m: string): Promise<void>             { return this.post("stash-push", { path: p, message: m }); }
  stashPop(p: string, i: number): Promise<void>              { return this.post("stash-pop", { path: p, index: String(i) }); }
  stashApply(p: string, i: number): Promise<void>            { return this.post("stash-apply", { path: p, index: String(i) }); }
  stashDrop(p: string, i: number): Promise<void>             { return this.post("stash-drop", { path: p, index: String(i) }); }
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
  async listRemoteTabs(): Promise<import("./types").RemoteTab[]> {
    const url = new URL("/api/control/tabs", window.location.origin);
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${this.token}` } });
    if (!r.ok) return [];
    const j: any = await r.json();
    return Array.isArray(j?.tabs) ? j.tabs : [];
  }
  watchGitDir(_tabId: string, _path: string): Promise<void> { return Promise.resolve(); }
  unwatchGitDir(_tabId: string): Promise<void> { return Promise.resolve(); }
}
