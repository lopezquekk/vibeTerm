import { describe, it, expect, beforeEach, vi } from "vitest";
import { notifyPrompt } from "../notifications";
import { useSettingsStore, DEFAULT_SETTINGS } from "../store/settingsStore";
import { DetectedPrompt } from "../prompt-detection/types";

const prompt: DetectedPrompt = {
  tool: "claude", kind: "select", question: "Proceed?",
  options: [{ label: "Yes", send: "1" }], signature: "sig",
};

let ctor: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ ...DEFAULT_SETTINGS });
  ctor = vi.fn();
  // Mock the Notification constructor with a granted permission.
  (globalThis as any).Notification = Object.assign(ctor, { permission: "granted" });
});

describe("notifyPrompt", () => {
  it("does nothing when notifyOnPrompt is off (default)", () => {
    notifyPrompt(false, prompt);
    expect(ctor).not.toHaveBeenCalled();
  });

  it("shows a notification for a background tab when enabled", () => {
    useSettingsStore.setState({ notifyOnPrompt: true });
    notifyPrompt(false, prompt);
    expect(ctor).toHaveBeenCalledTimes(1);
  });

  it("suppresses the notification for the active tab when notifyOnlyWhenBackground", () => {
    useSettingsStore.setState({ notifyOnPrompt: true, notifyOnlyWhenBackground: true });
    notifyPrompt(true, prompt);
    expect(ctor).not.toHaveBeenCalled();
  });

  it("notifies the active tab when notifyOnlyWhenBackground is off", () => {
    useSettingsStore.setState({ notifyOnPrompt: true, notifyOnlyWhenBackground: false });
    notifyPrompt(true, prompt);
    expect(ctor).toHaveBeenCalledTimes(1);
  });
});
