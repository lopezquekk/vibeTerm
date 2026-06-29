# Settings Panel Implementation Plan (Spec 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a basic settings panel (modal) that parametrizes prompt detection, terminal appearance, notifications, and behavior/safety — with defaults equal to current behavior (zero regression).

**Architecture:** A persisted `settingsStore` (zustand) holds all settings; each consumer reads only what it needs via a selector and gates its behavior. A `SettingsModal` (mounted at root, opened from a gear in the sidebar) edits settings live. A non-persisted `uiStore` holds the modal open state.

**Tech Stack:** TypeScript, React 18, zustand (+ persist), @xterm/xterm, Web Notifications API, vitest + jsdom + @testing-library/react.

## Global Constraints

- Defaults MUST equal current behavior: `fontSize: 13`, `cursorBlink: true`, `scrollback: 5000`; prompt detection on; freeform on; focus-on-answer on; debounce 350ms; port detection on; cwd tracking on; notifications off; confirm-tab-close off. Introducing the panel changes nothing until the user edits a setting.
- Persistence key is exactly `vibeterm-settings` (zustand persist), separate from `vibeterm-workspace` (tabStore).
- Detectors stay PURE — settings-based filtering lives in the `scanLines` glue, never in detectors.
- All settings-driven side effects are best-effort: wrap live terminal mutation and notifications in try/catch; never throw into the render path.
- Tests: vitest globals; `npx vitest run <file>`; typecheck `npx tsc --noEmit`. UI tests use `@testing-library/react` (already a devDependency).

---

### Task 1: settingsStore

**Files:**
- Create: `src/store/settingsStore.ts`
- Test: `src/test/settingsStore.test.ts`

**Interfaces:**
- Produces: `Settings` (interface), `DEFAULT_SETTINGS: Settings`, `useSettingsStore` with all `Settings` fields plus `set<K extends keyof Settings>(key: K, value: Settings[K]): void` and `reset(): void`.

- [ ] **Step 1: Write the failing test**

```ts
// src/test/settingsStore.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/settingsStore.test.ts`
Expected: FAIL — cannot import from `../store/settingsStore`.

- [ ] **Step 3: Implement the store**

```ts
// src/store/settingsStore.ts
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
      set: (key, value) => set({ [key]: value } as Pick<Settings, keyof Settings>),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    { name: "vibeterm-settings" }
  )
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/settingsStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/settingsStore.ts src/test/settingsStore.test.ts
git commit -m "feat(settings): settingsStore with persisted defaults"
```

---

### Task 2: Notifications helper

**Files:**
- Create: `src/notifications.ts`
- Test: `src/test/notifications.test.ts`

**Interfaces:**
- Consumes: `useSettingsStore` (Task 1), `DetectedPrompt` from `./prompt-detection/types`.
- Produces: `requestNotificationPermission(): Promise<boolean>` and `notifyPrompt(isActiveTab: boolean, prompt: DetectedPrompt): void`.

- [ ] **Step 1: Write the failing test**

```ts
// src/test/notifications.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/notifications.test.ts`
Expected: FAIL — cannot import `notifyPrompt`.

- [ ] **Step 3: Implement the helper**

```ts
// src/notifications.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/notifications.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notifications.ts src/test/notifications.test.ts
git commit -m "feat(settings): prompt notification helper"
```

---

### Task 3: promptStore.enqueue returns whether it inserted

**Files:**
- Modify: `src/store/promptStore.ts`
- Test: `src/test/promptStore.test.ts`

**Interfaces:**
- Produces: `enqueue(p: PendingPrompt): boolean` — `true` when a new prompt was inserted (as `current` or queued), `false` when deduped.

- [ ] **Step 1: Write the failing test**

Append to `src/test/promptStore.test.ts`:

```ts
describe("enqueue return value", () => {
  it("returns true on insert and false on duplicate", () => {
    const s = usePromptStore.getState();
    expect(s.enqueue({ tabId: "t1", prompt: mk("a") })).toBe(true);
    expect(usePromptStore.getState().enqueue({ tabId: "t1", prompt: mk("a") })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/promptStore.test.ts`
