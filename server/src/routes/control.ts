import { Router } from "express";
import path from "path";

export interface RemoteTab { id: string; alias: string; path: string; type: string }

export function createControlRouter(
  addPath: (p: string) => void,
  getRemoteTabs: () => RemoteTab[],
) {
  const router = Router();
  router.post("/add-path", (req, res) => {
    const p = req.body?.path as string;
    if (!p) { res.status(400).json({ error: "Missing path" }); return; }
    addPath(path.resolve(p));
    res.json({ ok: true });
  });
  // The desktop pushes its full tab list to the server (via stdin); expose it so the
  // remote browser can mirror exactly the tabs the desktop has open (alias/path/type).
  router.get("/tabs", (_req, res) => {
    res.json({ tabs: getRemoteTabs() });
  });
  return router;
}
