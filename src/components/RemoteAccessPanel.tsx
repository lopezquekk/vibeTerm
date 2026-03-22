// src/components/RemoteAccessPanel.tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import QRCode from "qrcode";
import { useTabStore } from "../store/tabStore";

interface ServerInfo {
  port: number; token: string; local_ip: string; tailscale_ip: string | null;
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-[9px] text-zinc-500 hover:text-zinc-300 px-1 py-0.5 rounded border border-zinc-700 hover:border-zinc-500 transition-colors"
    >{copied ? "✓" : "copy"}</button>
  );
}

const IS_TAURI = typeof (window as any).__TAURI_INTERNALS__ !== "undefined";

export default function RemoteAccessPanel() {
  const tabs = useTabStore((s) => s.tabs);
  const [on, setOn] = useState(false);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qrRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!IS_TAURI) return;
    const p = listen("remote-server-died", () => { setOn(false); setInfo(null); setError("Server stopped unexpectedly"); });
    return () => { p.then((fn) => fn()); };
  }, []);

  const primaryIp = info?.tailscale_ip ?? info?.local_ip;
  const qrUrl = primaryIp ? `http://${primaryIp}:${info!.port}/#token=${info!.token}` : null;

  useEffect(() => {
    if (!qrRef.current || !qrUrl) return;
    QRCode.toCanvas(qrRef.current, qrUrl, { width: 96, color: { dark: "#ffffff", light: "#18181b" } });
  }, [qrUrl]);

  const toggle = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (on) {
        await invoke("stop_remote_server");
        setOn(false); setInfo(null);
      } else {
        const allowedPaths = tabs.map((t) => t.path);
        const result = await invoke<ServerInfo>("start_remote_server", { allowedPaths });
        setInfo(result); setOn(true);
      }
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [on, tabs]);

  const regen = useCallback(async () => {
    try {
      const t = await invoke<string>("regenerate_remote_token");
      setInfo((prev) => prev ? { ...prev, token: t } : prev);
    } catch (e) { setError(String(e)); }
  }, []);

  const buildUrl = (ip: string) => `http://${ip}:${info!.port}/#token=${info!.token}`;

  if (!IS_TAURI) return null;

  return (
    <div className="px-3 py-2 border-t border-border mt-auto shrink-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Remote</span>
        <button
          onClick={toggle} disabled={loading}
          className={`relative w-8 h-4 rounded-full transition-colors ${on ? "bg-accent" : "bg-zinc-700"} ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
        >
          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
        </button>
      </div>

      {error && <p className="text-[10px] text-red-400 mb-1">{error}</p>}

      {on && info && (
        <div className="space-y-1 text-[10px]">
          {info.local_ip && (
            <div className="flex items-center gap-1">
              <span className="text-zinc-500 w-10 shrink-0">Local</span>
              <span className="text-zinc-300 font-mono truncate flex-1">{info.local_ip}:{info.port}</span>
              <CopyBtn text={buildUrl(info.local_ip)} />
            </div>
          )}
          {info.tailscale_ip && (
            <div className="flex items-center gap-1">
              <span className="text-zinc-500 w-10 shrink-0">TS</span>
              <span className="text-zinc-300 font-mono truncate flex-1">{info.tailscale_ip}:{info.port}</span>
              <CopyBtn text={buildUrl(info.tailscale_ip)} />
            </div>
          )}
          <div className="flex items-center gap-1">
            <span className="text-zinc-500 w-10 shrink-0">Token</span>
            <span className="text-zinc-300 font-mono truncate flex-1">{info.token.slice(0, 8)}…</span>
            <CopyBtn text={info.token} />
            <button onClick={regen} className="text-[9px] text-zinc-500 hover:text-zinc-300 px-1 py-0.5 rounded border border-zinc-700 hover:border-zinc-500 transition-colors">regen</button>
          </div>
          {qrUrl && (
            <div className="pt-1">
              <canvas ref={qrRef} className="rounded border border-zinc-700" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
