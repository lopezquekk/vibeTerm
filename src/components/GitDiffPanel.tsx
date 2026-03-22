import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "../store/tabStore";
import {
  type ImageDiff,
  type DiffLine,
  isImageFile,
  parseDiffLines,
  statusMeta,
  basename,
  dirname,
  DiffTable,
  ImageDiffView,
} from "../utils/diff";

interface ChangedFile {
  path: string;
  status: string;
}

export default function GitDiffPanel({ tabId }: { tabId: string }) {
  const { tabs } = useTabStore();
  const tab = tabs.find((t) => t.id === tabId);

  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [imageDiff, setImageDiff] = useState<ImageDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const diffRef = useRef<HTMLDivElement>(null);

  // Poll changed files every 3 s
  useEffect(() => {
    if (!tab?.path) return;

    const fetch = async () => {
      try {
        const list = await invoke<ChangedFile[]>("get_changed_files", { path: tab.path });
        setFiles(list);
      } catch {
        setFiles([]);
      }
    };

    fetch();
    const id = setInterval(fetch, 3000);
    return () => clearInterval(id);
  }, [tab?.path]);

  // Auto-select first file; deselect when list empties
  useEffect(() => {
    if (files.length === 0) {
      setSelected(null);
      setDiffLines([]);
      setImageDiff(null);
      return;
    }
    setSelected((prev) => {
      if (prev && files.some((f) => f.path === prev)) return prev;
      return files[0].path;
    });
  }, [files]);

  // Fetch diff whenever selection changes
  useEffect(() => {
    if (!tab?.path || !selected) return;

    setDiffLoading(true);
    setDiffLines([]);
    setImageDiff(null);

    if (isImageFile(selected)) {
      invoke<ImageDiff>("get_image_diff", { path: tab.path, file: selected })
        .then((result) => {
          setImageDiff(result);
          diffRef.current?.scrollTo({ top: 0 });
        })
        .catch(() => setImageDiff(null))
        .finally(() => setDiffLoading(false));
    } else {
      invoke<string>("get_file_diff", { path: tab.path, file: selected })
        .then((raw) => {
          setDiffLines(parseDiffLines(raw));
          diffRef.current?.scrollTo({ top: 0 });
        })
        .catch(() => setDiffLines([]))
        .finally(() => setDiffLoading(false));
    }
  }, [tab?.path, selected]);

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
        No changes detected
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* File list sidebar */}
      <div className="w-56 flex-shrink-0 border-r border-border overflow-y-auto bg-sidebar">
        <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500 border-b border-border">
          {files.length} changed file{files.length !== 1 ? "s" : ""}
        </div>
        {files.map((f) => {
          const meta = statusMeta(f.status);
          const isActive = f.path === selected;
          return (
            <button
              key={f.path}
              onClick={() => setSelected(f.path)}
              className={`w-full text-left px-3 py-1.5 flex items-start gap-2 transition-colors group ${
                isActive
                  ? "bg-accent/15 text-white"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <span
                className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center ${meta.bg} ${meta.text}`}
              >
                {meta.label}
              </span>
              <span className="min-w-0">
                <span className="block text-xs truncate leading-tight">
                  {basename(f.path)}
                </span>
                {dirname(f.path) && (
                  <span className="block text-[10px] text-zinc-600 truncate leading-tight mt-0.5">
                    {dirname(f.path)}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Diff viewer */}
      <div ref={diffRef} className="flex-1 overflow-auto font-mono text-xs">
        {diffLoading ? (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm font-sans">
            Loading…
          </div>
        ) : imageDiff ? (
          <ImageDiffView diff={imageDiff} />
        ) : diffLines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-600 font-sans">
            <span className="text-2xl">✓</span>
            <span className="text-sm">No diff available</span>
          </div>
        ) : (
          <DiffTable lines={diffLines} />
        )}
      </div>
    </div>
  );
}
