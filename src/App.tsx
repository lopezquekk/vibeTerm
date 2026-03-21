import { useEffect } from "react";
import Sidebar from "./components/Sidebar";
import MainPanel from "./components/MainPanel";
import StatusBar from "./components/StatusBar";
import { useTabStore } from "./store/tabStore";

function App() {
  const { tabs, addTab } = useTabStore();

  // Create default tab on first launch
  useEffect(() => {
    if (tabs.length === 0) {
      addTab({ alias: "My Project", path: "~" });
    }
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <MainPanel />
        <StatusBar />
      </div>
    </div>
  );
}

export default App;
