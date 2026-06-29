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

// Matches an option line, optionally preceded by a selection marker.
const OPT_RE = new RegExp(`^([${MARKER_CHARS}>]\\s*)?(\\d+)[.)]\\s+(.+?)\\s*$`);

const numberedListDetector: Detector = {
  name: "numbered-list",
  detect(lines) {
    const cleaned = lines.map(clean);
    for (let i = 0; i < cleaned.length; i++) {
      const m = cleaned[i].match(OPT_RE);
      if (!m || m[2] !== "1") continue; // run must start at option 1

      const opts: { num: string; label: string; marker: boolean }[] = [];
      let expected = 1;
      let j = i;
      while (j < cleaned.length) {
        const mm = cleaned[j].match(OPT_RE);
        if (!mm || parseInt(mm[2], 10) !== expected) break;
        opts.push({ num: mm[2], label: mm[3].trim(), marker: !!mm[1] });
        expected++;
        j++;
      }
      if (opts.length < 2) continue;

      // False-positive guard: a real prompt has a selection marker, a box
      // border, or a question line ending in "?". A markdown list has none.
      const questionLine = findQuestionAbove(cleaned, i);
      const blockHasMarker = opts.some((o) => o.marker);
      const borderNearby = lines
        .slice(Math.max(0, i - 1), j + 1)
        .some(hasBorder);
      if (!blockHasMarker && !borderNearby && !questionLine.endsWith("?")) continue;

      const options: PromptOption[] = opts.map((o) => ({ label: o.label, send: o.num }));
      const question = questionLine || "Select an option";
      return {
        tool: inferTool(lines),
        kind: "select",
        question,
        options,
        signature: computeSignature("select", question, options),
      };
    }
    return null;
  },
};

const YESNO_RE = /\(\s*(?:y\/n|s\/n)\s*\)|\[\s*(?:y\/n|Y\/n|y\/N)\s*\]/i;

const yesNoDetector: Detector = {
  name: "yes-no",
  detect(lines) {
    const cleaned = lines.map(clean);
    for (let i = cleaned.length - 1; i >= 0; i--) {
      if (!YESNO_RE.test(cleaned[i])) continue;
      const question = cleaned[i].replace(YESNO_RE, "").trim() || "Continue?";
      const options: PromptOption[] = [
        { label: "Sí", send: "y\r" },
        { label: "No", send: "n\r" },
      ];
      return {
        tool: inferTool(lines),
        kind: "confirm",
        question,
        options,
        signature: computeSignature("confirm", question, options),
      };
    }
    return null;
  },
};

// Detectors are registered by later tasks.
export const DETECTORS: Detector[] = [numberedListDetector, yesNoDetector];

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
