# Terminal Prompt Detection Modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when any AI CLI (Claude, Codex, Gemini, …) running in a vibeTerm terminal shows a prompt awaiting input, and surface it as a global modal whose buttons write the chosen answer back to the originating PTY.

**Architecture:** Pure, tool-agnostic structural detectors parse the rendered xterm buffer text after the PTY goes idle (~350ms debounce). Matches are pushed into a zustand `promptStore` queue; a root-level `PermissionModal` shows the current one and calls `transport.ptyWrite(tabId, send)` on click. Detection runs client-side so it works identically in Tauri and web/remote mode.

**Tech Stack:** TypeScript, React 18, zustand, @xterm/xterm, vitest + jsdom.

## Global Constraints

- Detection is **best-effort**: every detector and every scan is wrapped in `try/catch` and must never throw into the terminal render path.
- Detectors are **pure** (input `string[]`, output `DetectedPrompt | null`) — no React, no DOM, no xterm imports — so they are unit-testable in isolation.
- Detection is **structural / tool-agnostic**: detectors recognise prompt *shape*, not brand. The `tool` field is a best-effort display label only.
- Existing transport API is fixed: subscribe via `transport.onPtyData(tabId, cb)`, respond via `transport.ptyWrite(tabId, data)`. Do not add new transport methods.
- Tests use vitest globals (`describe/it/expect`) — config already has `globals: true`, `environment: "jsdom"`, `setupFiles: ["src/test/setup.ts"]`.
- Run tests with `npx vitest run <file>`. Run typecheck with `npx tsc --noEmit`.

---

### Task 1: Detection types & shared helpers

**Files:**
- Create: `src/prompt-detection/types.ts`
- Create: `src/prompt-detection/detectors.ts`
- Test: `src/test/promptDetectors.test.ts`

**Interfaces:**
- Produces: `PromptKind`, `PromptOption`, `DetectedPrompt`, `Detector` (types.ts); `inferTool(lines: string[]): string`, `computeSignature(kind: string, question: string, options: PromptOption[]): string`, `detectPrompt(lines: string[]): DetectedPrompt | null`, `DETECTORS: Detector[]` (detectors.ts).

- [ ] **Step 1: Write `types.ts`**

```ts
// src/prompt-detection/types.ts
export type PromptKind = "select" | "confirm" | "freeform";

export interface PromptOption {
  label: string;
  send: string; // exact sequence written to the PTY when chosen
}

export interface DetectedPrompt {
  tool: string; // best-effort label: "claude" | "codex" | "gemini" | "unknown"
  kind: PromptKind;
  question: string;
  options: PromptOption[]; // empty when kind === "freeform"
  signature: string; // stable id for dedupe
}

export interface Detector {
  name: string;
  detect(lines: string[]): DetectedPrompt | null;
}
```

- [ ] **Step 2: Write the failing test for helpers**

```ts
// src/test/promptDetectors.test.ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/test/promptDetectors.test.ts`
Expected: FAIL — cannot import from `../prompt-detection/detectors` (module/exports missing).

- [ ] **Step 4: Write `detectors.ts` with helpers and empty registry**

```ts
// src/prompt-detection/detectors.ts
import { DetectedPrompt, Detector, PromptOption } from "./types";

export const MARKER_CHARS = "❯›▶●◉";
const BORDER_CHARS = "│╭╮╰╯─┌┐└┘|";

export function inferTool(lines: string[]): string {
  const hay = lines.join("\n").toLowerCase();
  if (hay.includes("claude")) return "claude";
  if (hay.includes("codex")) return "codex";
  if (hay.includes("gemini")) return "gemini";
  return "unknown";
}

export function computeSignature(kind: string, question: string, options: PromptOption[]): string {
  return [kind, question, ...options.map((o) => o.label)].join("§");
}

// Strip surrounding box-border characters and outer whitespace from a buffer line.
export function clean(line: string): string {
  let s = line.trim();
  s = s.replace(new RegExp(`^[${BORDER_CHARS}\\s]+`), "");
  s = s.replace(new RegExp(`[${BORDER_CHARS}\\s]+$`), "");
  return s.trim();
}

export function hasBorder(line: string): boolean {
  return /[│╭╮╰╯┌┐└┘]/.test(line);
}

export function findQuestionAbove(cleaned: string[], optIndex: number): string {
  for (let k = optIndex - 1; k >= 0; k--) {
    const t = cleaned[k].trim();
    if (t) return t;
  }
  return "";
}

// Detectors are registered by later tasks.
export const DETECTORS: Detector[] = [];

export function detectPrompt(lines: string[]): DetectedPrompt | null {
  for (const d of DETECTORS) {
    try {
      const r = d.detect(lines);
      if (r) return r;
    } catch {
      /* best-effort: a broken detector must never break detection */
    }
  }
  return null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/test/promptDetectors.test.ts`
