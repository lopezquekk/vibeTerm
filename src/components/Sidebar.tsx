import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTabStore, Tab, TabType } from "../store/tabStore";
import BranchPicker from "./BranchPicker";

const TYPE_ICONS: Record<TabType, string> = {
  project: "◈",
  frontend: "</>",
  backend: "⊛",
  infra: "⚙",
  logs: "≡",
  database: "⊕",
};

function TabItem({ tab, isActive }: { tab: Tab; isActive: boolean }) {
  const { setActiveTab, removeTab, updateTab } = useTabStore();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(tab.alias);
  const [branchAnchor, setBranchAnchor] = useState<DOMRect | null>(null);
  const branchBtnRef = useRef<HTMLButtonElement>(null);

  const handleDoubleClick = (e: React.MouseEvent) => {
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

  return (
    <div
      className={`group flex flex-col px-3 py-2.5 cursor-pointer rounded-md mx-2 mb-1 transition-colors ${
        isActive
          ? "bg-sidebar-active border border-border"
          : "hover:bg-sidebar-hover border border-transparent"
      }`}
      onClick={() => !editing && setActiveTab(tab.id)}
      onDoubleClick={handleDoubleClick}
    >
      <div className="flex items-center gap-2">
        {/* Type icon */}
        <span className="text-zinc-400 text-xs w-5 text-center font-mono flex-shrink-0">
          {TYPE_ICONS[tab.type]}
        </span>

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
          <span className="flex-1 text-sm font-medium text-zinc-100 truncate">
            {tab.alias}
          </span>
        )}

        {/* Activity / status indicator */}
        {tab.hasActivity ? (
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
            invoke<import("../store/tabStore").GitStatus>("get_git_status", { path: tab.path })
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
              invoke("open_url", { url: tab.detectedPort });
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

  return (
    <div className="flex flex-col w-64 flex-shrink-0 bg-sidebar border-r border-border h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border gap-1">
        <span className="text-sm font-semibold text-zinc-300 tracking-wide flex-1">
          vibeTerm
        </span>

        {/* New context */}
        <button
          className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors text-lg leading-none"
          onClick={() => addTab({ alias: "New Context", path: "~" })}
          title="New context"
        >
          +
        </button>

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

      {/* Tab list */}
      <div className="flex-1 overflow-y-auto py-2">
        {tabs.map((tab) => (
          <TabItem key={tab.id} tab={tab} isActive={tab.id === activeTabId} />
        ))}

        {tabs.length === 0 && (
          <p className="text-xs text-zinc-600 text-center mt-8 px-4">
            No contexts yet.
            <br />
            Click + to create one.
          </p>
        )}
      </div>
    </div>
  );
}
