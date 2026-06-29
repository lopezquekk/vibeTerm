import { create } from "zustand";
import { DetectedPrompt } from "../prompt-detection/types";

export interface PendingPrompt {
  tabId: string;
  prompt: DetectedPrompt;
}

interface PromptStore {
  queue: PendingPrompt[];
  current: PendingPrompt | null;
  handled: string[]; // signatures already resolved/dismissed
  enqueue: (p: PendingPrompt) => boolean;
  resolve: () => void;
  dismiss: () => void;
  dismissIfStale: (signature: string) => void;
  reconcileTab: (tabId: string, liveSignature: string | null) => void;
}

export const usePromptStore = create<PromptStore>()((set, get) => ({
  queue: [],
  current: null,
  handled: [],

  enqueue: (p) => {
    const s = get();
    const sig = p.prompt.signature;
    const known =
      s.handled.includes(sig) ||
      s.current?.prompt.signature === sig ||
      s.queue.some((q) => q.prompt.signature === sig);
    if (known) return false;
    if (!s.current) set({ current: p });
    else set({ queue: [...s.queue, p] });
    return true;
  },

  resolve: () =>
    set((s) => advance(s)),

  dismiss: () =>
    set((s) => advance(s)),

  dismissIfStale: (signature) =>
    set((s) => (s.current?.prompt.signature === signature ? advance(s) : s)),

  reconcileTab: (tabId, liveSignature) =>
    set((s) => {
      const prunedQueue = s.queue.filter(
        (q) => !(q.tabId === tabId && q.prompt.signature !== liveSignature)
      );
      if (
        s.current &&
        s.current.tabId === tabId &&
        s.current.prompt.signature !== liveSignature
      ) {
        const handled = [...s.handled, s.current.prompt.signature].slice(-200);
        const [next, ...rest] = prunedQueue;
        return { handled, current: next ?? null, queue: rest };
      }
      if (prunedQueue.length !== s.queue.length) return { queue: prunedQueue };
      return {};
    }),
}));

// Mark current handled and promote the next queued prompt.
function advance(s: PromptStore): Partial<PromptStore> {
  const handled = s.current
    ? [...s.handled, s.current.prompt.signature].slice(-200)
    : s.handled;
  const [next, ...rest] = s.queue;
  return { handled, current: next ?? null, queue: rest };
}
