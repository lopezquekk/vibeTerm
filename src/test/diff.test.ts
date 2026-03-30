// src/test/diff.test.ts
import { describe, it, expect } from "vitest";
import { parseDiffLines, isImageFile } from "../utils/diff";

describe("isImageFile", () => {
  it("detects common image extensions", () => {
    expect(isImageFile("photo.png")).toBe(true);
    expect(isImageFile("icon.jpg")).toBe(true);
    expect(isImageFile("icon.jpeg")).toBe(true);
    expect(isImageFile("logo.svg")).toBe(true);
    expect(isImageFile("animation.gif")).toBe(true);
    expect(isImageFile("thumbnail.webp")).toBe(true);
    expect(isImageFile("cover.avif")).toBe(true);
    expect(isImageFile("favicon.ico")).toBe(true);
    expect(isImageFile("image.bmp")).toBe(true);
  });

  it("returns false for non-image files", () => {
    expect(isImageFile("README.md")).toBe(false);
    expect(isImageFile("index.ts")).toBe(false);
    expect(isImageFile("data.json")).toBe(false);
    expect(isImageFile("styles.css")).toBe(false);
    expect(isImageFile("app.tsx")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isImageFile("ICON.PNG")).toBe(true);
    expect(isImageFile("Photo.JPG")).toBe(true);
    expect(isImageFile("logo.SVG")).toBe(true);
    expect(isImageFile("ANIMATION.GIF")).toBe(true);
  });
});

describe("parseDiffLines", () => {
  const simpleDiff = `--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 const x = 1;
-const y = 2;
+const y = 3;
+const z = 4;
 export { x };`;

  it("parses added lines", () => {
    const lines = parseDiffLines(simpleDiff);
    const added = lines.filter((l) => l.type === "add");
    expect(added.length).toBeGreaterThan(0);
    expect(added.some((l) => l.content.includes("const y = 3"))).toBe(true);
    expect(added.some((l) => l.content.includes("const z = 4"))).toBe(true);
  });

  it("parses removed lines", () => {
    const lines = parseDiffLines(simpleDiff);
    const removed = lines.filter((l) => l.type === "remove");
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.some((l) => l.content.includes("const y = 2"))).toBe(true);
  });

  it("parses context lines", () => {
    const lines = parseDiffLines(simpleDiff);
    const ctx = lines.filter((l) => l.type === "context");
    expect(ctx.length).toBeGreaterThan(0);
    expect(ctx.some((l) => l.content.includes("const x = 1"))).toBe(true);
    expect(ctx.some((l) => l.content.includes("export { x }"))).toBe(true);
  });

  it("parses header lines for hunk markers", () => {
    const lines = parseDiffLines(simpleDiff);
    const headers = lines.filter((l) => l.type === "header");
    expect(headers.length).toBe(1);
    expect(headers[0].content).toContain("@@");
  });

  it("returns empty array for empty input", () => {
    expect(parseDiffLines("")).toEqual([]);
  });

  it("handles new file diff", () => {
    const newFileDiff = `--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const hello = "world";
+export default hello;`;
    const lines = parseDiffLines(newFileDiff);
    const added = lines.filter((l) => l.type === "add");
    expect(added.length).toBe(2);
  });

  it("tracks line numbers for added lines", () => {
    const lines = parseDiffLines(simpleDiff);
    const added = lines.filter((l) => l.type === "add");
    added.forEach((l) => {
      expect(l.newLine).toBeDefined();
      expect(typeof l.newLine).toBe("number");
    });
  });

  it("tracks line numbers for removed lines", () => {
    const lines = parseDiffLines(simpleDiff);
    const removed = lines.filter((l) => l.type === "remove");
    removed.forEach((l) => {
      expect(l.oldLine).toBeDefined();
      expect(typeof l.oldLine).toBe("number");
    });
  });

  it("tracks both line numbers for context lines", () => {
    const lines = parseDiffLines(simpleDiff);
    const ctx = lines.filter((l) => l.type === "context");
    ctx.forEach((l) => {
      expect(l.oldLine).toBeDefined();
      expect(l.newLine).toBeDefined();
    });
  });

  it("skips diff metadata lines (---, +++, index, diff --git)", () => {
    const lines = parseDiffLines(simpleDiff);
    const contents = lines.map((l) => l.content);
    expect(contents.every((c) => !c.startsWith("---"))).toBe(true);
    expect(contents.every((c) => !c.startsWith("+++"))).toBe(true);
  });

  it("handles deleted file diff", () => {
    const deletedFileDiff = `--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const old = true;
-export default old;`;
    const lines = parseDiffLines(deletedFileDiff);
    const removed = lines.filter((l) => l.type === "remove");
    expect(removed.length).toBe(2);
    const added = lines.filter((l) => l.type === "add");
    expect(added.length).toBe(0);
  });
});
