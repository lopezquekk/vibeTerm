import { describe, it, expect } from "vitest";
import { inferTool, computeSignature, detectPrompt } from "../prompt-detection/detectors";

describe("inferTool", () => {
  it("labels by keyword, defaults to unknown", () => {
    expect(inferTool(["Claude needs permission"])).toBe("claude");
    expect(inferTool(["codex wants to run"])).toBe("codex");
    expect(inferTool(["Gemini CLI"])).toBe("gemini");
    expect(inferTool(["random shell output"])).toBe("unknown");
  });
});

describe("computeSignature", () => {
  it("is stable for same content and differs by content", () => {
    const a = computeSignature("select", "Proceed?", [{ label: "Yes", send: "1" }]);
    const b = computeSignature("select", "Proceed?", [{ label: "Yes", send: "1" }]);
    const c = computeSignature("select", "Proceed?", [{ label: "No", send: "2" }]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("detectPrompt", () => {
  it("returns null for empty/plain output", () => {
    expect(detectPrompt([])).toBeNull();
    expect(detectPrompt(["$ ls", "file1  file2", "$ "])).toBeNull();
  });
});
