import { describe, it, expect } from "vitest";
import { parseOsc7Cwd, parseDevServerUrl } from "../transport/parsePtyOutput";

describe("parseOsc7Cwd", () => {
  it("extracts the path from an OSC 7 file URL", () => {
    const seq = "\x1b]7;file://host/Users/me/proj\x1b\\";
    expect(parseOsc7Cwd(seq)).toBe("/Users/me/proj");
  });
  it("returns null when absent", () => expect(parseOsc7Cwd("hello")).toBeNull());
});

describe("parseDevServerUrl", () => {
  it("finds a localhost dev URL", () => {
    expect(parseDevServerUrl("Local:  http://localhost:5173/")).toBe("http://localhost:5173");
  });
  it("normalizes 127.0.0.1 to localhost", () => {
    expect(parseDevServerUrl("http://127.0.0.1:3000")).toBe("http://localhost:3000");
  });
  it("returns null when absent", () => expect(parseDevServerUrl("no url here")).toBeNull());
});
