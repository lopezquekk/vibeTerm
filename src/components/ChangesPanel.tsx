import { useCallback, useEffect, useRef, useState } from "react";
import { useGitWatch } from "../hooks/useGitWatch";
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
import type { StashInfo } from "../transport/types";
import { ErrorBanner } from "./ErrorBanner";
import { useErrorHandler } from "../hooks/useErrorHandler";

interface FileEntry {
  path: string;
  status: string;
}

interface WorkdirStatus {
  staged: FileEntry[];
  unstaged: FileEntry[];
}

type Selection = { path: string; area: "staged" | "unstaged" } | null;

// ── File row ──────────────────────────────────────────────────────────────────

function FileRow({
  file,
  isActive,
  onClick,
  actions,
}: {
  file: FileEntry;
  isActive: boolean;
  onClick: () => void;
  actions: React.ReactNode;
}) {
  const meta = statusMeta(file.status);
  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 group cursor-pointer transition-colors ${
        isActive ? "bg-accent/15" : "hover:bg-zinc-800/50"
      }`}
      onClick={onClick}
    >
      <span
        className={`flex-shrink-0 w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center ${meta.bg} ${meta.text}`}
      >
        {meta.label}
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block text-xs truncate leading-tight ${isActive ? "text-white" : "text-zinc-300"}`}>
          {basename(file.path)}
        </span>
        {dirname(file.path) && (
          <span className="block text-[10px] text-zinc-600 truncate leading-tight">
            {dirname(file.path)}
          </span>
        )}
      </span>
      <div className="flex-shrink-0 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {actions}
      </div>
    </div>
  );
}

