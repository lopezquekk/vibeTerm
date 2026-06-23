import { useConnectionStore } from "../store/connectionStore";

const IS_TAURI = typeof (window as any).__TAURI_INTERNALS__ !== "undefined";

const META: Record<string, { dot: string; label: string }> = {
  connecting:   { dot: "bg-yellow-400", label: "Connecting…" },
  connected:    { dot: "bg-green-400",  label: "Connected" },
  reconnecting: { dot: "bg-yellow-400 animate-pulse", label: "Reconnecting…" },
  "rate-limited": { dot: "bg-orange-400", label: "Rate limited — retrying" },
  "auth-failed":  { dot: "bg-red-500",   label: "Session expired — rescan the QR" },
  offline:      { dot: "bg-red-500",     label: "Server offline" },
};

export function ConnectionBadge() {
  const status = useConnectionStore((s) => s.status);
  if (IS_TAURI) return null;
  const m = META[status] ?? META.connecting;
  return (
    <span className="flex items-center gap-1.5 text-zinc-400">
      <span className={`w-2 h-2 rounded-full ${m.dot}`} />
      <span>{m.label}</span>
    </span>
  );
}
