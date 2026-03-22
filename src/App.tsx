import { useEffect } from "react";
import Sidebar from "./components/Sidebar";
import MainPanel from "./components/MainPanel";
import StatusBar from "./components/StatusBar";
import { useTabStore } from "./store/tabStore";
import { transport, hasToken } from "./transport/factory";

const IS_TAURI = typeof (window as any).__TAURI_INTERNALS__ !== "undefined";

function App() {
  const { tabs, addTab, sidebarMode, setSidebarMode, updateTab } = useTabStore();

  // Create default tab on first launch
  useEffect(() => {
    if (tabs.length === 0) {
      addTab({ alias: "My Project", path: "~" });
    }
  }, []);

  // Eagerly populate git status + worktree info for all persisted tabs on startup (Tauri only)
  useEffect(() => {
    if (!IS_TAURI) return;
    for (const tab of tabs) {
      transport.getGitStatus(tab.path)
        .then((git) => updateTab(tab.id, { git }))
        .catch(() => {});
      transport.getWorktreeMain(tab.path)
        .then((main) => updateTab(tab.id, { worktreeOf: main ?? null }))
        .catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cmd+\ → toggle hidden ↔ docked (or floating if was floating)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "\\") {
        e.preventDefault();
        setSidebarMode(sidebarMode === "hidden" ? "docked" : "hidden");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [sidebarMode, setSidebarMode]);

  const isFloating = sidebarMode === "floating";
  const isHidden = sidebarMode === "hidden";

  // Browser remote access: no token = user hasn't scanned QR yet
  if (!IS_TAURI && !hasToken()) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface text-text">
        <div className="flex flex-col items-center gap-4 text-center px-6">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-500">
            <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="3" height="3" rx="0.5"/>
            <rect x="19" y="14" width="2" height="2" rx="0.5"/><rect x="14" y="19" width="2" height="2" rx="0.5"/>
            <rect x="18" y="18" width="3" height="3" rx="0.5"/>
          </svg>
          <p className="text-sm text-zinc-400">Scan the QR code in vibeTerm<br/>or use the full URL with token</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface relative">
      {/* Floating backdrop — click outside the sidebar to dismiss it */}
      {isFloating && (
        <div
          className="absolute inset-0 z-40"
          onClick={() => setSidebarMode("hidden")}
        />
      )}

      {/* Sidebar — docked (in flow) or floating (absolute, above backdrop) */}
      {!isHidden && (
        <div
          className={
            isFloating
              ? "absolute left-0 top-0 h-full z-50 shadow-2xl shadow-black/60"
              : "relative flex-shrink-0"
          }
        >
          <Sidebar />
        </div>
      )}

      {/* Hidden-mode: thin left strip — click to open as floating */}
      {isHidden && (
        <button
          className="absolute left-0 top-0 h-full w-1.5 z-50 bg-border/60 hover:bg-accent hover:w-2 transition-all cursor-pointer"
          title="Open sidebar (⌘\)"
          onClick={() => setSidebarMode("floating")}
        />
      )}

      <div className="flex flex-col flex-1 min-w-0">
        <MainPanel />
        <StatusBar />
      </div>
    </div>
  );
}

export default App;
