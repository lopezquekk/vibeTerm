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
