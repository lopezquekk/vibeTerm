import { describe, it, expect, vi } from "vitest";
import { createAuthMiddleware } from "../middleware/auth";
import type { Request, Response, NextFunction } from "express";

const makeReq = (auth?: string): Request =>
  ({ headers: { authorization: auth } } as any);
const makeRes = () =>
  ({ status: vi.fn().mockReturnThis(), json: vi.fn() } as any as Response);

describe("createAuthMiddleware", () => {
  const mw = createAuthMiddleware(() => "secret123");

  it("passes with valid Bearer token", () => {
    const next = vi.fn() as NextFunction;
    mw(makeReq("Bearer secret123"), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 401 with wrong token", () => {
    const res = makeRes();
    mw(makeReq("Bearer wrong"), res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 401 with no auth header", () => {
    const res = makeRes();
    mw(makeReq(), res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
