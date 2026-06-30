import { useRef, useState } from "react";
import { transport } from "../transport/factory";
import { useTabStore, Tab } from "../store/tabStore";
import BranchPicker from "./BranchPicker";
import RemoteAccessPanel from "./RemoteAccessPanel";
import { TYPE_ICONS, TYPE_COLORS } from "./tabTheme";
import { usePromptStore } from "../store/promptStore";
import { useUiStore } from "../store/uiStore";
import { useSettingsStore } from "../store/settingsStore";

const IS_TAURI = typeof (window as any).__TAURI_INTERNALS__ !== "undefined";

// Worktree tabs use violet dashed border
const WORKTREE_COLOR = "#8b5cf6";

// Returns tabs in display order: worktree children appear right after their parent.
function groupedTabs(tabs: Tab[]): { tab: Tab; isWorktree: boolean }[] {
  const result: { tab: Tab; isWorktree: boolean }[] = [];
  const placed = new Set<string>();

  const findParent = (child: Tab) =>
    tabs.find(
      (t) =>
        t.id !== child.id &&
        child.worktreeOf !== null &&
        (t.path === child.worktreeOf ||
          t.path.startsWith(child.worktreeOf + "/"))
    );

  for (const tab of tabs) {
    if (placed.has(tab.id)) continue;
    // If this tab has a parent in the list, skip it for now
    if (tab.worktreeOf && findParent(tab)) continue;

    result.push({ tab, isWorktree: false });
    placed.add(tab.id);

    // Place worktree children of this tab immediately after
    for (const other of tabs) {
      if (placed.has(other.id) || !other.worktreeOf) continue;
      const parent = findParent(other);
      if (parent?.id === tab.id) {
        result.push({ tab: other, isWorktree: true });
        placed.add(other.id);
      }
    }
  }

  // Orphaned worktrees (parent tab not in list) — render flat
  for (const tab of tabs) {
    if (!placed.has(tab.id)) result.push({ tab, isWorktree: false });
  }

  return result;
}