Expected: PASS (all 4 assertions; `detectPrompt` returns null because `DETECTORS` is empty).

- [ ] **Step 6: Commit**

```bash
git add src/prompt-detection/types.ts src/prompt-detection/detectors.ts src/test/promptDetectors.test.ts
git commit -m "feat(prompt-detection): types + shared detector helpers"
```

---

### Task 2: Numbered-list detector (`select`)

**Files:**
- Modify: `src/prompt-detection/detectors.ts`
- Test: `src/test/promptDetectors.test.ts`

**Interfaces:**
- Consumes: `clean`, `hasBorder`, `findQuestionAbove`, `inferTool`, `computeSignature`, `MARKER_CHARS`, `DETECTORS` from detectors.ts.
- Produces: a `Detector` named `"numbered-list"` registered first in `DETECTORS`; matches `select` prompts whose options are `1. … 2. …`, sending the digit.

- [ ] **Step 1: Write the failing tests**

Append to `src/test/promptDetectors.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/promptDetectors.test.ts`
Expected: FAIL — `detectPrompt` returns null for the Claude/Codex/Gemini fixtures (no detector registered yet).

- [ ] **Step 3: Implement the detector**

In `src/prompt-detection/detectors.ts`, add above the `DETECTORS` declaration:

```ts
// Matches an option line, optionally preceded by a selection marker.
const OPT_RE = new RegExp(`^([${MARKER_CHARS}>]\\s*)?(\\d+)[.)]\\s+(.+?)\\s*$`);

const numberedListDetector: Detector = {
  name: "numbered-list",
  detect(lines) {
    const cleaned = lines.map(clean);
    for (let i = 0; i < cleaned.length; i++) {
      const m = cleaned[i].match(OPT_RE);
      if (!m || m[2] !== "1") continue; // run must start at option 1

      const opts: { num: string; label: string; marker: boolean }[] = [];
      let expected = 1;
      let j = i;
      while (j < cleaned.length) {
        const mm = cleaned[j].match(OPT_RE);
        if (!mm || parseInt(mm[2], 10) !== expected) break;
        opts.push({ num: mm[2], label: mm[3].trim(), marker: !!mm[1] });
        expected++;
        j++;
      }
      if (opts.length < 2) continue;

      // False-positive guard: a real prompt has a selection marker, a box
      // border, or a question line ending in "?". A markdown list has none.
      const questionLine = findQuestionAbove(cleaned, i);
      const blockHasMarker = opts.some((o) => o.marker);
      const borderNearby = lines
        .slice(Math.max(0, i - 1), j + 1)
        .some(hasBorder);
      if (!blockHasMarker && !borderNearby && !questionLine.endsWith("?")) continue;

      const options: PromptOption[] = opts.map((o) => ({ label: o.label, send: o.num }));
      const question = questionLine || "Select an option";
      return {
        tool: inferTool(lines),
        kind: "select",
        question,
        options,
        signature: computeSignature("select", question, options),
      };
    }
    return null;
  },
};
```

Then register it as the first detector:

```ts
export const DETECTORS: Detector[] = [numberedListDetector];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/promptDetectors.test.ts`
Expected: PASS — all numbered-list cases pass and the markdown negative returns null.

- [ ] **Step 5: Commit**

```bash
git add src/prompt-detection/detectors.ts src/test/promptDetectors.test.ts
git commit -m "feat(prompt-detection): numbered-list select detector"
```

---

### Task 3: Yes/No detector (`confirm`)

**Files:**
- Modify: `src/prompt-detection/detectors.ts`
- Test: `src/test/promptDetectors.test.ts`

**Interfaces:**
- Consumes: `clean`, `inferTool`, `computeSignature`, `DETECTORS`.
- Produces: a `Detector` named `"yes-no"` registered after numbered-list; emits a `confirm` prompt with two options (Sí→`"y\r"`, No→`"n\r"`).

- [ ] **Step 1: Write the failing tests**

Append to `src/test/promptDetectors.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/promptDetectors.test.ts`
Expected: FAIL — these inputs currently return null.

