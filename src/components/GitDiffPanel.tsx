import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "../store/tabStore";

interface DiffFile {
  path: string;
  lines: DiffLine[];
}

interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
  lineNo?: number;
}

function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git")) {
      if (current) files.push(current);
      const match = line.match(/b\/(.+)$/);
      current = { path: match?.[1] ?? "unknown", lines: [] };
    } else if (line.startsWith("@@")) {
      current?.lines.push({ type: "header", content: line });
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      current?.lines.push({ type: "add", content: line.slice(1) });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current?.lines.push({ type: "remove", content: line.slice(1) });
    } else if (current && !line.startsWith("---") && !line.startsWith("+++")) {
      current?.lines.push({ type: "context", content: line.slice(1) });
    }
  }
  if (current) files.push(current);
  return files;
}

export default function GitDiffPanel({ tabId }: { tabId: string }) {
  const { tabs } = useTabStore();
  const tab = tabs.find((t) => t.id === tabId);
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tab?.path) return;

    const fetchDiff = async () => {
      setLoading(true);
      try {
        const raw = await invoke<string>("get_git_diff", { path: tab.path });
        setDiffFiles(parseDiff(raw));
      } catch {
        setDiffFiles([]);
      } finally {
        setLoading(false);
      }
    };

    fetchDiff();
    const interval = setInterval(fetchDiff, 3000);
    return () => clearInterval(interval);
  }, [tab?.path]);

  if (loading && diffFiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Loading diff…
      </div>
    );
  }

  if (diffFiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
        No changes detected
      </div>
    );
  }

  // Split into two columns if more than one file
  const left = diffFiles.filter((_, i) => i % 2 === 0);
  const right = diffFiles.filter((_, i) => i % 2 === 1);

  return (
    <div className="flex h-full overflow-hidden divide-x divide-border">
      {[left, right].map((col, ci) => (
        <div key={ci} className="flex-1 overflow-auto">
          {col.map((file) => (
            <div key={file.path} className="mb-4">
              <div className="px-4 py-2 bg-zinc-900 text-xs text-zinc-300 font-mono border-b border-border sticky top-0">
                Changes in{" "}
                <span className="text-zinc-100 font-semibold">{file.path}</span>
              </div>
              <div className="font-mono text-xs">
                {file.lines.map((line, i) => (
                  <div
                    key={i}
                    className={`px-4 py-0.5 whitespace-pre ${
                      line.type === "add"
                        ? "bg-green-950 text-green-300"
                        : line.type === "remove"
                        ? "bg-red-950 text-red-300"
                        : line.type === "header"
                        ? "bg-zinc-800 text-zinc-400"
                        : "text-zinc-400"
                    }`}
                  >
                    <span className="mr-2 text-zinc-600 select-none">
                      {line.type === "add"
                        ? "+"
                        : line.type === "remove"
                        ? "-"
                        : " "}
                    </span>
                    {line.content}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
