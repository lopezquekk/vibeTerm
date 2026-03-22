import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "../store/tabStore";

const IMAGE_EXTS = new Set(["png","jpg","jpeg","gif","webp","svg","ico","bmp","tiff","tif","avif"]);

function isImageFile(path: string) {
  return IMAGE_EXTS.has(path.split(".").pop()?.toLowerCase() ?? "");
}

interface ImageDiff {
  before: string | null;
  after: string | null;
}

interface ChangedFile {
  path: string;
  status: string;
}

interface DiffLine {
  type: "add" | "remove" | "context" | "header" | "meta";
  content: string;
  oldLine?: number;
  newLine?: number;
}

function parseDiffLines(raw: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of raw.split("\n")) {
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("---") ||
      line.startsWith("+++")
    ) {
      continue;
    }
    if (line.startsWith("@@")) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldLine = parseInt(m[1]);
        newLine = parseInt(m[2]);
      }
      lines.push({ type: "header", content: line });
    } else if (line.startsWith("+")) {
      lines.push({ type: "add", content: line.slice(1), newLine: newLine++ });
    } else if (line.startsWith("-")) {
      lines.push({ type: "remove", content: line.slice(1), oldLine: oldLine++ });
    } else if (line.length > 0) {
      lines.push({
        type: "context",
        content: line.slice(1),
        oldLine: oldLine++,
        newLine: newLine++,
      });
    }
  }
  return lines;
}

const STATUS_META: Record<
  string,
  { label: string; bg: string; text: string; dot: string }
> = {
  M:  { label: "M", bg: "bg-yellow-500/15", text: "text-yellow-400", dot: "bg-yellow-400" },
  MM: { label: "M", bg: "bg-yellow-500/15", text: "text-yellow-400", dot: "bg-yellow-400" },
  AM: { label: "M", bg: "bg-yellow-500/15", text: "text-yellow-400", dot: "bg-yellow-400" },
  A:  { label: "A", bg: "bg-green-500/15",  text: "text-green-400",  dot: "bg-green-400"  },
  D:  { label: "D", bg: "bg-red-500/15",    text: "text-red-400",    dot: "bg-red-400"    },
  AD: { label: "D", bg: "bg-red-500/15",    text: "text-red-400",    dot: "bg-red-400"    },
  R:  { label: "R", bg: "bg-blue-500/15",   text: "text-blue-400",   dot: "bg-blue-400"   },
  "??": { label: "U", bg: "bg-purple-500/15", text: "text-purple-400", dot: "bg-purple-400" },
};

function statusMeta(s: string) {
  return STATUS_META[s] ?? { label: s[0] ?? "?", bg: "bg-zinc-700/30", text: "text-zinc-400", dot: "bg-zinc-400" };
}

function ImageDiffView({ diff }: { diff: ImageDiff }) {
  const isNew = !diff.before && !!diff.after;
  const isDeleted = !!diff.before && !diff.after;
  const isModified = !!diff.before && !!diff.after;

  if (isNew) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-2 bg-green-950/40 border-b border-border text-green-400 text-xs font-sans font-medium">
          New file
        </div>
        <div className="flex-1 flex items-center justify-center p-6 bg-[repeating-conic-gradient(#1a1a1a_0%_25%,#141414_0%_50%)] bg-[length:20px_20px]">
          <img src={diff.after!} className="max-w-full max-h-full object-contain drop-shadow-xl rounded" />
        </div>
      </div>
    );
  }

  if (isDeleted) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-2 bg-red-950/40 border-b border-border text-red-400 text-xs font-sans font-medium">
          Deleted file
        </div>
        <div className="flex-1 flex items-center justify-center p-6 bg-[repeating-conic-gradient(#1a1a1a_0%_25%,#141414_0%_50%)] bg-[length:20px_20px] opacity-50">
          <img src={diff.before!} className="max-w-full max-h-full object-contain drop-shadow-xl rounded" />
        </div>
      </div>
    );
  }

  if (isModified) {
    return (
      <div className="flex flex-col h-full font-sans">
        <div className="grid grid-cols-2 divide-x divide-border border-b border-border flex-shrink-0">
          <div className="px-4 py-2 bg-red-950/30 text-red-400 text-xs font-medium">Before</div>
          <div className="px-4 py-2 bg-green-950/30 text-green-400 text-xs font-medium">After</div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-border flex-1 min-h-0">
          <div className="flex items-center justify-center p-6 bg-[repeating-conic-gradient(#1a1a1a_0%_25%,#141414_0%_50%)] bg-[length:20px_20px]">
            <img src={diff.before!} className="max-w-full max-h-full object-contain drop-shadow-xl rounded" />
          </div>
          <div className="flex items-center justify-center p-6 bg-[repeating-conic-gradient(#1a1a1a_0%_25%,#141414_0%_50%)] bg-[length:20px_20px]">
            <img src={diff.after!} className="max-w-full max-h-full object-contain drop-shadow-xl rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-full text-zinc-600 text-sm font-sans">
      Image not available
    </div>
  );
}

function basename(path: string) {
  return path.split("/").pop() ?? path;
}

function dirname(path: string) {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
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
        const list = await invoke<ChangedFile[]>("get_changed_files", {
          path: tab.path,
        });
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
          <table className="w-full border-collapse">
            <tbody>
              {diffLines.map((line, i) => {
                if (line.type === "header") {
                  return (
                    <tr key={i} className="bg-zinc-800/60">
                      <td colSpan={4} className="px-4 py-1 text-zinc-400 select-none">
                        {line.content}
                      </td>
                    </tr>
                  );
                }

                const isAdd = line.type === "add";
                const isRem = line.type === "remove";

                return (
                  <tr
                    key={i}
                    className={
                      isAdd
                        ? "bg-green-950/40 hover:bg-green-950/60"
                        : isRem
                        ? "bg-red-950/40 hover:bg-red-950/60"
                        : "hover:bg-zinc-800/20"
                    }
                  >
                    {/* Old line number */}
                    <td className="w-10 text-right pr-2 pl-2 select-none text-zinc-600 border-r border-zinc-800">
                      {isRem || line.type === "context" ? line.oldLine : ""}
                    </td>
                    {/* New line number */}
                    <td className="w-10 text-right pr-2 select-none text-zinc-600 border-r border-zinc-800">
                      {isAdd || line.type === "context" ? line.newLine : ""}
                    </td>
                    {/* Gutter +/- */}
                    <td
                      className={`w-5 text-center select-none ${
                        isAdd ? "text-green-500" : isRem ? "text-red-500" : "text-zinc-700"
                      }`}
                    >
                      {isAdd ? "+" : isRem ? "−" : " "}
                    </td>
                    {/* Content */}
                    <td
                      className={`pl-1 pr-4 whitespace-pre ${
                        isAdd
                          ? "text-green-300"
                          : isRem
                          ? "text-red-300"
                          : "text-zinc-300"
                      }`}
                    >
                      {line.content}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
