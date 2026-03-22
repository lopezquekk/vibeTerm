import { Router } from "express";
import path from "path";

export function createControlRouter(addPath: (p: string) => void) {
  const router = Router();
  router.post("/add-path", (req, res) => {
    const p = req.body?.path as string;
    if (!p) { res.status(400).json({ error: "Missing path" }); return; }
    addPath(path.resolve(p));
    res.json({ ok: true });
  });
  return router;
}
