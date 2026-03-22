/**
 * Shared diff utilities used by GitDiffPanel and GitHistoryPanel.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ImageDiff {
  before: string | null;
  after: string | null;
}

export interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
  oldLine?: number;
  newLine?: number;
}

// ── File helpers ──────────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "tiff", "tif", "avif",
]);

export function isImageFile(path: string): boolean {
  return IMAGE_EXTS.has(path.split(".").pop()?.toLowerCase() ?? "");
}

export function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

export function dirname(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

// ── Diff parser ───────────────────────────────────────────────────────────────

export function parseDiffLines(raw: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of raw.split("\n")) {
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("---") ||
      line.startsWith("+++")
    ) {
      continue;
    }
    if (line.startsWith("@@")) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldLine = parseInt(m[1]);
        newLine = parseInt(m[2]);
      }
      lines.push({ type: "header", content: line });
    } else if (line.startsWith("+")) {
      lines.push({ type: "add", content: line.slice(1), newLine: newLine++ });
    } else if (line.startsWith("-")) {
      lines.push({ type: "remove", content: line.slice(1), oldLine: oldLine++ });
    } else if (line.length > 0) {
      lines.push({ type: "context", content: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
    }
  }
  return lines;
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; bg: string; text: string }> = {
  M:    { label: "M", bg: "bg-yellow-500/15", text: "text-yellow-400" },
  MM:   { label: "M", bg: "bg-yellow-500/15", text: "text-yellow-400" },
  AM:   { label: "M", bg: "bg-yellow-500/15", text: "text-yellow-400" },
  A:    { label: "A", bg: "bg-green-500/15",  text: "text-green-400"  },
  D:    { label: "D", bg: "bg-red-500/15",    text: "text-red-400"    },
  AD:   { label: "D", bg: "bg-red-500/15",    text: "text-red-400"    },
  R:    { label: "R", bg: "bg-blue-500/15",   text: "text-blue-400"   },
  "??": { label: "U", bg: "bg-purple-500/15", text: "text-purple-400" },
};

export function statusMeta(s: string) {
  return STATUS_META[s] ?? { label: s[0] ?? "?", bg: "bg-zinc-700/30", text: "text-zinc-400" };
}

// ── Components ────────────────────────────────────────────────────────────────

export function DiffTable({ lines }: { lines: DiffLine[] }) {
  return (
    <table className="w-full border-collapse font-mono text-xs">
      <tbody>
        {lines.map((line, i) => {
          if (line.type === "header") {
            return (
              <tr key={i} className="bg-zinc-800/60">
                <td colSpan={4} className="px-4 py-1 text-zinc-400 select-none">
                  {line.content}
                </td>
              </tr>
            );
          }
          const isAdd = line.type === "add";
          const isRem = line.type === "remove";
          return (
            <tr
              key={i}
              className={
                isAdd
                  ? "bg-green-950/40 hover:bg-green-950/60"
                  : isRem
                  ? "bg-red-950/40 hover:bg-red-950/60"
                  : "hover:bg-zinc-800/20"
              }
            >
              <td className="w-10 text-right pr-2 pl-2 select-none text-zinc-600 border-r border-zinc-800">
                {isRem || line.type === "context" ? line.oldLine : ""}
              </td>
              <td className="w-10 text-right pr-2 select-none text-zinc-600 border-r border-zinc-800">
                {isAdd || line.type === "context" ? line.newLine : ""}
              </td>
              <td
                className={`w-5 text-center select-none ${
                  isAdd ? "text-green-500" : isRem ? "text-red-500" : "text-zinc-700"
                }`}
              >
                {isAdd ? "+" : isRem ? "−" : " "}
              </td>
              <td
                className={`pl-1 pr-4 whitespace-pre ${
                  isAdd ? "text-green-300" : isRem ? "text-red-300" : "text-zinc-300"
                }`}
              >
                {line.content}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const CHECKER = "bg-[repeating-conic-gradient(#1a1a1a_0%_25%,#141414_0%_50%)] bg-[length:20px_20px]";

export function ImageDiffView({ diff }: { diff: ImageDiff }) {
  if (!diff.before && diff.after) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-2 bg-green-950/40 border-b border-border text-green-400 text-xs font-sans font-medium">
          New file
        </div>
        <div className={`flex-1 flex items-center justify-center p-6 ${CHECKER}`}>
          <img src={diff.after} className="max-w-full max-h-full object-contain drop-shadow-xl rounded" />
        </div>
      </div>
    );
  }

  if (diff.before && !diff.after) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-2 bg-red-950/40 border-b border-border text-red-400 text-xs font-sans font-medium">
          Deleted file
        </div>
        <div className={`flex-1 flex items-center justify-center p-6 ${CHECKER} opacity-50`}>
          <img src={diff.before} className="max-w-full max-h-full object-contain drop-shadow-xl rounded" />
        </div>
      </div>
    );
  }

  if (diff.before && diff.after) {
    return (
      <div className="flex flex-col h-full font-sans">
        <div className="grid grid-cols-2 divide-x divide-border border-b border-border flex-shrink-0">
          <div className="px-4 py-2 bg-red-950/30 text-red-400 text-xs font-medium">Before</div>
          <div className="px-4 py-2 bg-green-950/30 text-green-400 text-xs font-medium">After</div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-border flex-1 min-h-0">
          <div className={`flex items-center justify-center p-6 ${CHECKER}`}>
            <img src={diff.before} className="max-w-full max-h-full object-contain drop-shadow-xl rounded" />
          </div>
          <div className={`flex items-center justify-center p-6 ${CHECKER}`}>
            <img src={diff.after} className="max-w-full max-h-full object-contain drop-shadow-xl rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-full text-zinc-600 text-sm font-sans">
      Image not available
    </div>
  );
}
