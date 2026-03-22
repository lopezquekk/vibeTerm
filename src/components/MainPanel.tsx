import { useEffect, useState } from "react";
import { useTabStore } from "../store/tabStore";
import TerminalView from "./TerminalView";
import GitDiffPanel from "./GitDiffPanel";
import GitHistoryPanel from "./GitHistoryPanel";
import ChangesPanel from "./ChangesPanel";

const PANEL_TABS = [
  { id: "terminal", label: "Terminal", icon: "⊡" },
  { id: "diff", label: "Git Diff", icon: "≋" },
  { id: "changes", label: "Changes", icon: "⊞" },
  { id: "history", label: "History", icon: "◷" },
] as const;

export default function MainPanel() {
  const { tabs, activeTabId, activePanelTab, setActivePanelTab } = useTabStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Track which tabs have an active split pane (persists across tab switches)
  const [splitTabs, setSplitTabs] = useState<Set<string>>(new Set());

  const isSplit = activeTab ? splitTabs.has(activeTab.id) : false;

  const toggleSplit = () => {
    if (!activeTab) return;
    setSplitTabs((prev) => {
      const next = new Set(prev);
      if (next.has(activeTab.id)) next.delete(activeTab.id);
      else next.add(activeTab.id);
      return next;
    });
  };

  // ⌘D → toggle split (only when on terminal tab)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "d" && activePanelTab === "terminal") {
        e.preventDefault();
        toggleSplit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab?.id, activePanelTab]);

  // Clean up split state when a tab is removed
  useEffect(() => {
    const tabIds = new Set(tabs.map((t) => t.id));
    setSplitTabs((prev) => {
      const next = new Set([...prev].filter((id) => tabIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [tabs]);

  if (!activeTab) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface">
        <div className="text-center">
          <p className="text-4xl mb-4">🚀</p>
          <p className="text-zinc-400 text-sm">Bienvenido a vibeTerm</p>
          <p className="text-zinc-600 text-xs mt-1">
            Crea un contexto en el sidebar para empezar
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-surface">
      {/* Panel tab bar */}
      <div className="flex items-center border-b border-border bg-sidebar px-2 flex-shrink-0">
        {PANEL_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActivePanelTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
              activePanelTab === tab.id
                ? "border-accent text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}

        {/* Split toggle — only visible on Terminal tab */}
        {activePanelTab === "terminal" && (
          <button
            onClick={toggleSplit}
            title={isSplit ? "Close split (⌘D)" : "Split terminal (⌘D)"}
            className={`ml-auto mr-1 w-7 h-7 flex items-center justify-center rounded transition-colors ${
              isSplit
                ? "text-accent bg-accent/10 hover:bg-accent/20"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50"
            }`}
          >
            {/* Two-pane icon */}
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="2" width="13" height="11" rx="1.5" />
              <line x1="7.5" y1="2" x2="7.5" y2="13" />
            </svg>
          </button>
        )}
      </div>

      {/* Panel content */}
      <div className="flex-1 min-h-0 relative">
        {/*
          All terminal views are always mounted (CSS controls visibility).
          Each tab's main pane is wrapped in a keyed div so its TerminalView
          is never remounted when the split layout changes — only the wrapper's
          className updates, leaving the PTY session alive.
        */}
        {tabs.map((tab) => {
          const split = splitTabs.has(tab.id);
          const visible = activePanelTab === "terminal" && tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={visible ? (split ? "flex h-full" : "block h-full") : "hidden"}
            >
              {/* Stable keyed wrapper — className changes don't remount TerminalView */}
              <div
                key={tab.id + "-main"}
                className={split ? "flex-1 min-w-0 overflow-hidden" : "h-full w-full"}
              >
                <TerminalView tabId={tab.id} path={tab.path} />
              </div>

              {split && (
                <>
                  {/* Divider */}
                  <div className="w-px bg-border flex-shrink-0" />
                  {/* Split pane — mounted when split is on, unmounted (→ kill PTY) when off */}
                  <div className="flex-1 min-w-0 overflow-hidden relative group/split">
                    <TerminalView tabId={tab.id + "-split"} path={tab.path} />
                    {/* Close split button — appears on hover */}
                    <button
                      onClick={toggleSplit}
                      title="Close split (⌘D)"
                      className="absolute top-2 right-2 z-10 w-5 h-5 flex items-center justify-center rounded bg-zinc-800/80 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 opacity-0 group-hover/split:opacity-100 transition-opacity text-[10px]"
                    >
                      ✕
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}

        <div className={activePanelTab === "diff" ? "block h-full" : "hidden"}>
          <GitDiffPanel tabId={activeTab.id} />
        </div>
        <div className={activePanelTab === "changes" ? "block h-full" : "hidden"}>
          <ChangesPanel tabId={activeTab.id} />
        </div>
        <div className={activePanelTab === "history" ? "block h-full" : "hidden"}>
          <GitHistoryPanel tabId={activeTab.id} />
        </div>
      </div>
    </div>
  );
}
