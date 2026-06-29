import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore, DEFAULT_SETTINGS } from "../store/settingsStore";

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ ...DEFAULT_SETTINGS });
});

describe("settingsStore", () => {
  it("defaults match current app behavior", () => {
    const s = useSettingsStore.getState();
    expect(s.promptDetectionEnabled).toBe(true);
    expect(s.detectFreeform).toBe(true);
    expect(s.focusTabOnAnswer).toBe(true);
    expect(s.promptScanDebounceMs).toBe(350);
    expect(s.fontSize).toBe(13);
    expect(s.cursorBlink).toBe(true);
    expect(s.scrollback).toBe(5000);
    expect(s.notifyOnPrompt).toBe(false);
    expect(s.notifyOnlyWhenBackground).toBe(true);
    expect(s.notifySound).toBe(false);
    expect(s.confirmTabClose).toBe(false);
    expect(s.portDetection).toBe(true);
    expect(s.cwdTracking).toBe(true);
  });

  it("set() updates only the given key", () => {
    useSettingsStore.getState().set("fontSize", 16);
    expect(useSettingsStore.getState().fontSize).toBe(16);
    expect(useSettingsStore.getState().scrollback).toBe(5000);
  });

  it("reset() restores defaults", () => {
    useSettingsStore.getState().set("promptDetectionEnabled", false);
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().promptDetectionEnabled).toBe(true);
  });
});