function ActionBtn({
  onClick,
  title,
  children,
  danger,
}: {
  onClick: (e: React.MouseEvent) => void;
  title: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      className={`w-5 h-5 rounded flex items-center justify-center text-[11px] transition-colors ${
        danger
          ? "hover:bg-red-500/20 text-zinc-500 hover:text-red-400"
          : "hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

// ── Section header ─────────────────────────────────────────────────────────────

function SectionHeader({
  label,
  count,
  action,
}: {
  label: string;
  count: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60 flex-shrink-0">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        {label}
        <span className="ml-1.5 text-zinc-600 font-normal normal-case tracking-normal">
          {count}
        </span>
      </span>
      {action}
    </div>
  );
}

// ── Stash section ──────────────────────────────────────────────────────────────

function StashSection({
  stashes,
  stashMsg,
  stashLoading,
  hasChanges,
  onMsgChange,
  onStash,
  onPop,
  onApply,
  onDrop,
}: {
  stashes: StashInfo[];
  stashMsg: string;
  stashLoading: boolean;
  hasChanges: boolean;
  onMsgChange: (v: string) => void;
  onStash: () => void;
  onPop: (i: number) => void;
  onApply: (i: number) => void;
  onDrop: (i: number) => void;
}) {
  return (
    <div className="flex-shrink-0 border-t border-border">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
          Stashes
          {stashes.length > 0 && (
            <span className="ml-1.5 text-zinc-600 font-normal normal-case tracking-normal">
              {stashes.length}
            </span>
          )}
        </span>
      </div>
      {hasChanges && (
        <div className="flex gap-1.5 px-2 py-1.5 border-b border-border/40">
          <input
            value={stashMsg}
            onChange={(e) => onMsgChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onStash(); }}
            placeholder="Message (optional)"
            className="flex-1 min-w-0 bg-zinc-900 border border-border rounded text-xs text-zinc-200 placeholder-zinc-600 px-2 py-1 focus:outline-none focus:border-accent/60"
          />
          <button
            onClick={onStash}
            disabled={stashLoading}
            className="px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {stashLoading ? "…" : "Stash"}
          </button>
        </div>
      )}
      {stashes.length === 0 ? (
        <p className="text-[11px] text-zinc-600 px-3 py-2">No stashes</p>
      ) : (
        <div className="overflow-y-auto" style={{ maxHeight: "140px" }}>
          {stashes.map((s) => (
            <div
              key={s.index}
              className="flex items-center gap-1.5 px-2 py-1.5 group hover:bg-zinc-800/50 border-b border-border/30 last:border-0"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-300 truncate leading-tight">{s.message}</p>
                <p className="text-[10px] text-zinc-600 leading-tight">{s.date}</p>
              </div>
              <div className="flex-shrink-0 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <ActionBtn onClick={() => onApply(s.index)} title="Apply (keep stash)">↓</ActionBtn>
                <ActionBtn onClick={() => onPop(s.index)} title="Pop (apply and drop)">↩</ActionBtn>
                <ActionBtn onClick={() => onDrop(s.index)} title="Drop stash" danger>✕</ActionBtn>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ChangesPanel({ tabId }: { tabId: string }) {
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === tabId));

  const { toastError } = useErrorHandler();
  const [status, setStatus] = useState<WorkdirStatus>({ staged: [], unstaged: [] });
  const [stashes, setStashes] = useState<StashInfo[]>([]);
  const [stashMsg, setStashMsg] = useState("");
  const [stashLoading, setStashLoading] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [imageDiff, setImageDiff] = useState<ImageDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const diffRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!tab?.path) return;
    try {
      const [s, st] = await Promise.all([
        transport.getWorkdirStatus(tab.path),
        transport.listStashes(tab.path),
      ]);
      setStatus(s);
      setStashes(st);
    } catch (err) {
      toastError(err);
      setStatus({ staged: [], unstaged: [] });
      setStashes([]);
    }
  }, [tab?.path]);

  useEffect(() => { refresh(); }, [refresh]);
  useGitWatch(tabId, tab?.path ?? null, refresh);

  // Fetch diff when selection changes
  useEffect(() => {
    if (!tab?.path || !selection) {
      setDiffLines([]);
      setImageDiff(null);
      return;
    }

    setDiffLoading(true);
    setDiffLines([]);
    setImageDiff(null);

    if (isImageFile(selection.path)) {
      transport.getImageDiff(tab.path, selection.path)
        .then((d) => { setImageDiff(d); diffRef.current?.scrollTo({ top: 0 }); })
        .catch((err) => { toastError(err); setImageDiff(null); })
        .finally(() => setDiffLoading(false));
    } else {
      (selection.area === "staged"
        ? transport.getStagedFileDiff(tab.path, selection.path)
        : transport.getFileDiff(tab.path, selection.path))
        .then((raw) => { setDiffLines(parseDiffLines(raw)); diffRef.current?.scrollTo({ top: 0 }); })
        .catch((err) => { toastError(err); setDiffLines([]); })
        .finally(() => setDiffLoading(false));
    }
  }, [tab?.path, selection?.path, selection?.area]);

  const act = async (
    action: "stage" | "unstage" | "discard" | "stageAll",
    file?: string
  ) => {
    if (!tab?.path) return;
    try {
      if (action === "stage" && file)        await transport.stageFile(tab.path, file);
      else if (action === "unstage" && file) await transport.unstageFile(tab.path, file);
      else if (action === "discard" && file) await transport.discardFile(tab.path, file);
      else if (action === "stageAll")        await transport.stageAll(tab.path);
    } catch (err) { toastError(err); }
    await refresh();
  };

  const handleCommit = async () => {
    if (!tab?.path || !commitMsg.trim() || status.staged.length === 0) return;
    setCommitting(true);
    setCommitError(null);
    try {
      await transport.gitCommit(tab.path, commitMsg.trim());
      setCommitMsg("");
      setSelection(null);
      await refresh();
    } catch (e) {
      setCommitError(String(e));
    } finally {
      setCommitting(false);
    }
  };

  const handleStash = async () => {
    if (!tab?.path) return;
    setStashLoading(true);
    try {
      await transport.stashPush(tab.path, stashMsg.trim());
      setStashMsg("");
      setSelection(null);
      await refresh();
    } catch (err) { toastError(err); }
    finally { setStashLoading(false); }
  };

  const handleStashPop = async (index: number) => {
    if (!tab?.path) return;
    try { await transport.stashPop(tab.path, index); await refresh(); }
    catch (err) { toastError(err); }
  };

  const handleStashApply = async (index: number) => {
    if (!tab?.path) return;
    try { await transport.stashApply(tab.path, index); await refresh(); }
    catch (err) { toastError(err); }
  };

  const handleStashDrop = async (index: number) => {
    if (!tab?.path) return;
    try { await transport.stashDrop(tab.path, index); await refresh(); }
    catch (err) { toastError(err); }
  };

  const isEmpty = status.staged.length === 0 && status.unstaged.length === 0;

  if (isEmpty && stashes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-600">
        <span className="text-3xl">✓</span>
        <span className="text-sm">Working tree clean</span>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-sidebar">
        <div className="flex flex-col items-center justify-center flex-1 gap-2 text-zinc-600">
          <span className="text-3xl">✓</span>
          <span className="text-sm">Working tree clean</span>
        </div>
        <StashSection
          stashes={stashes}
          stashMsg={stashMsg}
          stashLoading={stashLoading}
          hasChanges={false}
          onMsgChange={setStashMsg}
          onStash={handleStash}
          onPop={handleStashPop}
          onApply={handleStashApply}
          onDrop={handleStashDrop}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: file lists + commit box ─────────────────────────────────── */}
      <div className="w-64 flex-shrink-0 border-r border-border flex flex-col overflow-hidden bg-sidebar">

        {/* Staged */}
        <SectionHeader
          label="Staged"
          count={status.staged.length}
          action={
            status.staged.length > 0 ? (
              <button
                onClick={() => act("unstage", ".")}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-1"
                title="Unstage all"
              >
                unstage all
              </button>
            ) : undefined
          }
        />
        <div className="overflow-y-auto flex-shrink-0" style={{ maxHeight: "40%" }}>
          {status.staged.length === 0 ? (
            <p className="text-[11px] text-zinc-600 px-3 py-2">No staged files</p>
          ) : (
            status.staged.map((f) => (
              <FileRow
                key={`staged-${f.path}`}
                file={f}
                isActive={selection?.path === f.path && selection?.area === "staged"}
                onClick={() => setSelection({ path: f.path, area: "staged" })}
                actions={
                  <ActionBtn onClick={() => act("unstage", f.path)} title="Unstage">−</ActionBtn>
                }
              />
            ))
          )}
        </div>

        {/* Unstaged */}
        <SectionHeader
          label="Unstaged"
          count={status.unstaged.length}
          action={
            status.unstaged.length > 0 ? (
              <button
                onClick={() => act("stageAll")}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-1"
                title="Stage all"
              >
                stage all
              </button>
            ) : undefined
          }
        />
        <div className="overflow-y-auto flex-1">
          {status.unstaged.length === 0 ? (
            <p className="text-[11px] text-zinc-600 px-3 py-2">No unstaged files</p>
          ) : (
            status.unstaged.map((f) => (
              <FileRow
                key={`unstaged-${f.path}`}
                file={f}
                isActive={selection?.path === f.path && selection?.area === "unstaged"}
                onClick={() => setSelection({ path: f.path, area: "unstaged" })}
                actions={
                  <>
                    <ActionBtn onClick={() => act("stage", f.path)} title="Stage">+</ActionBtn>
                    {f.status !== "??" && (
                      <ActionBtn onClick={() => act("discard", f.path)} title="Discard changes" danger>✕</ActionBtn>
                    )}
                  </>
                }
              />
            ))
          )}
        </div>

        {/* Commit box */}
        <div className="flex-shrink-0 border-t border-border p-2 flex flex-col gap-1.5">
          <textarea
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.metaKey) handleCommit();
            }}
            placeholder="Commit message (⌘↵ to commit)"
            rows={3}
            className="w-full bg-zinc-900 border border-border rounded text-xs text-zinc-200 placeholder-zinc-600 px-2 py-1.5 resize-none focus:outline-none focus:border-accent/60 font-sans"
          />
          {commitError && (
            <ErrorBanner
              message={commitError}
              type="error"
              onDismiss={() => setCommitError(null)}
            />
          )}
          <button
            onClick={handleCommit}
            disabled={!commitMsg.trim() || status.staged.length === 0 || committing}
            className="w-full py-1.5 rounded text-xs font-medium transition-colors bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {committing ? "Committing…" : `Commit ${status.staged.length > 0 ? `(${status.staged.length})` : ""}`}
          </button>
        </div>

        <StashSection
          stashes={stashes}
          stashMsg={stashMsg}
          stashLoading={stashLoading}
          hasChanges={true}
          onMsgChange={setStashMsg}
          onStash={handleStash}
          onPop={handleStashPop}
          onApply={handleStashApply}
          onDrop={handleStashDrop}
        />
      </div>

      {/* ── Right: diff viewer ────────────────────────────────────────────── */}
      <div ref={diffRef} className="flex-1 overflow-auto">
        {!selection ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-600">
            <span className="text-2xl">⊟</span>
            <span className="text-sm">Select a file to see its diff</span>
          </div>
        ) : diffLoading ? (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">Loading…</div>
        ) : imageDiff ? (
          <ImageDiffView diff={imageDiff} />
        ) : diffLines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-600">
            <span className="text-sm">No diff available</span>
          </div>
        ) : (
          <DiffTable lines={diffLines} />
        )}
      </div>
    </div>
  );
}