function TabItem({ tab, isActive, isWorktree = false }: { tab: Tab; isActive: boolean; isWorktree?: boolean }) {
  const { setActiveTab, removeTab, updateTab } = useTabStore();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(tab.alias);
  const [branchAnchor, setBranchAnchor] = useState<DOMRect | null>(null);
  const branchBtnRef = useRef<HTMLButtonElement>(null);

  const hasPrompt = usePromptStore(
    (s) =>
      s.current?.tabId.replace(/-split$/, "") === tab.id ||
      s.queue.some((q) => q.tabId.replace(/-split$/, "") === tab.id)
  );

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (!IS_TAURI) return;
    e.stopPropagation();
    setEditing(true);
    setEditValue(tab.alias);
  };

  const handleRename = () => {
    if (editValue.trim()) {
      updateTab(tab.id, { alias: editValue.trim() });
    }
    setEditing(false);
  };

  const shortPath = tab.path.replace(/^\/Users\/[^/]+/, "~");

  const accent = isWorktree ? WORKTREE_COLOR : TYPE_COLORS[tab.type];

  return (
    <div
      style={{
        // Active: full-strength type color border + tinted bg + glow.
        // Inactive: dimmed border so the active tab clearly stands out.
        borderColor: isActive ? accent : `${accent}33`,
        borderLeftColor: accent,
        borderLeftWidth: isActive ? "4px" : "2px",
        backgroundColor: isActive ? `${accent}22` : undefined,
        boxShadow: isActive ? `0 0 0 1px ${accent}66, 0 0 12px ${accent}40` : undefined,
      }}
      className={`group flex flex-col px-3 py-2.5 cursor-pointer rounded-md mb-1 transition-all border
        ${isWorktree ? "ml-4 mr-2 border-dashed" : "mx-2"}
        ${isActive ? "" : "opacity-75 hover:opacity-100 hover:bg-sidebar-hover"}`}
      onClick={() => !editing && setActiveTab(tab.id)}
      onDoubleClick={handleDoubleClick}
    >
      <div className="flex items-center gap-2">
        {/* Type icon / worktree indicator */}
        {isWorktree ? (
          <span className="text-accent/70 text-xs w-5 text-center font-mono flex-shrink-0" title="Git worktree">
            ⎇
          </span>
        ) : (
          <span className="text-zinc-400 text-xs w-5 text-center font-mono flex-shrink-0">
            {TYPE_ICONS[tab.type]}
          </span>
        )}

        {/* Alias */}
        {editing ? (
          <input
            autoFocus
            className="flex-1 bg-zinc-800 text-white text-sm px-1 rounded outline-none border border-accent"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") setEditing(false);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={`flex-1 text-sm truncate ${isActive ? "font-semibold text-white" : "font-medium text-zinc-100"}`}>
            {tab.alias}
          </span>
        )}

        {/* Activity / status indicator */}
        {hasPrompt ? (
          <span className="text-amber-400 text-xs flex-shrink-0 animate-pulse" title="Esperando tu respuesta">❗</span>
        ) : tab.hasActivity ? (
          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-blue-400 animate-pulse" title="New activity" />
        ) : (
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              tab.status === "running"
                ? "bg-green-400"
                : tab.status === "error"
                ? "bg-red-400"
                : "bg-zinc-600"
            }`}
          />
        )}

        {/* Remove button */}
        <button
          className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-200 text-xs ml-1 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            if (useSettingsStore.getState().confirmTabClose && !window.confirm(`¿Cerrar "${tab.alias}"?`)) return;
            removeTab(tab.id);
          }}
        >
          ✕
        </button>
      </div>

      {/* Git + path row */}
      <div className="flex items-center gap-2 mt-1 ml-7">
        {tab.git && (
          <button
            ref={branchBtnRef}
            className={`text-xs font-mono truncate max-w-[7rem] hover:underline underline-offset-2 transition-colors ${
              tab.git.isDirty ? "text-yellow-400 hover:text-yellow-300" : "text-green-400 hover:text-green-300"
            }`}
            title="Switch branch"
            onClick={(e) => {
              e.stopPropagation();
              setBranchAnchor(branchBtnRef.current!.getBoundingClientRect());
            }}
          >
            ⎇ {tab.git.branch}
          </button>
        )}
        <span className="text-xs text-zinc-500 font-mono truncate">
          {shortPath}
        </span>
      </div>

      {/* Branch picker */}
      {branchAnchor && tab.git && (
        <BranchPicker
          repoPath={tab.path}
          anchorRect={branchAnchor}
          onClose={() => setBranchAnchor(null)}
          onSwitched={() => {
            transport.getGitStatus(tab.path)
              .then((git) => updateTab(tab.id, { git }))
              .catch(() => {});
          }}
        />
      )}

      {/* Detected server port */}
      {tab.detectedPort && (
        <div className="flex items-center gap-1.5 mt-1.5 ml-7">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0 animate-pulse" />
          <button
            className="text-[11px] font-mono text-green-400 hover:text-green-300 transition-colors truncate"
            title={`Open ${tab.detectedPort}`}
            onClick={(e) => {
              e.stopPropagation();
              transport.openUrl(tab.detectedPort!);
            }}
          >
            {tab.detectedPort.replace(/^https?:\/\//, "")}
          </button>
          <button
            className="ml-auto text-[9px] text-zinc-600 hover:text-zinc-400 transition-colors flex-shrink-0"
            title="Dismiss"
            onClick={(e) => {
              e.stopPropagation();
              updateTab(tab.id, { detectedPort: null });
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const { tabs, activeTabId, addTab, sidebarMode, setSidebarMode } = useTabStore();
  const openSettings = useUiStore((s) => s.openSettings);

  return (
    <div className="flex flex-col w-64 flex-shrink-0 bg-sidebar border-r border-border h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border gap-1">
        <span className="text-sm font-semibold text-zinc-300 tracking-wide flex-1">
          vibeTerm
        </span>

        {/* New context */}
        {IS_TAURI && (
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors text-lg leading-none"
            onClick={() => addTab({ alias: "New Context", path: "~" })}
            title="New context"
          >
            +
          </button>
        )}

        {/* Pin button — only shown when floating, anchors sidebar to docked */}
        {sidebarMode === "floating" && (
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-accent hover:bg-zinc-700 transition-colors"
            title="Pin sidebar (⌘\)"
            onClick={() => setSidebarMode("docked")}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6.5" y1="1" x2="6.5" y2="8" />
              <line x1="6.5" y1="12" x2="6.5" y2="10" />
              <line x1="3" y1="5" x2="10" y2="5" />
              <line x1="3" y1="5" x2="3" y2="8" />
              <line x1="10" y1="5" x2="10" y2="8" />
              <line x1="3" y1="8" x2="10" y2="8" />
            </svg>
          </button>
        )}

        {/* Settings */}
        <button
          className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-accent hover:bg-zinc-700 transition-colors"
          title="Ajustes"
          onClick={openSettings}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {/* Collapse button — hides the sidebar */}
        <button
          className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
          title="Collapse sidebar (⌘\)"
          onClick={() => setSidebarMode("hidden")}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9,3 5,7 9,11" />
          </svg>
        </button>
      </div>

      {/* Remote caption */}
      {!IS_TAURI && (
        <p className="px-3 py-1 text-[10px] text-zinc-600">Tabs are controlled by the desktop</p>
      )}

      {/* Tab list */}
      <div className="flex-1 overflow-y-auto py-2">
        {groupedTabs(tabs).map(({ tab, isWorktree }) => (
          <TabItem key={tab.id} tab={tab} isActive={tab.id === activeTabId} isWorktree={isWorktree} />
        ))}

        {tabs.length === 0 && (
          <p className="text-xs text-zinc-600 text-center mt-8 px-4">
            No contexts yet.
            <br />
            Click + to create one.
          </p>
        )}
      </div>
      <RemoteAccessPanel />
    </div>
  );
}