Expected: FAIL — `enqueue` currently returns `void` (assertion `toBe(true)` fails / type error).

- [ ] **Step 3: Update the store**

In `src/store/promptStore.ts`:
- Change the store creator to expose `get`: the `create<PromptStore>()((set) => ...)` becomes `create<PromptStore>()((set, get) => ...)`.
- In the `PromptStore` interface, change `enqueue: (p: PendingPrompt) => void;` to `enqueue: (p: PendingPrompt) => boolean;`.
- Replace the `enqueue` implementation with:

```ts
  enqueue: (p) => {
    const s = get();
    const sig = p.prompt.signature;
    const known =
      s.handled.includes(sig) ||
      s.current?.prompt.signature === sig ||
      s.queue.some((q) => q.prompt.signature === sig);
    if (known) return false;
    if (!s.current) set({ current: p });
    else set({ queue: [...s.queue, p] });
    return true;
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/test/promptStore.test.ts`
Expected: PASS — the new test plus all existing promptStore tests (enqueue still dedupes; resolve/dismiss/reconcileTab unchanged).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors (the only `enqueue` caller, `scanLines`, ignores the return today).

```bash
git add src/store/promptStore.ts src/test/promptStore.test.ts
git commit -m "feat(settings): enqueue reports whether a prompt was inserted"
```

---

### Task 4: Wire settings + notification into scanLines

**Files:**
- Modify: `src/prompt-detection/scan.ts`
- Test: `src/test/promptScan.test.ts`

**Interfaces:**
- Consumes: `useSettingsStore` (Task 1), `useTabStore` (`activeTabId`), `notifyPrompt` (Task 2), `enqueue` returning boolean (Task 3).

- [ ] **Step 1: Write the failing tests**

In `src/test/promptScan.test.ts`, add the settings + tab store imports at the top and reset them in `beforeEach`, then add the new cases. Update the file's imports/`beforeEach` to:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { scanLines } from "../prompt-detection/scan";
import { usePromptStore } from "../store/promptStore";
import { useSettingsStore, DEFAULT_SETTINGS } from "../store/settingsStore";

beforeEach(() => {
  usePromptStore.setState({ queue: [], current: null, handled: [] });
  useSettingsStore.setState({ ...DEFAULT_SETTINGS });
});
```

Then append:

```ts
const freeform = [
  "What would you like me to focus on for the refactor?",
  "",
  "│ >                                             │",
];

describe("scanLines respects settings", () => {
  it("does not enqueue when promptDetectionEnabled is false", () => {
    useSettingsStore.setState({ promptDetectionEnabled: false });
    scanLines(claude, "t1");
    expect(usePromptStore.getState().current).toBeNull();
  });

  it("ignores a freeform prompt when detectFreeform is false", () => {
    useSettingsStore.setState({ detectFreeform: false });
    scanLines(freeform, "t1");
    expect(usePromptStore.getState().current).toBeNull();
  });

  it("still enqueues a select prompt when detectFreeform is false", () => {
    useSettingsStore.setState({ detectFreeform: false });
    scanLines(claude, "t1");
    expect(usePromptStore.getState().current?.prompt.kind).toBe("select");
  });
});
```

(`claude` is the existing fixture already defined in this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/promptScan.test.ts`
Expected: FAIL — detection currently ignores settings, so the disabled/freeform cases still enqueue.

- [ ] **Step 3: Update scanLines**

Replace the contents of `src/prompt-detection/scan.ts` below `readVisibleLines` with:

