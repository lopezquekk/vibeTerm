import type { Terminal } from "@xterm/xterm";
import { detectPrompt } from "./detectors";
import { usePromptStore } from "../store/promptStore";

// Read the currently visible viewport of the terminal as plain text lines.
export function readVisibleLines(term: Terminal): string[] {
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let y = buf.baseY; y < buf.baseY + term.rows; y++) {
    const line = buf.getLine(y);
    lines.push(line ? line.translateToString(true) : "");
  }
  return lines;
}

// Run detection over already-extracted lines and reconcile with the store.
export function scanLines(lines: string[], tabId: string): void {
  const prompt = detectPrompt(lines);
  const store = usePromptStore.getState();
  if (prompt) store.enqueue({ tabId, prompt });
  store.reconcileTab(tabId, prompt ? prompt.signature : null);
}
