import { useSettingsStore } from "./store/settingsStore";
import type { DetectedPrompt } from "./prompt-detection/types";

// Ask for notification permission. Returns whether it is (now) granted.
export function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return Promise.resolve(false);
  if (Notification.permission === "granted") return Promise.resolve(true);
  if (Notification.permission === "denied") return Promise.resolve(false);
  return Notification.requestPermission().then((p) => p === "granted").catch(() => false);
}

let audioCtx: AudioContext | null = null;
function beep(): void {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx ?? new Ctx();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.12);
  } catch {
    /* best-effort */
  }
}

// Best-effort: show a desktop notification (and optional sound) for a detected prompt.
export function notifyPrompt(isActiveTab: boolean, prompt: DetectedPrompt): void {
  const s = useSettingsStore.getState();
  if (!s.notifyOnPrompt) return;
  if (s.notifyOnlyWhenBackground && isActiveTab) return;
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("vibeTerm — se requiere tu respuesta", { body: prompt.question });
    }
  } catch {
    /* best-effort */
  }
  if (s.notifySound) beep();
}
