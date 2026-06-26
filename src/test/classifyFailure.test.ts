import { describe, it, expect } from "vitest";
import { classifyProbe } from "../transport/classifyFailure";

describe("classifyProbe", () => {
  it("maps 401 to auth-failed", () => expect(classifyProbe(401)).toBe("auth-failed"));
  it("maps 429 to rate-limited", () => expect(classifyProbe(429)).toBe("rate-limited"));
  it("maps 200 to reconnecting (server reachable)", () => expect(classifyProbe(200)).toBe("reconnecting"));
  it("maps network error to offline", () => expect(classifyProbe("network-error")).toBe("offline"));
  it("maps 500 to offline", () => expect(classifyProbe(500)).toBe("offline"));
});
