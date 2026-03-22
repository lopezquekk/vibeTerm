import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "../store/tabStore";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CommitInfo {
  hash: string;
  short_hash: string;
  author: string;
  date: string;
  message: string;
  is_local: boolean;
}

interface CommitFile {
  path: string;
  status: string;
}

interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
  oldLine?: number;
  newLine?: number;
}

interface ImageDiff {
  before: string | null;
  after: string | null;
}

// ── Shared utilities ──────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(["png","jpg","jpeg","gif","webp","svg","ico","bmp","tiff","tif","avif"]);
function isImageFile(p: string) {
  return IMAGE_EXTS.has(p.split(".").pop()?.toLowerCase() ?? "");
}

function parseDiffLines(raw: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0, newLine = 0;
  for (const line of raw.split("\n")) {
    if (
      line.startsWith("diff --git") || line.startsWith("index ") ||
      line.startsWith("new file") || line.startsWith("deleted file") ||
      line.startsWith("---") || line.startsWith("+++")
    ) continue;
    if (line.startsWith("@@")) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) { oldLine = parseInt(m[1]); newLine = parseInt(m[2]); }
      lines.push({ type: "header", content: line });
    } else if (line.startsWith("+")) {
      lines.push({ type: "add", content: line.slice(1), newLine: newLine++ });
    } else if (line.startsWith("-")) {
      lines.push({ type: "remove", content: line.slice(1), oldLine: oldLine++ });
    } else if (line.length > 0) {
      lines.push({ type: "context", content: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
    }
  }
  return lines;
}

const STATUS_META: Record<string, { label: string; bg: string; text: string }> = {
  M:  { label: "M", bg: "bg-yellow-500/15", text: "text-yellow-400" },
  A:  { label: "A", bg: "bg-green-500/15",  text: "text-green-400"  },
  D:  { label: "D", bg: "bg-red-500/15",    text: "text-red-400"    },
  R:  { label: "R", bg: "bg-blue-500/15",   text: "text-blue-400"   },
};
function statusMeta(s: string) {
  return STATUS_META[s] ?? { label: s[0] ?? "?", bg: "bg-zinc-700/30", text: "text-zinc-400" };
}

