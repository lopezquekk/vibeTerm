import type {
  Transport, GitStatus, ChangedFile, WorkdirStatus,
  ImageDiff, CommitInfo, CommitFile, BranchInfo,
} from "./types";

const MAX_QUEUE = 500;

export class WebSocketTransport implements Transport {
  private token: string;
  private wsBase: string;
  private sockets = new Map<string, WebSocket>();
  private dataCallbacks = new Map<string, (data: string) => void>();
  private exitCallbacks = new Map<string, () => void>();
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
          if (p.type === "pty-ready") { resolve(); return; }
          if (p.type === "pty-error") { reject(new Error(p.message)); return; }
        } catch { /* not JSON */ }
        this.dataCallbacks.get(tabId)?.(msg);
      };

      ws.onerror = () => reject(new Error("WS connection failed"));
      ws.onclose = () => {
        this.reconnect(tabId);
        this.exitCallbacks.get(tabId)?.();
      };
    });
  }

  private reconnect(tabId: string, delay = 1000): void {
    const meta = this.sessionMeta.get(tabId);
    if (!meta) return;
    const { cwd, cols, rows } = meta;
    setTimeout(() => {
      if (!this.sessionMeta.has(tabId)) return; // tab was closed
      const url = `${this.wsBase}/pty?sessionId=${tabId}&cwd=${encodeURIComponent(cwd)}&cols=${cols}&rows=${rows}&token=${this.token}`;
      const ws = new WebSocket(url);
      this.sockets.set(tabId, ws);
      ws.onopen = () => {
        const q = this.writeQueues.get(tabId) ?? [];
        q.forEach((d) => ws.send(d));
        this.writeQueues.set(tabId, []);
      };
      ws.onmessage = (e) => {
        const msg = e.data as string;
        try { const p = JSON.parse(msg); if (p.type === "pty-ready" || p.type === "pty-error") return; } catch {}
        this.dataCallbacks.get(tabId)?.(msg);
      };
      ws.onclose = () => this.reconnect(tabId, Math.min(delay * 2, 30_000));
    }, delay);
  }

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

  onCwdChanged(_id: string, _cb: (p: string) => void): () => void { return () => {}; }
  onPortDetected(_id: string, _cb: (p: string) => void): () => void { return () => {}; }

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
}
