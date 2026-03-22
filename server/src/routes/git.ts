import { Router } from "express";
import * as git from "../git-handler";
import { isPathAllowed } from "../git-handler";

export function createGitRouter(getAllowedPaths: () => string[]) {
  const router = Router();

  // Validate path on every request
  router.use((req, res, next) => {
    const p = (req.query.path ?? req.body?.path) as string | undefined;
    if (!p || !isPathAllowed(p, getAllowedPaths())) {
      res.status(403).json({ error: "Path not allowed" }); return;
    }
    next();
  });

  const qp = (req: any, k: string) => req.query[k] as string;
  const bp = (req: any, k: string) => req.body?.[k] as string;

  router.get("/status",           (req, res) => res.json(git.getGitStatus(qp(req, "path"))));
  router.get("/changed-files",    (req, res) => res.json(git.getChangedFiles(qp(req, "path"))));
  router.get("/file-diff",        (req, res) => res.json(git.getFileDiff(qp(req, "path"), qp(req, "file"))));
  router.get("/staged-file-diff", (req, res) => res.json(git.getStagedFileDiff(qp(req, "path"), qp(req, "file"))));
  router.get("/image-diff",       (req, res) => res.json(git.getImageDiff(qp(req, "path"), qp(req, "file"))));
  router.get("/workdir-status",   (req, res) => res.json(git.getWorkdirStatus(qp(req, "path"))));
  router.get("/log",              (req, res) => res.json(git.getGitLog(qp(req, "path"))));
  router.get("/commit-files",     (req, res) => res.json(git.getCommitFiles(qp(req, "path"), qp(req, "hash"))));
  router.get("/commit-file-diff", (req, res) => res.json(git.getCommitFileDiff(qp(req, "path"), qp(req, "hash"), qp(req, "file"))));
  router.get("/commit-image-diff",(req, res) => res.json(git.getCommitImageDiff(qp(req, "path"), qp(req, "hash"), qp(req, "file"))));
  router.get("/branches",         (req, res) => res.json(git.getBranches(qp(req, "path"))));
  router.get("/worktree-main",    (req, res) => res.json({ main: git.getWorktreeMain(qp(req, "path")) }));

  router.post("/stage",         (req, res) => { git.stageFile(bp(req,"path"), bp(req,"file")); res.json({ ok: true }); });
  router.post("/unstage",       (req, res) => { git.unstageFile(bp(req,"path"), bp(req,"file")); res.json({ ok: true }); });
  router.post("/discard",       (req, res) => { git.discardFile(bp(req,"path"), bp(req,"file")); res.json({ ok: true }); });
  router.post("/stage-all",     (req, res) => { git.stageAll(bp(req,"path")); res.json({ ok: true }); });
  router.post("/commit",        (req, res) => { git.gitCommit(bp(req,"path"), bp(req,"message")); res.json({ ok: true }); });
  router.post("/switch-branch", (req, res) => { git.switchBranch(bp(req,"path"), bp(req,"branch")); res.json({ ok: true }); });
  router.post("/create-branch", (req, res) => { git.createBranch(bp(req,"path"), bp(req,"branch")); res.json({ ok: true }); });

  return router;
}
