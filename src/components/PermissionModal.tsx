// src/components/PermissionModal.tsx
import { useEffect, useState } from "react";
import { usePromptStore } from "../store/promptStore";
import { useTabStore } from "../store/tabStore";
import { transport } from "../transport/factory";
import { TYPE_ICONS, TYPE_COLORS } from "./tabTheme";

export default function PermissionModal() {
  const current = usePromptStore((s) => s.current);
  const resolve = usePromptStore((s) => s.resolve);
  const dismiss = usePromptStore((s) => s.dismiss);
  const tabs = useTabStore((s) => s.tabs);
  const setActiveTab = useTabStore((s) => s.setActiveTab);

  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset transient state whenever a new prompt becomes current.
  useEffect(() => {
    setText("");
    setError(null);
  }, [current?.prompt.signature]);

  // Esc dismisses without answering.
  useEffect(() => {
    if (!current) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [current, dismiss]);

  if (!current) return null;

  const baseTabId = current.tabId.replace(/-split$/, "");
  const tab = tabs.find((t) => t.id === baseTabId);
  const accent = tab ? TYPE_COLORS[tab.type] : "#3b82f6";
  const icon = tab ? TYPE_ICONS[tab.type] : "◈";
  const alias = tab?.alias ?? current.tabId;
  const { prompt } = current;

  const send = (seq: string) => {
    try {
      transport.ptyWrite(current.tabId, seq);
      setActiveTab(baseTabId); // jump to the originating terminal on answer
      resolve();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  return (
    <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className="w-[32rem] max-w-[90vw] rounded-lg border border-border bg-sidebar shadow-2xl shadow-black/60 overflow-hidden">
        {/* Origin tab header */}
        <div
          className="flex items-center gap-2 px-4 py-2.5 border-b border-border"
          style={{ borderLeft: `4px solid ${accent}` }}
        >
          <span className="text-xs font-mono" style={{ color: accent }}>{icon}</span>
          <span className="text-sm font-semibold text-zinc-100 truncate">{alias}</span>
          <span className="ml-auto text-[10px] uppercase tracking-wide text-zinc-500">{prompt.tool}</span>
        </div>

        {/* Question */}
        <div className="px-4 py-3">
          <p className="text-sm font-mono text-zinc-200 whitespace-pre-wrap break-words">{prompt.question}</p>
        </div>

        {/* Options or free-form input */}
        <div className="px-4 pb-4 flex flex-col gap-2">
          {prompt.kind === "freeform" ? (
            <>
              <textarea
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    send(text + "\r");
                  }
                }}
                rows={3}
                className="w-full bg-zinc-900 text-zinc-100 text-sm rounded border border-border px-2 py-1.5 outline-none focus:border-accent resize-none"
                placeholder="Escribe tu respuesta… (⌘/Ctrl+Enter para enviar)"
              />
              <button
                className="self-end px-3 py-1.5 rounded text-sm font-medium text-white"
                style={{ backgroundColor: accent }}
                onClick={() => send(text + "\r")}
              >
                Enviar
              </button>
            </>
          ) : (
            prompt.options.map((opt, idx) => (
              <button
                key={idx}
                className={`text-left px-3 py-2 rounded text-sm transition-colors border ${
                  idx === 0
                    ? "text-white font-medium"
                    : "text-zinc-200 border-border hover:bg-sidebar-hover"
                }`}
                style={idx === 0 ? { backgroundColor: accent, borderColor: accent } : undefined}
                onClick={() => send(opt.send)}
              >
                {opt.label}
              </button>
            ))
          )}

          {error && <p className="text-xs text-red-400">No se pudo enviar: {error}</p>}

          <button
            className="self-start mt-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            onClick={() => dismiss()}
          >
            Responder en la terminal (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
