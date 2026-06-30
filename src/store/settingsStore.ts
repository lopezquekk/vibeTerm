import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Settings {
  // A — Prompt detection
  promptDetectionEnabled: boolean;
  detectFreeform: boolean;
  focusTabOnAnswer: boolean;
  promptScanDebounceMs: number;
  // B — Terminal appearance
  fontSize: number;
  cursorBlink: boolean;
  scrollback: number;
  // C — Notifications
  notifyOnPrompt: boolean;
  notifyOnlyWhenBackground: boolean;
  notifySound: boolean;
  // D — Behavior / safety
  confirmTabClose: boolean;
  portDetection: boolean;
  cwdTracking: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  promptDetectionEnabled: true,
  detectFreeform: true,
  focusTabOnAnswer: true,
  promptScanDebounceMs: 350,
  fontSize: 13,
  cursorBlink: true,
  scrollback: 5000,
  notifyOnPrompt: false,
  notifyOnlyWhenBackground: true,
  notifySound: false,
  confirmTabClose: false,
  portDetection: true,
  cwdTracking: true,
};

interface SettingsStore extends Settings {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (key, value) => set({ [key]: value } as unknown as Pick<Settings, keyof Settings>),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    { name: "vibeterm-settings" }
  )
);