- [ ] **Step 3: Implement the detector**

In `src/prompt-detection/detectors.ts`, add before the `DETECTORS` declaration:

```ts
const YESNO_RE = /\(\s*(?:y\/n|s\/n)\s*\)|\[\s*(?:y\/n|Y\/n|y\/N)\s*\]/i;

const yesNoDetector: Detector = {
  name: "yes-no",
  detect(lines) {
    const cleaned = lines.map(clean);
    for (let i = cleaned.length - 1; i >= 0; i--) {
      if (!YESNO_RE.test(cleaned[i])) continue;
      const question = cleaned[i].replace(YESNO_RE, "").trim() || "Continue?";
      const options: PromptOption[] = [
        { label: "Sí", send: "y\r" },
        { label: "No", send: "n\r" },
      ];
      return {
        tool: inferTool(lines),
        kind: "confirm",
        question,
        options,
        signature: computeSignature("confirm", question, options),
      };
    }
    return null;
  },
};
```

Update the registry (keep numbered first):

```ts
export const DETECTORS: Detector[] = [numberedListDetector, yesNoDetector];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/promptDetectors.test.ts`
Expected: PASS — both confirm cases pass; earlier tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/prompt-detection/detectors.ts src/test/promptDetectors.test.ts
git commit -m "feat(prompt-detection): yes/no confirm detector"
```

---

### Task 4: Highlighted-list detector (`select`, arrow-key fallback)

**Files:**
- Modify: `src/prompt-detection/detectors.ts`
- Test: `src/test/promptDetectors.test.ts`

**Interfaces:**
- Consumes: `clean`, `hasBorder`, `findQuestionAbove`, `inferTool`, `computeSignature`, `MARKER_CHARS`, `DETECTORS`.
- Produces: a `Detector` named `"highlighted-list"` registered third; handles marker-highlighted option lists **without** numbers, sending arrow navigation + Enter. This is the "hybrid" fallback for CLIs that don't number options.

- [ ] **Step 1: Write the failing tests**

Append to `src/test/promptDetectors.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/promptDetectors.test.ts`
Expected: FAIL — the box fixture currently returns null (numbered detector needs digits; nothing handles bare markers yet).

- [ ] **Step 3: Implement the detector**

In `src/prompt-detection/detectors.ts`, add before the `DETECTORS` declaration:

```ts
const MARKER_LINE_RE = new RegExp(`^[${MARKER_CHARS}]\\s+(.+?)\\s*$`);

