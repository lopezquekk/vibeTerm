import { describe, it, expect, beforeEach } from "vitest";
import { scanLines } from "../prompt-detection/scan";
import { usePromptStore } from "../store/promptStore";

beforeEach(() => {
  usePromptStore.setState({ queue: [], current: null, handled: [] });
});

const claude = [
  "│ Do you want to proceed?                        │",
  "│ ❯ 1. Yes                                       │",
  "│   2. No                                        │",
];

describe("scanLines", () => {
  it("enqueues a detected prompt with the tab id", () => {
    scanLines(claude, "tab-7");
    const cur = usePromptStore.getState().current!;
    expect(cur.tabId).toBe("tab-7");
    expect(cur.prompt.question).toBe("Do you want to proceed?");
  });

  it("auto-dismisses the current prompt for this tab when it disappears", () => {
    scanLines(claude, "tab-7");
    scanLines(["$ ", "all done"], "tab-7"); // prompt gone
    expect(usePromptStore.getState().current).toBeNull();
  });

  it("does not dismiss a prompt belonging to a different tab", () => {
    scanLines(claude, "tab-7");
    scanLines(["nothing here"], "tab-OTHER");
    expect(usePromptStore.getState().current?.tabId).toBe("tab-7");
  });
});
