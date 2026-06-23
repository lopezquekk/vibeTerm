import { describe, it, expect, beforeEach } from "vitest";
import { useToastStore } from "../store/toastStore";

describe("toastStore dedup", () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  it("does not add a duplicate identical active toast", () => {
    useToastStore.getState().addToast("boom", "error");
    useToastStore.getState().addToast("boom", "error");
    expect(useToastStore.getState().toasts.length).toBe(1);
  });

  it("allows a different message", () => {
    useToastStore.getState().addToast("boom", "error");
    useToastStore.getState().addToast("bang", "error");
    expect(useToastStore.getState().toasts.length).toBe(2);
  });

  it("allows the same message with a different type", () => {
    useToastStore.getState().addToast("boom", "error");
    useToastStore.getState().addToast("boom", "info");
    expect(useToastStore.getState().toasts.length).toBe(2);
  });
});
