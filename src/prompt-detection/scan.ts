import type { Terminal } from "@xterm/xterm";
import { detectPrompt } from "./detectors";
import { usePromptStore } from "../store/promptStore";
import { useSettingsStore } from "../store/settingsStore";
import { useTabStore } from "../store/tabStore";
import { notifyPrompt } from "../notifications";

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
  const settings = useSettingsStore.getState();
  if (!settings.promptDetectionEnabled) return;

  let prompt = detectPrompt(lines);
  if (prompt && prompt.kind === "freeform" && !settings.detectFreeform) prompt = null;

  const store = usePromptStore.getState();
  const inserted = prompt ? store.enqueue({ tabId, prompt }) : false;
  store.reconcileTab(tabId, prompt ? prompt.signature : null);

  if (inserted && prompt) {
    const activeTabId = useTabStore.getState().activeTabId;
    const isActive = activeTabId === tabId.replace(/-split$/, "");
    notifyPrompt(isActive, prompt);
  }
}
