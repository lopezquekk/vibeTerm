import { DetectedPrompt, Detector, PromptOption } from "./types";

export const MARKER_CHARS = "❯›▶●◉";
const BORDER_CHARS = "│╭╮╰╯─┌┐└┘|";

export function inferTool(lines: string[]): string {
  const hay = lines.join("\n").toLowerCase();
  if (hay.includes("claude")) return "claude";
  if (hay.includes("codex")) return "codex";
  if (hay.includes("gemini")) return "gemini";
  return "unknown";
}

export function computeSignature(kind: string, question: string, options: PromptOption[]): string {
  return [kind, question, ...options.map((o) => o.label)].join("§");
}

// Strip surrounding box-border characters and outer whitespace from a buffer line.
export function clean(line: string): string {
  let s = line.trim();
  s = s.replace(new RegExp(`^[${BORDER_CHARS}\\s]+`), "");
  s = s.replace(new RegExp(`[${BORDER_CHARS}\\s]+$`), "");
  return s.trim();
}

export function hasBorder(line: string): boolean {
  return /[│╭╮╰╯┌┐└┘]/.test(line);
}

export function findQuestionAbove(cleaned: string[], optIndex: number): string {
  for (let k = optIndex - 1; k >= 0; k--) {
    const t = cleaned[k].trim();
    if (t) return t;
  }
  return "";
}

// Detectors are registered by later tasks.
export const DETECTORS: Detector[] = [];

export function detectPrompt(lines: string[]): DetectedPrompt | null {
  for (const d of DETECTORS) {
    try {
      const r = d.detect(lines);
      if (r) return r;
    } catch {
      /* best-effort: a broken detector must never break detection */
    }
  }
  return null;
}
