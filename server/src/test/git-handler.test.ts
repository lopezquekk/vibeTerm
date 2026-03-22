import { describe, it, expect } from "vitest";
import { isPathAllowed, truncateOutput } from "../git-handler";

describe("isPathAllowed", () => {
  it("allows exact match", () => {
    expect(isPathAllowed("/home/cam/repo", ["/home/cam/repo"])).toBe(true);
  });
  it("allows subpath", () => {
    expect(isPathAllowed("/home/cam/repo/sub", ["/home/cam/repo"])).toBe(true);
  });
  it("rejects unrelated path", () => {
    expect(isPathAllowed("/etc/passwd", ["/home/cam/repo"])).toBe(false);
  });
  it("rejects path traversal", () => {
    expect(isPathAllowed("/home/cam/repo/../secret", ["/home/cam/repo"])).toBe(false);
  });
});

describe("truncateOutput", () => {
  it("passes short output unchanged", () => {
    const r = truncateOutput("hello");
    expect(r).toEqual({ content: "hello", truncated: false });
  });
  it("truncates at 1MB", () => {
    const r = truncateOutput("x".repeat(1_100_000));
    expect(r.truncated).toBe(true);
    expect(r.content.length).toBeLessThanOrEqual(1_048_576);
  });
});