```ts
import { useSettingsStore } from "../store/settingsStore";
import { useTabStore } from "../store/tabStore";
import { notifyPrompt } from "../notifications";

// Run detection over already-extracted lines and reconcile with the store.
export function scanLines(lines: string[], tabId: string): void {
  const settings = useSettingsStore.getState();
  if (!settings.promptDetectionEnabled) return;

  let prompt = detectPrompt(lines);
  if (prompt && prompt.kind === "freeform" && !settings.detectFreeform) prompt = null;

  const store = usePromptStore.getState();
  const inserted = prompt ? store.enqueue({ tabId, prompt }) : false;
  store.reconcileTab(tabId, prompt ? prompt.signature : null);

  if (inserted && prompt) {
    const activeTabId = useTabStore.getState().activeTabId;
    const isActive = activeTabId === tabId.replace(/-split$/, "");
    notifyPrompt(isActive, prompt);
  }
}
```

Keep the existing top-of-file imports (`Terminal` type, `detectPrompt`, `usePromptStore`) and the `readVisibleLines` function unchanged; add the three new imports above (or grouped with the existing imports).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/test/promptScan.test.ts`
Expected: PASS — new cases pass; the original 3 scan cases still pass (defaults keep detection on, notifyOnPrompt off so no notification side effect).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/prompt-detection/scan.ts src/test/promptScan.test.ts
git commit -m "feat(settings): gate detection + freeform + notify in scanLines"
```

---

### Task 5: TerminalView — appearance settings (create + live apply)

**Files:**
- Modify: `src/components/TerminalView.tsx`

**Interfaces:**
- Consumes: `useSettingsStore` (`fontSize`, `cursorBlink`, `scrollback`).

- [ ] **Step 1: Add the import**

At the top of `src/components/TerminalView.tsx`, after the existing `scan` import (`import { scanLines, readVisibleLines } from "../prompt-detection/scan";`):

```ts
import { useSettingsStore } from "../store/settingsStore";
```

- [ ] **Step 2: Read appearance settings at Terminal creation**

In the main effect, replace the literal options in `const term = new Terminal({ ... })`. Change these three lines:

```ts
      fontSize: 13,
      lineHeight: 1.0,
      cursorBlink: true,
      scrollback: 5000,
```

to:

```ts
      fontSize: useSettingsStore.getState().fontSize,
      lineHeight: 1.0,
      cursorBlink: useSettingsStore.getState().cursorBlink,
      scrollback: useSettingsStore.getState().scrollback,
```

(Leave `theme`, `fontFamily`, and `allowProposedApi` unchanged.)

- [ ] **Step 3: Add a live-apply effect**

Add this effect to the component body (e.g. directly after the existing main `useEffect` that creates the terminal, at the same indentation level as other `useEffect`s):

```ts
  // Apply appearance settings live to this terminal when they change.
  useEffect(() => {
    return useSettingsStore.subscribe((s, prev) => {
      const term = termRef.current;
      if (!term) return;
      let changed = false;
      if (s.fontSize !== prev.fontSize) { term.options.fontSize = s.fontSize; changed = true; }
      if (s.cursorBlink !== prev.cursorBlink) { term.options.cursorBlink = s.cursorBlink; }
      if (s.scrollback !== prev.scrollback) { term.options.scrollback = s.scrollback; changed = true; }
      if (changed) {
        try {
          fitRef.current?.fit();
          transport.ptyResize(tabId, term.cols, term.rows);
        } catch {
          /* terminal may be disposed */
        }
      }
    });
  }, [tabId]);
```

(`termRef` and `fitRef` already exist in this component.)

- [ ] **Step 4: Typecheck and run full suite**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx vitest run`
Expected: PASS — same count as before (no new test; this is UI wiring).

- [ ] **Step 5: Commit**

```bash
git add src/components/TerminalView.tsx
git commit -m "feat(settings): terminal appearance from settings + live apply"
```

---

### Task 6: TerminalView — behavior gating (debounce ms, prompt skip, port, cwd)

**Files:**
- Modify: `src/components/TerminalView.tsx`

**Interfaces:**
- Consumes: `useSettingsStore` (`promptDetectionEnabled`, `promptScanDebounceMs`, `portDetection`, `cwdTracking`). (Import added in Task 5.)

- [ ] **Step 1: Gate the debounced scan and use the configured delay**

In the `onPtyData` callback, replace the existing debounce block:

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

with:

```ts
      // Debounced prompt detection: when PTY output goes idle, scan the
      // rendered buffer for an AI permission/question prompt. Best-effort.
      const detectSettings = useSettingsStore.getState();
      if (detectSettings.promptDetectionEnabled) {
        if (promptScanTimer.current !== null) clearTimeout(promptScanTimer.current);
        promptScanTimer.current = window.setTimeout(() => {
          try {
            scanLines(readVisibleLines(term), tabId);
          } catch {
            /* detection must never break the terminal */
          }
        }, detectSettings.promptScanDebounceMs);
      }
