import { useEffect, useRef } from "react";

/** Calls `onResize` when the visual viewport changes (e.g. iOS keyboard opens). No-op if unsupported. */
export function useVisualViewport(onResize: () => void): void {
  const cb = useRef(onResize);
  cb.current = onResize;
  useEffect(() => {
    const vv = (window as any).visualViewport as VisualViewport | undefined;
    if (!vv) return;
    const handler = () => cb.current();
    vv.addEventListener("resize", handler);
    vv.addEventListener("scroll", handler);
    return () => { vv.removeEventListener("resize", handler); vv.removeEventListener("scroll", handler); };
  }, []);
}
