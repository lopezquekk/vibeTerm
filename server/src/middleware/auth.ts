import type { Request, Response, NextFunction, RequestHandler } from "express";

export function createAuthMiddleware(getToken: () => string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = req.headers.authorization ?? "";
    if (auth === `Bearer ${getToken()}`) { next(); return; }
    res.status(401).json({ error: "Unauthorized" });
  };
}