const highlightedListDetector: Detector = {
  name: "highlighted-list",
  detect(lines) {
    const cleaned = lines.map(clean);
    // Only fire inside a TUI box (guards against prose with a stray "❯ ").
    if (!lines.some(hasBorder)) return null;

    let start = -1;
    for (let i = 0; i < cleaned.length; i++) {
      if (MARKER_LINE_RE.test(cleaned[i]) && !/^[^\s]*\d+[.)]/.test(cleaned[i])) {
        start = i;
        break;
      }
    }
    if (start === -1) return null;

    // Gather the marker line plus contiguous non-empty sibling lines that are
    // not borders, questions, or markered again.
    const items: { label: string; marker: boolean }[] = [];
    for (let k = start; k < cleaned.length; k++) {
      const c = cleaned[k];
      if (!c) break;
      const markered = MARKER_LINE_RE.test(c);
      const label = markered ? c.match(MARKER_LINE_RE)![1].trim() : c;
      if (label.endsWith("?")) break; // a trailing question is not an option
      items.push({ label, marker: markered });
    }
    if (items.length < 2) return null;

    const markerIndex = Math.max(0, items.findIndex((it) => it.marker));
    const options: PromptOption[] = items.map((it, idx) => {
      const delta = idx - markerIndex;
      const arrows = delta === 0
        ? ""
        : (delta > 0 ? "\x1b[B" : "\x1b[A").repeat(Math.abs(delta));
      return { label: it.label, send: arrows + "\r" };
    });

    const question = findQuestionAbove(cleaned, start) || "Select an option";
    return {
      tool: inferTool(lines),
      kind: "select",
      question,
      options,
      signature: computeSignature("select", question, options),
    };
  },
};
```

Update the registry (numbered and yes/no stay ahead so numbered prompts keep digit sends):

```ts
export const DETECTORS: Detector[] = [numberedListDetector, yesNoDetector, highlightedListDetector];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/promptDetectors.test.ts`
Expected: PASS — arrow sends match `["\r", "\x1b[B\r", "\x1b[B\x1b[B\r"]`; the no-box negative returns null; all prior tests green.

- [ ] **Step 5: Commit**

```bash
git add src/prompt-detection/detectors.ts src/test/promptDetectors.test.ts
git commit -m "feat(prompt-detection): highlighted-list arrow-fallback detector"
```

---

### Task 5: Input-box detector (`freeform`)

**Files:**
- Modify: `src/prompt-detection/detectors.ts`
- Test: `src/test/promptDetectors.test.ts`

**Interfaces:**
- Consumes: `clean`, `findQuestionAbove`, `inferTool`, `computeSignature`, `DETECTORS`.
- Produces: a `Detector` named `"input-box"` registered last; emits a `freeform` prompt (`options: []`) when an empty input line follows a question.

- [ ] **Step 1: Write the failing tests**

Append to `src/test/promptDetectors.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/promptDetectors.test.ts`
Expected: FAIL — the freeform fixture returns null.

- [ ] **Step 3: Implement the detector**

In `src/prompt-detection/detectors.ts`, add before the `DETECTORS` declaration:

```ts
const inputBoxDetector: Detector = {
  name: "input-box",
  detect(lines) {
    const cleaned = lines.map(clean);
    for (let i = cleaned.length - 1; i >= 0; i--) {
      if (!/^>\s*$/.test(cleaned[i])) continue; // empty input affordance
      const q = findQuestionAbove(cleaned, i);
      if (q.endsWith("?")) {
        return {
          tool: inferTool(lines),
          kind: "freeform",
          question: q,
          options: [],
          signature: computeSignature("freeform", q, []),
        };
      }
    }
    return null;
  },
};
```

Update the registry (input-box last so structured prompts win):

```ts
export const DETECTORS: Detector[] = [
  numberedListDetector,
  yesNoDetector,
  highlightedListDetector,
  inputBoxDetector,
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/promptDetectors.test.ts`
Expected: PASS — freeform detected; shell-prompt negatives return null; all prior tests green.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/prompt-detection/detectors.ts src/test/promptDetectors.test.ts
git commit -m "feat(prompt-detection): input-box freeform detector"
```

---

### Task 6: Prompt store (queue + dedupe)

**Files:**
- Create: `src/store/promptStore.ts`
- Test: `src/test/promptStore.test.ts`

**Interfaces:**
- Consumes: `DetectedPrompt` from `../prompt-detection/types`.
- Produces: `PendingPrompt { tabId: string; prompt: DetectedPrompt }`; `usePromptStore` with state `{ queue: PendingPrompt[]; current: PendingPrompt | null; handled: string[] }` and actions `enqueue(p)`, `resolve()`, `dismiss()`, `dismissIfStale(signature)`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/test/promptStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { usePromptStore } from "../store/promptStore";
import { DetectedPrompt } from "../prompt-detection/types";

function mk(sig: string): DetectedPrompt {
  return { tool: "claude", kind: "select", question: "Q " + sig, options: [{ label: "Yes", send: "1" }], signature: sig };
}

beforeEach(() => {
  usePromptStore.setState({ queue: [], current: null, handled: [] });
});

describe("promptStore", () => {
  it("promotes the first enqueued prompt to current", () => {
    usePromptStore.getState().enqueue({ tabId: "t1", prompt: mk("a") });
    expect(usePromptStore.getState().current?.prompt.signature).toBe("a");
    expect(usePromptStore.getState().queue).toHaveLength(0);
  });

  it("queues additional prompts behind current", () => {
    const s = usePromptStore.getState();
    s.enqueue({ tabId: "t1", prompt: mk("a") });
    s.enqueue({ tabId: "t2", prompt: mk("b") });
    expect(usePromptStore.getState().current?.prompt.signature).toBe("a");
    expect(usePromptStore.getState().queue.map((q) => q.prompt.signature)).toEqual(["b"]);
  });

  it("dedupes by signature across current and queue", () => {
    const s = usePromptStore.getState();
    s.enqueue({ tabId: "t1", prompt: mk("a") });
    s.enqueue({ tabId: "t1", prompt: mk("a") });
    s.enqueue({ tabId: "t1", prompt: mk("b") });
    s.enqueue({ tabId: "t1", prompt: mk("b") });
    expect(usePromptStore.getState().queue).toHaveLength(1);
  });

  it("resolve advances to the next and remembers handled", () => {
    const s = usePromptStore.getState();
    s.enqueue({ tabId: "t1", prompt: mk("a") });
    s.enqueue({ tabId: "t2", prompt: mk("b") });
    usePromptStore.getState().resolve();
    expect(usePromptStore.getState().current?.prompt.signature).toBe("b");
    // resolved signature must not re-enqueue
    usePromptStore.getState().enqueue({ tabId: "t1", prompt: mk("a") });
    expect(usePromptStore.getState().queue).toHaveLength(0);
  });

  it("dismiss does not reopen the same signature", () => {
    const s = usePromptStore.getState();
    s.enqueue({ tabId: "t1", prompt: mk("a") });
    usePromptStore.getState().dismiss();
    expect(usePromptStore.getState().current).toBeNull();
    usePromptStore.getState().enqueue({ tabId: "t1", prompt: mk("a") });
    expect(usePromptStore.getState().current).toBeNull();
  });

  it("dismissIfStale clears only the matching current", () => {
    const s = usePromptStore.getState();
    s.enqueue({ tabId: "t1", prompt: mk("a") });
    usePromptStore.getState().dismissIfStale("zzz");
    expect(usePromptStore.getState().current?.prompt.signature).toBe("a");
    usePromptStore.getState().dismissIfStale("a");
    expect(usePromptStore.getState().current).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/promptStore.test.ts`
Expected: FAIL — cannot import `usePromptStore` (module missing).

- [ ] **Step 3: Implement the store**

```ts
// src/store/promptStore.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/promptStore.test.ts`
Expected: PASS — all six store cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/promptStore.ts src/test/promptStore.test.ts
git commit -m "feat(prompt-detection): promptStore queue with dedupe"
```

---

### Task 7: Buffer scanner glue

**Files:**
- Create: `src/prompt-detection/scan.ts`
- Test: `src/test/promptScan.test.ts`

**Interfaces:**
- Consumes: `detectPrompt` (detectors.ts), `usePromptStore` (promptStore.ts), `Terminal` type (`@xterm/xterm`).
- Produces: `scanLines(lines: string[], tabId: string): void` (testable, drives the store) and `readVisibleLines(term: Terminal): string[]` (reads the xterm viewport).

- [ ] **Step 1: Write the failing test**

```ts
// src/test/promptScan.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { scanLines } from "../prompt-detection/scan";
import { usePromptStore } from "../store/promptStore";

beforeEach(() => {
  usePromptStore.setState({ queue: [], current: null, handled: [] });
});

const claude = [
  "│ Do you want to proceed?                        │",
  "│ ❯ 1. Yes                                       │",
  "│   2. No                                        │",
];

describe("scanLines", () => {
  it("enqueues a detected prompt with the tab id", () => {
    scanLines(claude, "tab-7");
    const cur = usePromptStore.getState().current!;
    expect(cur.tabId).toBe("tab-7");
    expect(cur.prompt.question).toBe("Do you want to proceed?");
  });

  it("auto-dismisses the current prompt for this tab when it disappears", () => {
    scanLines(claude, "tab-7");
    scanLines(["$ ", "all done"], "tab-7"); // prompt gone
    expect(usePromptStore.getState().current).toBeNull();
  });

  it("does not dismiss a prompt belonging to a different tab", () => {
    scanLines(claude, "tab-7");
    scanLines(["nothing here"], "tab-OTHER");
    expect(usePromptStore.getState().current?.tabId).toBe("tab-7");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/promptScan.test.ts`
Expected: FAIL — cannot import `scanLines` (module missing).

- [ ] **Step 3: Implement the scanner**

```ts
// src/prompt-detection/scan.ts
import type { Terminal } from "@xterm/xterm";
import { detectPrompt } from "./detectors";
import { usePromptStore } from "../store/promptStore";

// Read the currently visible viewport of the terminal as plain text lines.
export function readVisibleLines(term: Terminal): string[] {
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let y = buf.baseY; y < buf.baseY + term.rows; y++) {
    const line = buf.getLine(y);
    lines.push(line ? line.translateToString(true) : "");
  }
  return lines;
}

// Run detection over already-extracted lines and reconcile with the store.
export function scanLines(lines: string[], tabId: string): void {
  const prompt = detectPrompt(lines);
  const store = usePromptStore.getState();
  if (prompt) {
    store.enqueue({ tabId, prompt });
  } else if (store.current && store.current.tabId === tabId) {
    // Nothing detected anymore for this tab → the user likely answered in the
    // terminal directly. Drop the stale modal.
    store.dismissIfStale(store.current.prompt.signature);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/promptScan.test.ts`
Expected: PASS — all three scan cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/prompt-detection/scan.ts src/test/promptScan.test.ts
git commit -m "feat(prompt-detection): buffer scanner glue"
```

---

### Task 8: Wire detection into TerminalView (debounced scan)

**Files:**
- Modify: `src/components/TerminalView.tsx`

**Interfaces:**
- Consumes: `scanLines`, `readVisibleLines` from `../prompt-detection/scan`; existing `term` (local var inside the main effect), `tabId` prop, existing `transport.onPtyData`.
- Produces: a ~350ms idle-debounced call to `scanLines(readVisibleLines(term), tabId)` after PTY output stops.

- [ ] **Step 1: Add the import**

At the top of `src/components/TerminalView.tsx`, after the existing import of `ErrorBanner`:

```ts
import { scanLines, readVisibleLines } from "../prompt-detection/scan";
```

- [ ] **Step 2: Add a debounce timer ref**

Next to the other refs near the top of the component (e.g. after `const outputRafRef = useRef<number | null>(null);`):

```ts
const promptScanTimer = useRef<number | null>(null);
```

- [ ] **Step 3: Trigger the debounced scan inside the existing `onPtyData` callback**

In the `transport.onPtyData(tabId, (data) => { … })` callback (around TerminalView.tsx:208), add at the END of the callback body, after the existing `requestAnimationFrame` write-batching block:

```ts
      // Debounced prompt detection: when PTY output goes idle, scan the
      // rendered buffer for an AI permission/question prompt. Best-effort.
      if (promptScanTimer.current !== null) clearTimeout(promptScanTimer.current);
      promptScanTimer.current = window.setTimeout(() => {
        try {
          scanLines(readVisibleLines(term), tabId);
        } catch {
          /* detection must never break the terminal */
        }
      }, 350);
```

- [ ] **Step 4: Clear the timer on cleanup**

In the effect's cleanup `return () => { … }` (around TerminalView.tsx:270-275), add alongside the other cancellations:

```ts
      if (promptScanTimer.current !== null) {
        clearTimeout(promptScanTimer.current);
        promptScanTimer.current = null;
      }
```

- [ ] **Step 5: Typecheck and verify the full suite still passes**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx vitest run`
Expected: PASS — all existing + new tests green.

- [ ] **Step 6: Commit**

```bash
git add src/components/TerminalView.tsx
git commit -m "feat(prompt-detection): debounced buffer scan in TerminalView"
```

---

### Task 9: Extract shared tab theme (icons + colors)

**Files:**
- Create: `src/components/tabTheme.ts`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Produces: `TYPE_ICONS: Record<TabType, string>`, `TYPE_COLORS: Record<TabType, string>` exported from `tabTheme.ts`.
- Consumes (Sidebar): imports the two maps instead of declaring them locally.

- [ ] **Step 1: Create `tabTheme.ts`**

```ts
// src/components/tabTheme.ts
import { TabType } from "../store/tabStore";

// Type icon shown in the sidebar and the permission modal header.
export const TYPE_ICONS: Record<TabType, string> = {
  project: "◈",
  frontend: "</>",
  backend: "⊛",
  infra: "⚙",
  logs: "≡",
  database: "⊕",
};

// Accent color per tab type.
export const TYPE_COLORS: Record<TabType, string> = {
  project: "#3b82f6", // blue
  frontend: "#a855f7", // purple
  backend: "#4ade80", // green
  infra: "#f97316", // orange
  logs: "#fbbf24", // yellow
  database: "#22d3ee", // cyan
};
```

- [ ] **Step 2: Update Sidebar to import them**

In `src/components/Sidebar.tsx`, delete the local `TYPE_ICONS` and `TYPE_COLORS` declarations (the two `const … : Record<TabType, string> = { … }` blocks near the top) and add this import after the existing `RemoteAccessPanel` import:

```ts
import { TYPE_ICONS, TYPE_COLORS } from "./tabTheme";
```

(Leave `WORKTREE_COLOR` and the `TabType` import in place; `TabType` is still used elsewhere in the file.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (no unused-symbol errors for the removed consts).

- [ ] **Step 4: Commit**

```bash
git add src/components/tabTheme.ts src/components/Sidebar.tsx
git commit -m "refactor: extract shared tab icons/colors to tabTheme"
```

---

### Task 10: PermissionModal component

**Files:**
- Create: `src/components/PermissionModal.tsx`

**Interfaces:**
- Consumes: `usePromptStore` (current/resolve/dismiss), `useTabStore` (tab alias/type + setActiveTab), `transport.ptyWrite`, `TYPE_ICONS`/`TYPE_COLORS` from `tabTheme`.
- Produces: default-exported `PermissionModal` React component (renders null when no current prompt).

- [ ] **Step 1: Create the component**

```tsx
// src/components/PermissionModal.tsx
import { useEffect, useState } from "react";
import { usePromptStore } from "../store/promptStore";
import { useTabStore } from "../store/tabStore";
import { transport } from "../transport/factory";
import { TYPE_ICONS, TYPE_COLORS } from "./tabTheme";

export default function PermissionModal() {
  const current = usePromptStore((s) => s.current);
  const resolve = usePromptStore((s) => s.resolve);
  const dismiss = usePromptStore((s) => s.dismiss);
  const tabs = useTabStore((s) => s.tabs);
  const setActiveTab = useTabStore((s) => s.setActiveTab);

  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset transient state whenever a new prompt becomes current.
  useEffect(() => {
    setText("");
    setError(null);
  }, [current?.prompt.signature]);

  // Esc dismisses without answering.
  useEffect(() => {
    if (!current) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [current, dismiss]);

  if (!current) return null;

  const tab = tabs.find((t) => t.id === current.tabId);
  const accent = tab ? TYPE_COLORS[tab.type] : "#3b82f6";
  const icon = tab ? TYPE_ICONS[tab.type] : "◈";
  const alias = tab?.alias ?? current.tabId;
  const { prompt } = current;

  const send = (seq: string) => {
    try {
      transport.ptyWrite(current.tabId, seq);
      setActiveTab(current.tabId); // jump to the originating terminal on answer
      resolve();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  return (
    <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className="w-[32rem] max-w-[90vw] rounded-lg border border-border bg-sidebar shadow-2xl shadow-black/60 overflow-hidden">
        {/* Origin tab header */}
        <div
          className="flex items-center gap-2 px-4 py-2.5 border-b border-border"
          style={{ borderLeft: `4px solid ${accent}` }}
        >
          <span className="text-xs font-mono" style={{ color: accent }}>{icon}</span>
          <span className="text-sm font-semibold text-zinc-100 truncate">{alias}</span>
          <span className="ml-auto text-[10px] uppercase tracking-wide text-zinc-500">{prompt.tool}</span>
        </div>

        {/* Question */}
        <div className="px-4 py-3">
          <p className="text-sm font-mono text-zinc-200 whitespace-pre-wrap break-words">{prompt.question}</p>
        </div>

        {/* Options or free-form input */}
        <div className="px-4 pb-4 flex flex-col gap-2">
          {prompt.kind === "freeform" ? (
            <>
              <textarea
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    send(text + "\r");
                  }
                }}
                rows={3}
                className="w-full bg-zinc-900 text-zinc-100 text-sm rounded border border-border px-2 py-1.5 outline-none focus:border-accent resize-none"
                placeholder="Escribe tu respuesta… (⌘/Ctrl+Enter para enviar)"
              />
              <button
                className="self-end px-3 py-1.5 rounded text-sm font-medium text-white"
                style={{ backgroundColor: accent }}
                onClick={() => send(text + "\r")}
              >
                Enviar
              </button>
            </>
          ) : (
            prompt.options.map((opt, idx) => (
              <button
                key={idx}
                className={`text-left px-3 py-2 rounded text-sm transition-colors border ${
                  idx === 0
                    ? "text-white font-medium"
                    : "text-zinc-200 border-border hover:bg-sidebar-hover"
                }`}
                style={idx === 0 ? { backgroundColor: accent, borderColor: accent } : undefined}
                onClick={() => send(opt.send)}
              >
                {opt.label}
              </button>
            ))
          )}

          {error && <p className="text-xs text-red-400">No se pudo enviar: {error}</p>}

          <button
            className="self-start mt-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            onClick={() => dismiss()}
          >
            Responder en la terminal (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/PermissionModal.tsx
git commit -m "feat(prompt-detection): PermissionModal component"
```

---

### Task 11: Mount modal + sidebar pending indicator

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: default `PermissionModal` (App.tsx); `usePromptStore` (Sidebar TabItem).
- Produces: modal rendered at app root; a small amber indicator on sidebar tabs that have a pending prompt.

- [ ] **Step 1: Mount the modal in App.tsx**

In `src/App.tsx`, add the import after the `ToastContainer` import:

```ts
import PermissionModal from "./components/PermissionModal";
```

Then render it just before the closing `</div>` of the main layout, right after `<ToastContainer />`:

```tsx
      <ToastContainer />
      <PermissionModal />
    </div>
```

- [ ] **Step 2: Add the pending indicator in Sidebar**

In `src/components/Sidebar.tsx`, add the import after the `tabTheme` import:

```ts
import { usePromptStore } from "../store/promptStore";
```

Inside the `TabItem` component, after the existing hooks (e.g. after `const branchBtnRef = useRef<HTMLButtonElement>(null);`):

```ts
  const hasPrompt = usePromptStore(
    (s) => s.current?.tabId === tab.id || s.queue.some((q) => q.tabId === tab.id)
  );
```

Then, in the activity/status indicator block, change the first branch so a pending prompt takes priority over `hasActivity`. Replace:

```tsx
        {tab.hasActivity ? (
          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-blue-400 animate-pulse" title="New activity" />
        ) : (
```

with:

```tsx
        {hasPrompt ? (
          <span className="text-amber-400 text-xs flex-shrink-0 animate-pulse" title="Esperando tu respuesta">❗</span>
        ) : tab.hasActivity ? (
          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-blue-400 animate-pulse" title="New activity" />
        ) : (
```

(The existing `: (` and the status-dot `<span>` that follows remain unchanged.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/Sidebar.tsx
git commit -m "feat(prompt-detection): mount modal + sidebar pending indicator"
```

---

### Task 12: Full suite + manual validation

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `npx vitest run`
Expected: PASS — all suites (detectors, store, scan, plus pre-existing tabStore/diff).

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual validation in the app**

Launch the app (Tauri dev, or the Vite dev server with a seeded token as used previously). In a terminal tab run a real AI CLI and trigger a permission prompt (e.g. ask Claude/Codex/Gemini to run a command or edit a file). Verify:
  1. The modal appears within ~half a second of the prompt rendering.
  2. The header shows the correct originating tab (alias + type color).
  3. The question and option buttons match what the CLI drew.
  4. Clicking an option advances the CLI in that terminal (and the app switches to that tab).
  5. Answering the prompt directly in the terminal instead auto-closes the modal.
  6. A free-form question shows a textarea and "Enviar" sends the typed text.

Note any CLI whose real output doesn't match the fixtures; capture the actual buffer text and add/adjust a detector + fixture test before considering detection complete.

- [ ] **Step 4: Final commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "test: prompt detection full-suite + manual validation pass"
```

---

## Self-Review

**Spec coverage:**
- Detection over rendered xterm buffer, idle debounce ~350ms → Tasks 7, 8. ✓
- Tool-agnostic structural detectors (select/confirm/freeform) → Tasks 2–5. ✓
- Hybrid send (digit primary + arrow fallback) → Task 2 (digits), Task 4 (arrows). ✓
- Works for Claude/Codex/Gemini + generic → fixtures in Tasks 2–5; structural design. ✓
- promptStore queue + dedupe + stale dismiss → Task 6, plus `dismissIfStale` wired in Task 7. ✓
- Global immediate modal with origin tab + question + buttons/textarea → Tasks 10, 11. ✓
- Click writes to originating PTY + jumps to tab on answer → Task 10 (`send`). ✓
- Esc / "responder en terminal" dismiss → Task 10. ✓
- Sidebar pending indicator (reuses activity dot slot) → Task 11. ✓
- Error feedback on ptyWrite failure → Task 10 (`error` state). ✓
- Tests: detector fixtures + negatives, store behavior → Tasks 2–6. ✓

**Placeholder scan:** No TBD/TODO; every code step contains full code. ✓

**Type consistency:** `DetectedPrompt`/`PromptOption`/`PendingPrompt` used identically across Tasks 1, 6, 7, 10. Store actions `enqueue/resolve/dismiss/dismissIfStale` match between Task 6 definition and Tasks 7/10/11 consumers. `scanLines`/`readVisibleLines` signatures match between Task 7 and Task 8. `TYPE_ICONS`/`TYPE_COLORS` match between Task 9 and Task 10. ✓