```

- [ ] **Step 2: Gate port detection**

Replace the `onPortDetected` handler:

```ts
    unlistenPort.current = transport.onPortDetected(tabId, (port) => {
      updateTab(tabId, { detectedPort: port });
    });
```

with:

```ts
    unlistenPort.current = transport.onPortDetected(tabId, (port) => {
      if (!useSettingsStore.getState().portDetection) return;
      updateTab(tabId, { detectedPort: port });
    });
```

- [ ] **Step 3: Gate cwd tracking**

Replace the first line of the `onCwdChanged` handler body. Change:

```ts
    unlistenCwd.current = transport.onCwdChanged(tabId, (newPath) => {
      updateTab(tabId, { path: newPath });
```

to:

```ts
    unlistenCwd.current = transport.onCwdChanged(tabId, (newPath) => {
      if (!useSettingsStore.getState().cwdTracking) return;
      updateTab(tabId, { path: newPath });
```

(Leave the rest of the handler — git status refresh, `refreshWorktree` — unchanged.)

- [ ] **Step 4: Typecheck and run full suite**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx vitest run`
Expected: PASS — same count as before.

- [ ] **Step 5: Commit**

```bash
git add src/components/TerminalView.tsx
git commit -m "feat(settings): gate scan debounce, port detection, cwd tracking"
```

---

### Task 7: PermissionModal — focus-on-answer setting

**Files:**
- Modify: `src/components/PermissionModal.tsx`

**Interfaces:**
- Consumes: `useSettingsStore` (`focusTabOnAnswer`).

- [ ] **Step 1: Add the import**

At the top of `src/components/PermissionModal.tsx`, after the existing `tabTheme` import:

```ts
import { useSettingsStore } from "../store/settingsStore";
```

- [ ] **Step 2: Gate the tab focus jump**

In the `send` function, change:

```ts
      transport.ptyWrite(current.tabId, seq);
      setActiveTab(baseTabId); // jump to the originating terminal on answer
      resolve();
```

to:

```ts
      transport.ptyWrite(current.tabId, seq);
      if (useSettingsStore.getState().focusTabOnAnswer) setActiveTab(baseTabId);
      resolve();
```

- [ ] **Step 3: Typecheck and run full suite**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx vitest run`
Expected: PASS — same count.

- [ ] **Step 4: Commit**

```bash
git add src/components/PermissionModal.tsx
git commit -m "feat(settings): honor focusTabOnAnswer in PermissionModal"
```

---

### Task 8: Reusable UI controls — Toggle & NumberField

**Files:**
- Create: `src/components/ui/Toggle.tsx`
- Create: `src/components/ui/NumberField.tsx`
- Test: `src/test/uiControls.test.tsx`

**Interfaces:**
- Produces: `Toggle({ checked, onChange, disabled? })` and `NumberField({ value, onChange, min, max, step?, disabled? })`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/test/uiControls.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toggle } from "../components/ui/Toggle";
import { NumberField } from "../components/ui/NumberField";

describe("Toggle", () => {
  it("calls onChange with the negated value on click", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does not fire when disabled", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("NumberField", () => {
  it("clamps a value above max", () => {
    const onChange = vi.fn();
    render(<NumberField value={13} onChange={onChange} min={10} max={24} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "99" } });
    expect(onChange).toHaveBeenCalledWith(24);
  });

  it("clamps a value below min", () => {
    const onChange = vi.fn();
    render(<NumberField value={13} onChange={onChange} min={10} max={24} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/uiControls.test.tsx`
Expected: FAIL — cannot import `Toggle`/`NumberField`.

- [ ] **Step 3: Implement the controls**

```tsx
// src/components/ui/Toggle.tsx
interface ToggleProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 disabled:opacity-40 ${
        checked ? "bg-accent" : "bg-zinc-600"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
```

```tsx
// src/components/ui/NumberField.tsx
interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
}

export function NumberField({ value, onChange, min, max, step = 1, disabled }: NumberFieldProps) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (!Number.isNaN(n)) onChange(clamp(n));
      }}
      className="w-20 bg-zinc-900 text-zinc-100 text-sm rounded border border-border px-2 py-1 outline-none focus:border-accent disabled:opacity-40"
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/uiControls.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Toggle.tsx src/components/ui/NumberField.tsx src/test/uiControls.test.tsx
git commit -m "feat(settings): reusable Toggle and NumberField controls"
```

---

### Task 9: uiStore + SettingsModal

**Files:**
- Create: `src/store/uiStore.ts`
- Create: `src/components/SettingsModal.tsx`

**Interfaces:**
- Produces: `useUiStore` with `settingsOpen: boolean`, `openSettings(): void`, `closeSettings(): void`; and default-exported `SettingsModal` (renders null when `settingsOpen` is false).
- Consumes: `useSettingsStore`, `Toggle`, `NumberField`, `requestNotificationPermission`.

- [ ] **Step 1: Create the uiStore**

```ts
// src/store/uiStore.ts
import { create } from "zustand";

interface UiStore {
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));
```

- [ ] **Step 2: Create the SettingsModal**

```tsx
// src/components/SettingsModal.tsx
import { useEffect, useState } from "react";
import { useUiStore } from "../store/uiStore";
import { useSettingsStore } from "../store/settingsStore";
import { requestNotificationPermission } from "../notifications";
import { Toggle } from "./ui/Toggle";
import { NumberField } from "./ui/NumberField";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4 border-b border-border last:border-b-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-3">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function Row({ label, hint, disabled, children }: { label: string; hint?: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-center justify-between gap-4 ${disabled ? "opacity-40" : ""}`}>
      <div className="min-w-0">
        <div className="text-sm text-zinc-100">{label}</div>
        {hint && <div className="text-xs text-zinc-500">{hint}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

export default function SettingsModal() {
  const open = useUiStore((s) => s.settingsOpen);
  const close = useUiStore((s) => s.closeSettings);
  const s = useSettingsStore();
  const [notifyError, setNotifyError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, close]);

  if (!open) return null;

  const onToggleNotify = async (v: boolean) => {
    if (v) {
      const ok = await requestNotificationPermission();
      if (!ok) { setNotifyError("Permiso de notificaciones denegado"); return; }
      setNotifyError(null);
    }
    s.set("notifyOnPrompt", v);
  };

  return (
    <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={close}>
      <div
        className="w-[34rem] max-w-[92vw] max-h-[85vh] overflow-y-auto rounded-lg border border-border bg-sidebar shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border sticky top-0 bg-sidebar">
          <span className="text-sm font-semibold text-zinc-100">Ajustes</span>
          <button className="text-zinc-500 hover:text-zinc-200 text-sm" onClick={close}>✕</button>
        </div>

        <Section title="Detección de prompts">
          <Row label="Detectar prompts de IA" hint="Muestra un modal cuando una IA pide permiso o hace una pregunta">
            <Toggle checked={s.promptDetectionEnabled} onChange={(v) => s.set("promptDetectionEnabled", v)} />
          </Row>
          <Row label="Detectar preguntas de texto libre" hint="El caso más propenso a falsos positivos" disabled={!s.promptDetectionEnabled}>
            <Toggle checked={s.detectFreeform} onChange={(v) => s.set("detectFreeform", v)} disabled={!s.promptDetectionEnabled} />
          </Row>
          <Row label="Saltar a la pestaña al responder" disabled={!s.promptDetectionEnabled}>
            <Toggle checked={s.focusTabOnAnswer} onChange={(v) => s.set("focusTabOnAnswer", v)} disabled={!s.promptDetectionEnabled} />
          </Row>
          <Row label="Retardo de detección (ms)" hint="Avanzado · tiempo de inactividad antes de escanear" disabled={!s.promptDetectionEnabled}>
            <NumberField value={s.promptScanDebounceMs} onChange={(v) => s.set("promptScanDebounceMs", v)} min={100} max={2000} step={50} disabled={!s.promptDetectionEnabled} />
          </Row>
        </Section>

        <Section title="Apariencia">
          <Row label="Tamaño de fuente">
            <NumberField value={s.fontSize} onChange={(v) => s.set("fontSize", v)} min={10} max={24} />
          </Row>
          <Row label="Parpadeo del cursor">
            <Toggle checked={s.cursorBlink} onChange={(v) => s.set("cursorBlink", v)} />
          </Row>
          <Row label="Scrollback (líneas)">
            <NumberField value={s.scrollback} onChange={(v) => s.set("scrollback", v)} min={500} max={50000} step={500} />
          </Row>
        </Section>

        <Section title="Notificaciones">
          <Row label="Avisar al detectar un prompt">
            <Toggle checked={s.notifyOnPrompt} onChange={onToggleNotify} />
          </Row>
          <Row label="Solo en pestañas en segundo plano" disabled={!s.notifyOnPrompt}>
            <Toggle checked={s.notifyOnlyWhenBackground} onChange={(v) => s.set("notifyOnlyWhenBackground", v)} disabled={!s.notifyOnPrompt} />
          </Row>
          <Row label="Sonido al detectar" disabled={!s.notifyOnPrompt}>
            <Toggle checked={s.notifySound} onChange={(v) => s.set("notifySound", v)} disabled={!s.notifyOnPrompt} />
          </Row>
          {notifyError && <p className="text-xs text-red-400">{notifyError}</p>}
        </Section>

        <Section title="Comportamiento">
          <Row label="Confirmar antes de cerrar una pestaña">
            <Toggle checked={s.confirmTabClose} onChange={(v) => s.set("confirmTabClose", v)} />
          </Row>
          <Row label="Detectar puertos de servidores">
            <Toggle checked={s.portDetection} onChange={(v) => s.set("portDetection", v)} />
          </Row>
          <Row label="Seguir el directorio de trabajo (OSC7)">
            <Toggle checked={s.cwdTracking} onChange={(v) => s.set("cwdTracking", v)} />
          </Row>
        </Section>

        <div className="px-5 py-3 border-t border-border">
          <button className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors" onClick={() => s.reset()}>
            Restablecer valores por defecto
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and run full suite**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx vitest run`
Expected: PASS — same count (no new test; component verified manually in Task 11).

- [ ] **Step 4: Commit**

```bash
git add src/store/uiStore.ts src/components/SettingsModal.tsx
git commit -m "feat(settings): uiStore + SettingsModal"
```

---

### Task 10: Mount SettingsModal + gear button in sidebar

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: default `SettingsModal` (App), `useUiStore` (Sidebar).

- [ ] **Step 1: Mount the modal in App.tsx**

In `src/App.tsx`, add the import after the `PermissionModal` import:

```ts
import SettingsModal from "./components/SettingsModal";
```

Then render it right after `<PermissionModal />`:

```tsx
      <PermissionModal />
      <SettingsModal />
    </div>
```

- [ ] **Step 2: Add the gear button in the sidebar header**

In `src/components/Sidebar.tsx`, add the import after the `usePromptStore` import:

```ts
import { useUiStore } from "../store/uiStore";
```

In `export default function Sidebar()`, read the action at the top of the component body — change:

```ts
  const { tabs, activeTabId, addTab, sidebarMode, setSidebarMode } = useTabStore();
```

to add the ui action just below it:

```ts
  const { tabs, activeTabId, addTab, sidebarMode, setSidebarMode } = useTabStore();
  const openSettings = useUiStore((s) => s.openSettings);
```

Then add the gear button in the header, immediately before the `{/* Collapse button — hides the sidebar */}` comment/button:

```tsx
        {/* Settings */}
        <button
          className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-accent hover:bg-zinc-700 transition-colors"
          title="Ajustes"
          onClick={openSettings}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

```

- [ ] **Step 3: Wire confirmTabClose into the remove button**

In `src/components/Sidebar.tsx`, the `TabItem` component already imports `useSettingsStore`? It does not yet — add to `TabItem` a settings read. First, add the import at the top of the file (if not already present from another task):

```ts
import { useSettingsStore } from "../store/settingsStore";
```

Then change the remove button's `onClick` from:

```tsx
          onClick={(e) => {
            e.stopPropagation();
            removeTab(tab.id);
          }}
```

to:

```tsx
          onClick={(e) => {
            e.stopPropagation();
            if (useSettingsStore.getState().confirmTabClose && !window.confirm(`¿Cerrar "${tab.alias}"?`)) return;
            removeTab(tab.id);
          }}
```

- [ ] **Step 4: Typecheck and run full suite**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx vitest run`
Expected: PASS — same count.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/Sidebar.tsx
git commit -m "feat(settings): mount SettingsModal, gear button, confirm tab close"
```

---

### Task 11: Full suite + manual validation

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `npx vitest run`
Expected: PASS — all suites (settingsStore, notifications, uiControls, promptStore, promptScan, detectors, plus pre-existing tabStore/diff/server).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual validation**

Launch the app (Tauri dev, or Vite dev server with a seeded token as used previously). Open the settings modal via the gear icon and verify:
  1. Changing **font size** updates open terminals live.
  2. Toggling **cursor blink** / **scrollback** applies.
  3. Disabling **prompt detection** stops the permission modal from appearing; the A sub-settings grey out.
  4. Disabling **detect freeform** suppresses freeform modals while select/confirm still work.
  5. Enabling **notifications** requests permission; a background-tab prompt fires a desktop notification (and sound if enabled).
  6. **Confirm before closing a tab** shows a confirm dialog on ✕.
  7. Toggling **port detection** / **cwd tracking** off stops the respective updates.
  8. **Reset** returns everything to defaults; settings persist across reload.

- [ ] **Step 4: Final commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "test: settings panel full-suite + manual validation pass"
```

---

## Self-Review

**Spec coverage:**
- settingsStore with all 13 settings + defaults = current behavior → Task 1. ✓
- A: promptDetectionEnabled (Task 4 scanLines + Task 6 TerminalView), detectFreeform (Task 4), focusTabOnAnswer (Task 7), promptScanDebounceMs (Task 6). ✓
- B: fontSize/cursorBlink/scrollback at creation + live apply → Task 5. ✓
- C: notification helper (Task 2) wired in scanLines (Task 4); permission request in modal (Task 9). ✓
- D: confirmTabClose (Task 10), portDetection + cwdTracking (Task 6). ✓
- enqueue returns boolean for "new prompt" notification → Task 3. ✓
- Modal with sections + Toggle/NumberField + visual deps + reset (Task 9); gear open + mount (Task 10). ✓
- Tests: store, notifications, scanLines-with-settings, UI controls → Tasks 1,2,4,8. ✓

**Placeholder scan:** No TBD/TODO; every code step contains full code. ✓

**Type consistency:** `Settings`/`DEFAULT_SETTINGS`/`useSettingsStore.set`/`reset` consistent across Tasks 1,4,5,6,7,9,10. `enqueue(): boolean` defined Task 3, consumed Task 4. `useUiStore.openSettings/closeSettings/settingsOpen` consistent Tasks 9,10. `Toggle`/`NumberField` props consistent Tasks 8,9. `notifyPrompt(isActiveTab, prompt)` defined Task 2, called Task 4. ✓

**Note:** Task 10 Step 3 adds `import { useSettingsStore }` to Sidebar.tsx — Sidebar does not import it in any earlier task, so this is its first import there (no duplicate).
