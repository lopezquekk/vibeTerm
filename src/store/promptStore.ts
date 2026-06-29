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
  enqueue: (p: PendingPrompt) => void;
  resolve: () => void;
  dismiss: () => void;
  dismissIfStale: (signature: string) => void;
}

export const usePromptStore = create<PromptStore>()((set) => ({
  queue: [],
  current: null,
  handled: [],

  enqueue: (p) =>
    set((s) => {
      const sig = p.prompt.signature;
      const known =
        s.handled.includes(sig) ||
        s.current?.prompt.signature === sig ||
        s.queue.some((q) => q.prompt.signature === sig);
      if (known) return s;
      if (!s.current) return { current: p };
      return { queue: [...s.queue, p] };
    }),

  resolve: () =>
    set((s) => advance(s)),

  dismiss: () =>
    set((s) => advance(s)),

  dismissIfStale: (signature) =>
    set((s) => (s.current?.prompt.signature === signature ? advance(s) : s)),
}));

// Mark current handled and promote the next queued prompt.
function advance(s: PromptStore): Partial<PromptStore> {
  const handled = s.current
    ? [...s.handled, s.current.prompt.signature].slice(-200)
    : s.handled;
  const [next, ...rest] = s.queue;
  return { handled, current: next ?? null, queue: rest };
}
