import { useEffect, useRef, useState } from "react";
import { transport } from "../transport/factory";
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
      transport.getGitLog(tab.path)
        .then(setCommits)
        .catch(() => setCommits([]));

    setLoading(true);
    transport.getGitLog(tab.path)
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

    transport.getCommitFiles(tab.path, selectedHash)
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
      transport.getCommitImageDiff(tab.path, selectedHash, selectedFile)
        .then((d) => { setImageDiff(d); diffRef.current?.scrollTo({ top: 0 }); })
        .catch(() => setImageDiff(null))
        .finally(() => setDiffLoading(false));
    } else {
      transport.getCommitFileDiff(tab.path, selectedHash, selectedFile)
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