function basename(p: string) { return p.split("/").pop() ?? p; }
function dirname(p: string) {
  const parts = p.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DiffTable({ lines }: { lines: DiffLine[] }) {
  return (
    <table className="w-full border-collapse font-mono text-xs">
      <tbody>
        {lines.map((line, i) => {
          if (line.type === "header") {
            return (
              <tr key={i} className="bg-zinc-800/60">
                <td colSpan={4} className="px-4 py-1 text-zinc-400 select-none">{line.content}</td>
              </tr>
            );
          }
          const isAdd = line.type === "add";
          const isRem = line.type === "remove";
          return (
            <tr key={i} className={isAdd ? "bg-green-950/40 hover:bg-green-950/60" : isRem ? "bg-red-950/40 hover:bg-red-950/60" : "hover:bg-zinc-800/20"}>
              <td className="w-10 text-right pr-2 pl-2 select-none text-zinc-600 border-r border-zinc-800">
                {isRem || line.type === "context" ? line.oldLine : ""}
              </td>
              <td className="w-10 text-right pr-2 select-none text-zinc-600 border-r border-zinc-800">
                {isAdd || line.type === "context" ? line.newLine : ""}
              </td>
              <td className={`w-5 text-center select-none ${isAdd ? "text-green-500" : isRem ? "text-red-500" : "text-zinc-700"}`}>
                {isAdd ? "+" : isRem ? "−" : " "}
              </td>
              <td className={`pl-1 pr-4 whitespace-pre ${isAdd ? "text-green-300" : isRem ? "text-red-300" : "text-zinc-300"}`}>
                {line.content}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ImageDiffView({ diff }: { diff: ImageDiff }) {
  const checker = "bg-[repeating-conic-gradient(#1a1a1a_0%_25%,#141414_0%_50%)] bg-[length:20px_20px]";
  if (!diff.before && diff.after) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-2 bg-green-950/40 border-b border-border text-green-400 text-xs font-sans font-medium">New file</div>
        <div className={`flex-1 flex items-center justify-center p-6 ${checker}`}>
          <img src={diff.after} className="max-w-full max-h-full object-contain drop-shadow-xl rounded" />
        </div>
      </div>
    );
  }
  if (diff.before && !diff.after) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-2 bg-red-950/40 border-b border-border text-red-400 text-xs font-sans font-medium">Deleted file</div>
        <div className={`flex-1 flex items-center justify-center p-6 ${checker} opacity-50`}>
          <img src={diff.before} className="max-w-full max-h-full object-contain drop-shadow-xl rounded" />
        </div>
      </div>
    );
  }
  if (diff.before && diff.after) {
    return (
      <div className="flex flex-col h-full font-sans">
        <div className="grid grid-cols-2 divide-x divide-border border-b border-border flex-shrink-0">
          <div className="px-4 py-2 bg-red-950/30 text-red-400 text-xs font-medium">Before</div>
          <div className="px-4 py-2 bg-green-950/30 text-green-400 text-xs font-medium">After</div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-border flex-1 min-h-0">
          <div className={`flex items-center justify-center p-6 ${checker}`}>
            <img src={diff.before} className="max-w-full max-h-full object-contain drop-shadow-xl rounded" />
          </div>
          <div className={`flex items-center justify-center p-6 ${checker}`}>
            <img src={diff.after} className="max-w-full max-h-full object-contain drop-shadow-xl rounded" />
          </div>
        </div>
      </div>
    );
  }
  return <div className="flex items-center justify-center h-full text-zinc-600 text-sm font-sans">Image not available</div>;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function GitHistoryPanel({ tabId }: { tabId: string }) {
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === tabId));

  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [files, setFiles] = useState<CommitFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [imageDiff, setImageDiff] = useState<ImageDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const diffRef = useRef<HTMLDivElement>(null);

  // ── Fetch commit list, poll every 5s ──────────────────────────────────────
  useEffect(() => {
    if (!tab?.path) return;

    const load = () =>
      invoke<CommitInfo[]>("get_git_log", { path: tab.path })
        .then(setCommits)
        .catch(() => setCommits([]));

    setLoading(true);
    invoke<CommitInfo[]>("get_git_log", { path: tab.path })
      .then((list) => { setCommits(list); setLoading(false); })
      .catch(() => { setCommits([]); setLoading(false); });

    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [tab?.path]);

  // Auto-select first commit
  useEffect(() => {
    if (commits.length > 0 && !selectedHash) {
      setSelectedHash(commits[0].hash);
    }
  }, [commits]);

  // ── Fetch files for selected commit ───────────────────────────────────────
  useEffect(() => {
    if (!tab?.path || !selectedHash) return;
    setFiles([]);
    setSelectedFile(null);
    setDiffLines([]);
    setImageDiff(null);

    invoke<CommitFile[]>("get_commit_files", { path: tab.path, hash: selectedHash })
      .then((list) => {
        setFiles(list);
        if (list.length > 0) setSelectedFile(list[0].path);
      })
      .catch(() => setFiles([]));
  }, [tab?.path, selectedHash]);

  // ── Fetch diff for selected file in commit ────────────────────────────────
  useEffect(() => {
    if (!tab?.path || !selectedHash || !selectedFile) return;
    setDiffLoading(true);
    setDiffLines([]);
    setImageDiff(null);

    if (isImageFile(selectedFile)) {
      invoke<ImageDiff>("get_commit_image_diff", {
        path: tab.path, hash: selectedHash, file: selectedFile,
      })
        .then((d) => { setImageDiff(d); diffRef.current?.scrollTo({ top: 0 }); })
        .catch(() => setImageDiff(null))
        .finally(() => setDiffLoading(false));
    } else {
      invoke<string>("get_commit_file_diff", {
        path: tab.path, hash: selectedHash, file: selectedFile,
      })
        .then((raw) => { setDiffLines(parseDiffLines(raw)); diffRef.current?.scrollTo({ top: 0 }); })
        .catch(() => setDiffLines([]))
        .finally(() => setDiffLoading(false));
    }
  }, [tab?.path, selectedHash, selectedFile]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading && commits.length === 0) {
    return <div className="flex items-center justify-center h-full text-zinc-500 text-sm">Loading history…</div>;
  }

  if (commits.length === 0) {
    return <div className="flex items-center justify-center h-full text-zinc-600 text-sm">No commits found</div>;
  }

  const selectedCommit = commits.find((c) => c.hash === selectedHash) ?? null;

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Commit list ─────────────────────────────────────────────────── */}
      <div className="w-72 flex-shrink-0 border-r border-border flex flex-col overflow-hidden bg-sidebar">
        <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500 border-b border-border flex-shrink-0">
          {commits.length} commits
        </div>
        <div className="flex-1 overflow-y-auto">
          {commits.map((commit) => {
            const isActive = commit.hash === selectedHash;
            return (
              <button
                key={commit.hash}
                onClick={() => setSelectedHash(commit.hash)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/40 transition-colors flex flex-col gap-0.5 ${
                  isActive
                    ? "bg-accent/15 border-l-2 border-l-accent"
                    : "hover:bg-zinc-800/50 border-l-2 border-l-transparent"
                }`}
              >
                {/* Top row: badge + hash + date */}
                <div className="flex items-center gap-1.5">
                  {commit.is_local ? (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-yellow-500/20 text-yellow-400 uppercase tracking-wide flex-shrink-0">
                      local
                    </span>
                  ) : (
                    <span className="w-3 h-3 rounded-full bg-zinc-600/60 flex-shrink-0 flex items-center justify-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-zinc-500 flex-shrink-0">
                    {commit.short_hash}
                  </span>
                  <span className="text-[10px] text-zinc-600 ml-auto flex-shrink-0">
                    {commit.date}
                  </span>
                </div>

                {/* Commit message */}
                <p className={`text-xs leading-snug truncate ${isActive ? "text-zinc-100" : "text-zinc-300"}`}>
                  {commit.message}
                </p>

                {/* Author */}
                <p className="text-[10px] text-zinc-600 truncate">{commit.author}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right side: files + diff ─────────────────────────────────────── */}
      {selectedCommit ? (
        <div className="flex flex-1 min-w-0 overflow-hidden">

          {/* File list */}
          <div className="w-48 flex-shrink-0 border-r border-border flex flex-col overflow-hidden bg-sidebar">
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500 border-b border-border flex-shrink-0">
              {files.length} file{files.length !== 1 ? "s" : ""}
            </div>
            <div className="flex-1 overflow-y-auto">
              {files.map((f) => {
                const meta = statusMeta(f.status);
                const active = f.path === selectedFile;
                return (
                  <button
                    key={f.path}
                    onClick={() => setSelectedFile(f.path)}
                    className={`w-full text-left px-3 py-1.5 flex items-start gap-2 transition-colors ${
                      active ? "bg-accent/15 text-white" : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                    }`}
                  >
                    <span className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center ${meta.bg} ${meta.text}`}>
                      {meta.label}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs truncate leading-tight">{basename(f.path)}</span>
                      {dirname(f.path) && (
                        <span className="block text-[10px] text-zinc-600 truncate leading-tight mt-0.5">
                          {dirname(f.path)}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
              {files.length === 0 && (
                <p className="text-xs text-zinc-600 text-center mt-6 px-2">No files changed</p>
              )}
            </div>
          </div>

          {/* Diff viewer */}
          <div ref={diffRef} className="flex-1 overflow-auto">
            {diffLoading ? (
              <div className="flex items-center justify-center h-full text-zinc-500 text-sm">Loading…</div>
            ) : imageDiff ? (
              <ImageDiffView diff={imageDiff} />
            ) : diffLines.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-600">
                <span className="text-2xl">○</span>
                <span className="text-sm">Select a file to see changes</span>
              </div>
            ) : (
              <DiffTable lines={diffLines} />
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
          Select a commit
        </div>
      )}
    </div>
  );
}
