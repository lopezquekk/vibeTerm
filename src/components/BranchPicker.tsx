import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface BranchInfo {
  name: string;
  is_current: boolean;
}

interface Props {
  repoPath: string;
  anchorRect: DOMRect;
  onClose: () => void;
  onSwitched: () => void;
}

export default function BranchPicker({ repoPath, anchorRect, onClose, onSwitched }: Props) {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoke<BranchInfo[]>("get_branches", { path: repoPath })
      .then((list) => { setBranches(list); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, [repoPath]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [loading]);

  const filtered = branches.filter((b) =>
    b.name.toLowerCase().includes(filter.toLowerCase())
  );

  // Show "create branch" option if filter text doesn't match any existing branch
  const canCreate = filter.trim().length > 0 && !branches.some((b) => b.name === filter.trim());

  const handleSwitch = async (name: string) => {
    setSwitching(name);
    setError(null);
    try {
      await invoke("switch_branch", { path: repoPath, branch: name });
      onSwitched();
      onClose();
    } catch (e) {
      setError(String(e));
      setSwitching(null);
    }
  };

  const handleCreate = async () => {
    const name = filter.trim();
    if (!name) return;
    setSwitching(name);
    setError(null);
    try {
      await invoke("create_branch", { path: repoPath, branch: name });
      onSwitched();
      onClose();
    } catch (e) {
      setError(String(e));
      setSwitching(null);
    }
  };

  // Position: appear to the right of the sidebar, aligned to the anchor row
  const SIDEBAR_W = 256;
  const top = Math.min(anchorRect.top, window.innerHeight - 320);
  const left = SIDEBAR_W + 4;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Picker panel */}
      <div
        className="fixed z-50 w-60 bg-zinc-900 border border-border rounded-lg shadow-2xl shadow-black/60 flex flex-col overflow-hidden"
        style={{ top, left }}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <span className="text-zinc-500 text-xs">⎇</span>
          <input
            ref={inputRef}
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter") {
                if (filtered.length === 1) handleSwitch(filtered[0].name);
                else if (canCreate) handleCreate();
              }
            }}
            placeholder="Filter or create branch…"
            className="flex-1 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none"
          />
        </div>

        {/* Branch list */}
        <div className="overflow-y-auto max-h-64">
          {loading ? (
            <p className="text-xs text-zinc-500 text-center py-4">Loading…</p>
          ) : (
            <>
              {filtered.map((b) => (
                <button
                  key={b.name}
                  onClick={() => !b.is_current && handleSwitch(b.name)}
                  disabled={!!switching || b.is_current}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors text-xs ${
                    b.is_current
                      ? "text-accent cursor-default"
                      : "text-zinc-300 hover:bg-zinc-800 cursor-pointer"
                  } disabled:opacity-50`}
                >
                  <span className="w-3 flex-shrink-0">
                    {b.is_current ? "✓" : switching === b.name ? "↻" : ""}
                  </span>
                  <span className="font-mono truncate">{b.name}</span>
                </button>
              ))}

              {filtered.length === 0 && !canCreate && (
                <p className="text-xs text-zinc-600 text-center py-4">No branches found</p>
              )}

              {canCreate && (
                <button
                  onClick={handleCreate}
                  disabled={!!switching}
                  className="w-full text-left px-3 py-2 flex items-center gap-2 text-xs text-green-400 hover:bg-zinc-800 transition-colors border-t border-border/50 disabled:opacity-50"
                >
                  <span className="w-3 flex-shrink-0">+</span>
                  <span className="font-mono truncate">Create "{filter.trim()}"</span>
                </button>
              )}
            </>
          )}
        </div>

        {error && (
          <div className="px-3 py-2 border-t border-border text-[10px] text-red-400 leading-snug">
            {error}
          </div>
        )}
      </div>
    </>
  );
}
