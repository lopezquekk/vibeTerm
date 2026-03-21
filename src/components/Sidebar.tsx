import { useState } from "react";
import { useTabStore, Tab, TabType } from "../store/tabStore";

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

  const handleDoubleClick = () => {
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
      onClick={() => setActiveTab(tab.id)}
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

        {/* Status dot */}
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            tab.status === "running"
              ? "bg-green-400"
              : tab.status === "error"
              ? "bg-red-400"
              : "bg-zinc-600"
          }`}
        />

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
          <span
            className={`text-xs font-mono ${
              tab.git.isDirty ? "text-yellow-400" : "text-green-400"
            }`}
          >
            {tab.git.branch}
          </span>
        )}
        <span className="text-xs text-zinc-500 font-mono truncate">
          {shortPath}
        </span>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const { tabs, activeTabId, addTab } = useTabStore();

  return (
    <div className="flex flex-col w-64 flex-shrink-0 bg-sidebar border-r border-border h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold text-zinc-300 tracking-wide">
          vibeTerm
        </span>
        <button
          className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors text-lg leading-none"
          onClick={() => addTab({ alias: "New Context", path: "~" })}
          title="New context"
        >
          +
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
