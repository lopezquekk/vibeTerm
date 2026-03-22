import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TabStatus = "idle" | "running" | "error";
export type TabType = "project" | "frontend" | "backend" | "infra" | "logs" | "database";

export interface GitStatus {
  branch: string;
  isDirty: boolean;
  added: number;
  modified: number;
  deleted: number;
  ahead: number;
  behind: number;
}

export interface Tab {
  id: string;
  alias: string;
  path: string;
  type: TabType;
  status: TabStatus;
  git: GitStatus | null;
  sessionId: string | null;
  detectedPort: string | null;
  hasActivity: boolean;
  worktreeOf: string | null; // main worktree root path if this is a linked worktree
}

export type SidebarMode = "docked" | "floating" | "hidden";

interface TabStore {
  tabs: Tab[];
  activeTabId: string | null;
  activePanelTab: "terminal" | "diff" | "changes" | "history";
  sidebarMode: SidebarMode;
  addTab: (opts: { alias: string; path: string; type?: TabType }) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, patch: Partial<Tab>) => void;
  setActivePanelTab: (tab: TabStore["activePanelTab"]) => void;
  setSidebarMode: (mode: SidebarMode) => void;
  reorderTabs: (from: number, to: number) => void;
}

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for non-secure HTTP contexts (remote access over LAN)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const useTabStore = create<TabStore>()(
  persist(
    (set) => ({
      tabs: [],
      activeTabId: null,
      activePanelTab: "terminal",
      sidebarMode: "docked",

      addTab: ({ alias, path, type = "project" }) => {
        const id = generateId();
        const tab: Tab = {
          id,
          alias,
          path,
          type,
          status: "idle",
          git: null,
          sessionId: null,
          detectedPort: null,
          hasActivity: false,
          worktreeOf: null,
        };
        set((s) => ({
          tabs: [...s.tabs, tab],
          activeTabId: id,
        }));
      },

      removeTab: (id) =>
        set((s) => {
          const tabs = s.tabs.filter((t) => t.id !== id);
          const activeTabId =
            s.activeTabId === id ? (tabs[0]?.id ?? null) : s.activeTabId;
          return { tabs, activeTabId };
        }),

      setActiveTab: (id) =>
        set((s) => ({
          activeTabId: id,
          tabs: s.tabs.map((t) => (t.id === id ? { ...t, hasActivity: false } : t)),
        })),

      updateTab: (id, patch) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),

      setActivePanelTab: (tab) => set({ activePanelTab: tab }),

      setSidebarMode: (mode) => set({ sidebarMode: mode }),

      reorderTabs: (from, to) =>
        set((s) => {
          const tabs = [...s.tabs];
          const [moved] = tabs.splice(from, 1);
          tabs.splice(to, 0, moved);
          return { tabs };
        }),
    }),
    {
      name: "vibeterm-workspace",
      partialize: (s) => ({
        tabs: s.tabs.map((t) => ({
          ...t,
          sessionId: null,
          git: null,
          detectedPort: null,
          hasActivity: false,
          worktreeOf: null,
        })),
        activeTabId: s.activeTabId,
        sidebarMode: s.sidebarMode,
      }),
    }
  )
);
