import { useTabStore } from "../store/tabStore";
import TerminalView from "./TerminalView";
import GitDiffPanel from "./GitDiffPanel";
import GitHistoryPanel from "./GitHistoryPanel";

const PANEL_TABS = [
  { id: "terminal", label: "Terminal", icon: "⊡" },
  { id: "diff", label: "Git Diff", icon: "≋" },
  { id: "changes", label: "Changes", icon: "⊞" },
  { id: "history", label: "History", icon: "◷" },
] as const;

export default function MainPanel() {
  const { tabs, activeTabId, activePanelTab, setActivePanelTab } = useTabStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

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
      </div>

      {/* Panel content */}
      <div className="flex-1 min-h-0 relative">
        {/* All terminal views are always mounted; CSS controls which one is visible */}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={
              activePanelTab === "terminal" && tab.id === activeTabId
                ? "block h-full"
                : "hidden"
            }
          >
            <TerminalView tabId={tab.id} path={tab.path} />
          </div>
        ))}
        <div className={activePanelTab === "diff" ? "block h-full" : "hidden"}>
          <GitDiffPanel tabId={activeTab.id} />
        </div>
        <div className={activePanelTab === "changes" ? "block h-full overflow-auto" : "hidden"}>
          <div className="p-4 text-zinc-500 text-sm">Changes panel — próximamente</div>
        </div>
        <div className={activePanelTab === "history" ? "block h-full" : "hidden"}>
          <GitHistoryPanel tabId={activeTab.id} />
        </div>
      </div>
    </div>
  );
}
