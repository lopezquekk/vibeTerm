import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRateLimiter } from "../middleware/rate-limit";
import type { Request, Response, NextFunction } from "express";

function makeReq(ip = "1.2.3.4"): Request {
  return { ip, socket: { remoteAddress: ip } } as any;
}

function makeRes(statusCode = 200): Response {
  const res: any = { statusCode };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res._body = body;
    return res;
  });
  return res as Response;
}

// Helper: run the middleware then simulate the handler responding with a 401
function simulateFailedLogin(
  mw: ReturnType<typeof createRateLimiter>,
  ip = "1.2.3.4"
): { res: Response; next: ReturnType<typeof vi.fn> } {
  const req = makeReq(ip);
  const res = makeRes();
  const next = vi.fn();
  mw(req, res, next as any);
  // Simulate a downstream handler setting status 401 and calling res.json
  res.status(401);
  (res as any).json({ error: "Unauthorized" });
  return { res, next };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createRateLimiter", () => {
  it("lets requests through when under the failure limit", () => {
    const mw = createRateLimiter(5, 60_000, 60_000);
    const next = vi.fn();

    // 4 failed attempts — still under the limit of 5
    for (let i = 0; i < 4; i++) {
      simulateFailedLogin(mw);
    }

    // 5th request should still reach next()
    const req = makeReq();
    const res = makeRes();
    mw(req, res, next as any);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(429);
  });

  it("blocks subsequent requests after 5 failed login attempts", () => {
    const mw = createRateLimiter(5, 60_000, 60_000);

    // Exhaust 5 failed attempts
    for (let i = 0; i < 5; i++) {
      simulateFailedLogin(mw);
    }

    // Next request should be blocked with 429
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    mw(req, res, next as any);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows requests again after the block window expires", () => {
    const mw = createRateLimiter(5, 60_000, 60_000);

    // Trigger the block
    for (let i = 0; i < 5; i++) {
      simulateFailedLogin(mw);
    }

    // Advance past the 60 s block window
    vi.advanceTimersByTime(60_001);

    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    mw(req, res, next as any);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(429);
  });

  it("tracks different IPs independently", () => {
    const mw = createRateLimiter(5, 60_000, 60_000);

    // Exhaust failures for IP A
    for (let i = 0; i < 5; i++) {
      simulateFailedLogin(mw, "10.0.0.1");
    }

    // IP B should be unaffected and still reach next()
    const req = makeReq("10.0.0.2");
    const res = makeRes();
    const next = vi.fn();
    mw(req, res, next as any);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(429);

    // IP A should be blocked
    const reqA = makeReq("10.0.0.1");
    const resA = makeRes();
    const nextA = vi.fn();
    mw(reqA, resA, nextA as any);

    expect(resA.status).toHaveBeenCalledWith(429);
    expect(nextA).not.toHaveBeenCalled();
  });

  it("uses configurable maxAttempts threshold", () => {
    const mw = createRateLimiter(3, 60_000, 60_000);

    // 3 failures should trigger the block (threshold = 3)
    for (let i = 0; i < 3; i++) {
      simulateFailedLogin(mw);
    }

    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    mw(req, res, next as any);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });

  it("resets the failure window after windowMs elapses without a block", () => {
    const mw = createRateLimiter(5, 60_000, 60_000);

    // 4 failures — not yet blocked
    for (let i = 0; i < 4; i++) {
      simulateFailedLogin(mw);
    }

    // Advance past the rolling window so the counter resets
    vi.advanceTimersByTime(60_001);

    // 4 more failures — should still not be blocked (counter reset)
    for (let i = 0; i < 4; i++) {
      simulateFailedLogin(mw);
    }

    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    mw(req, res, next as any);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(429);
  });
});
