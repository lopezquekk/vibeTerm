import { useEffect } from "react";
import Sidebar from "./components/Sidebar";
import MainPanel from "./components/MainPanel";
import StatusBar from "./components/StatusBar";
import { useTabStore } from "./store/tabStore";

function App() {
  const { tabs, addTab, sidebarMode, setSidebarMode } = useTabStore();

  // Create default tab on first launch
  useEffect(() => {
    if (tabs.length === 0) {
      addTab({ alias: "My Project", path: "~" });
    }
  }, []);

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
