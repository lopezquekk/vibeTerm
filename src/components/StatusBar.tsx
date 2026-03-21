import { useTabStore } from "../store/tabStore";

export default function StatusBar() {
  const { tabs, activeTabId } = useTabStore();
  const tab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 bg-zinc-900 border-t border-border text-xs font-mono flex-shrink-0">
      {tab?.git ? (
        <>
          <span className="flex items-center gap-1.5 text-yellow-400">
            <span>⎇</span>
            <span>{tab.git.branch}</span>
          </span>

          {(tab.git.modified > 0 || tab.git.added > 0 || tab.git.deleted > 0) && (
            <>
              <span className="text-zinc-600">|</span>
              <span className="text-zinc-400">
                {tab.git.modified + tab.git.added + tab.git.deleted} files changed
              </span>
              {tab.git.added > 0 && (
                <span className="text-green-400">+{tab.git.added}</span>
              )}
              {tab.git.deleted > 0 && (
                <span className="text-red-400">-{tab.git.deleted}</span>
              )}
              {tab.git.modified > 0 && (
                <span className="text-yellow-400">M {tab.git.modified}</span>
              )}
            </>
          )}

          {tab.git.ahead > 0 && (
            <span className="text-blue-400">↑{tab.git.ahead}</span>
          )}
          {tab.git.behind > 0 && (
            <span className="text-purple-400">↓{tab.git.behind}</span>
          )}
        </>
      ) : (
        <span className="text-zinc-600">
          {tab ? tab.path : "No context selected"}
        </span>
      )}

      <div className="flex-1" />

      <span className="text-zinc-600">vibeTerm</span>
    </div>
  );
}
