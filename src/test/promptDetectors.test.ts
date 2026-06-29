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

describe("numbered-list detector", () => {
  const claude = [
    "╭──────────────────────────────────────────────╮",
    "│ Bash command                                  │",
    "│ npm install                                    │",
    "│                                                │",
    "│ Do you want to proceed?                        │",
    "│ ❯ 1. Yes                                       │",
    "│   2. Yes, and don't ask again for npm commands │",
    "│   3. No, and tell Claude what to do differently│",
    "╰──────────────────────────────────────────────╯",
  ];
  it("extracts question and numbered options from a Claude prompt", () => {
    const p = detectPrompt(claude)!;
    expect(p).not.toBeNull();
    expect(p.kind).toBe("select");
    expect(p.question).toBe("Do you want to proceed?");
    expect(p.options.map((o) => o.label)).toEqual([
      "Yes",
      "Yes, and don't ask again for npm commands",
      "No, and tell Claude what to do differently",
    ]);
    expect(p.options.map((o) => o.send)).toEqual(["1", "2", "3"]);
  });

  it("detects a Codex prompt without a box (marker only)", () => {
    const codex = [
      "Allow Codex to run `git push`?",
      "",
      "› 1. Yes",
      "  2. Yes, don't ask again",
      "  3. No",
    ];
    const p = detectPrompt(codex)!;
    expect(p.question).toBe("Allow Codex to run `git push`?");
    expect(p.options).toHaveLength(3);
    expect(p.tool).toBe("codex");
  });

  it("detects a Gemini prompt with ● marker inside a box", () => {
    const gemini = [
      "╭───────────────────────────╮",
      "│ Apply this change?         │",
      "│ ● 1. Yes                   │",
      "│   2. No                    │",
      "╰───────────────────────────╯",
    ];
    const p = detectPrompt(gemini)!;
    expect(p.question).toBe("Apply this change?");
    expect(p.options.map((o) => o.send)).toEqual(["1", "2"]);
  });

  it("does NOT fire on a plain markdown numbered list", () => {
    const md = [
      "Here are the steps:",
      "1. Install deps",
      "2. Run the build",
      "3. Ship it",
    ];
    expect(detectPrompt(md)).toBeNull();
  });
});

describe("yes-no detector", () => {
  it("detects (y/n) confirmations", () => {
    const p = detectPrompt(["Overwrite config.json", "Continue? (y/n)"])!;
    expect(p.kind).toBe("confirm");
    expect(p.question).toBe("Continue?");
    expect(p.options.map((o) => o.send)).toEqual(["y\r", "n\r"]);
  });

  it("detects [Y/n] form", () => {
    const p = detectPrompt(["Proceed with install? [Y/n]"])!;
    expect(p.kind).toBe("confirm");
  });
});

describe("highlighted-list detector (arrow fallback)", () => {
  const box = [
    "╭──────────────────────────╮",
    "│ Select an action          │",
    "│ ❯ Allow once              │",
    "│   Allow always            │",
    "│   Deny                     │",
    "╰──────────────────────────╯",
  ];
  it("extracts non-numbered options and computes arrow sends", () => {
    const p = detectPrompt(box)!;
    expect(p.kind).toBe("select");
    expect(p.question).toBe("Select an action");
    expect(p.options.map((o) => o.label)).toEqual(["Allow once", "Allow always", "Deny"]);
    // marker on first item → first selects with Enter, others arrow down then Enter
    expect(p.options.map((o) => o.send)).toEqual(["\r", "\x1b[B\r", "\x1b[B\x1b[B\r"]);
  });

  it("does NOT fire without a box or question context", () => {
    expect(detectPrompt(["❯ just one highlighted line"])).toBeNull();
  });

  it("does NOT fire without a box even with multiple marker lines", () => {
    expect(detectPrompt(["❯ Option A", "  Option B", "  Option C"])).toBeNull();
  });
});

describe("input-box detector (freeform)", () => {
  it("detects a free-form question with an empty input box", () => {
    const lines = [
      "What would you like me to focus on for the refactor?",
      "",
      "│ >                                             │",
    ];
    const p = detectPrompt(lines)!;
    expect(p.kind).toBe("freeform");
    expect(p.question).toBe("What would you like me to focus on for the refactor?");
    expect(p.options).toEqual([]);
  });

  it("does NOT fire on a shell prompt with no question", () => {
    expect(detectPrompt(["> "])).toBeNull();
    expect(detectPrompt(["building project...", "> "])).toBeNull();
  });
});
