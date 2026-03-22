import type { Request, Response, NextFunction, RequestHandler } from "express";

interface IpRecord { count: number; windowStart: number; blockedUntil: number | null }

export function createRateLimiter(
  maxAttempts = 5,
  windowMs = 60_000,
  blockMs = 60_000
): RequestHandler {
  const map = new Map<string, IpRecord>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const rec = map.get(ip) ?? { count: 0, windowStart: now, blockedUntil: null };

    if (rec.blockedUntil !== null) {
      if (now < rec.blockedUntil) {
        res.status(429).json({ error: "Too many failed attempts, try again later" });
        return;
      }
      // Block expired — reset
      rec.blockedUntil = null;
      rec.count = 0;
      rec.windowStart = now;
    }

    // Intercept 401s to record failures within the rolling window
    const origJson = res.json.bind(res);
    (res as any).json = (body: unknown) => {
      if (res.statusCode === 401) {
        const r = map.get(ip) ?? { count: 0, windowStart: Date.now(), blockedUntil: null };
        const t = Date.now();
        if (t - r.windowStart > windowMs) {
          // Rolling window expired — start a fresh one
          r.count = 1;
          r.windowStart = t;
        } else {
          r.count += 1;
        }
        if (r.count >= maxAttempts) {
          r.blockedUntil = t + blockMs;
          r.count = 0;
        }
        map.set(ip, r);
      }
      return origJson(body);
    };

    next();
  };
}
