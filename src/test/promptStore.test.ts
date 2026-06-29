import { describe, it, expect, beforeEach } from "vitest";
import { usePromptStore } from "../store/promptStore";
import { DetectedPrompt } from "../prompt-detection/types";

function mk(sig: string): DetectedPrompt {
  return { tool: "claude", kind: "select", question: "Q " + sig, options: [{ label: "Yes", send: "1" }], signature: sig };
}

beforeEach(() => {
  usePromptStore.setState({ queue: [], current: null, handled: [] });
});

describe("promptStore", () => {
  it("promotes the first enqueued prompt to current", () => {
    usePromptStore.getState().enqueue({ tabId: "t1", prompt: mk("a") });
    expect(usePromptStore.getState().current?.prompt.signature).toBe("a");
    expect(usePromptStore.getState().queue).toHaveLength(0);
  });

  it("queues additional prompts behind current", () => {
    const s = usePromptStore.getState();
    s.enqueue({ tabId: "t1", prompt: mk("a") });
    s.enqueue({ tabId: "t2", prompt: mk("b") });
    expect(usePromptStore.getState().current?.prompt.signature).toBe("a");
    expect(usePromptStore.getState().queue.map((q) => q.prompt.signature)).toEqual(["b"]);
  });

  it("dedupes by signature across current and queue", () => {
    const s = usePromptStore.getState();
    s.enqueue({ tabId: "t1", prompt: mk("a") });
    s.enqueue({ tabId: "t1", prompt: mk("a") });
    s.enqueue({ tabId: "t1", prompt: mk("b") });
    s.enqueue({ tabId: "t1", prompt: mk("b") });
    expect(usePromptStore.getState().queue).toHaveLength(1);
  });

  it("resolve advances to the next and remembers handled", () => {
    const s = usePromptStore.getState();
    s.enqueue({ tabId: "t1", prompt: mk("a") });
    s.enqueue({ tabId: "t2", prompt: mk("b") });
    usePromptStore.getState().resolve();
    expect(usePromptStore.getState().current?.prompt.signature).toBe("b");
    // resolved signature must not re-enqueue
    usePromptStore.getState().enqueue({ tabId: "t1", prompt: mk("a") });
    expect(usePromptStore.getState().queue).toHaveLength(0);
  });

  it("dismiss does not reopen the same signature", () => {
    const s = usePromptStore.getState();
    s.enqueue({ tabId: "t1", prompt: mk("a") });
    usePromptStore.getState().dismiss();
    expect(usePromptStore.getState().current).toBeNull();
    usePromptStore.getState().enqueue({ tabId: "t1", prompt: mk("a") });
    expect(usePromptStore.getState().current).toBeNull();
  });

  it("dismissIfStale clears only the matching current", () => {
    const s = usePromptStore.getState();
    s.enqueue({ tabId: "t1", prompt: mk("a") });
    usePromptStore.getState().dismissIfStale("zzz");
    expect(usePromptStore.getState().current?.prompt.signature).toBe("a");
    usePromptStore.getState().dismissIfStale("a");
    expect(usePromptStore.getState().current).toBeNull();
  });

  it("reconcileTab prunes a stale queued prompt for a tab", () => {
    const s = usePromptStore.getState();
    s.enqueue({ tabId: "t1", prompt: mk("a") });
    s.enqueue({ tabId: "t2", prompt: mk("b") });
    // t2's prompt is answered in-terminal: scan finds nothing for t2
    usePromptStore.getState().reconcileTab("t2", null);
    expect(usePromptStore.getState().queue).toHaveLength(0);
    expect(usePromptStore.getState().current?.prompt.signature).toBe("a");
  });

  it("reconcileTab keeps a still-live prompt", () => {
    const s = usePromptStore.getState();
    s.enqueue({ tabId: "t1", prompt: mk("a") });
    usePromptStore.getState().reconcileTab("t1", "a");
    expect(usePromptStore.getState().current?.prompt.signature).toBe("a");
  });
});
