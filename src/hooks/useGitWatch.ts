// src/hooks/useGitWatch.ts
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { transport } from "../transport/factory";

const IS_TAURI = typeof (window as any).__TAURI_INTERNALS__ !== "undefined";
const FALLBACK_POLL_MS = 30_000;

/**
 * Watches for git changes in `cwd` and calls `onChanged` when detected.
 *
 * In Tauri mode: registers a Rust fs.watch on `.git/`, falls back to
 * 30-second polling if the watcher fails to initialize.
 *
 * In WebSocket mode: 30-second polling that pauses when the window is hidden.
 */
export function useGitWatch(
  tabId: string,
  cwd: string | null,
  onChanged: () => void
): void {
  // Keep a ref so the interval/listener always calls the latest version
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useEffect(() => {
    if (!cwd) return;

    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let unlistenChanged: (() => void) | null = null;
    let unlistenFailed: (() => void) | null = null;
    let destroyed = false;

    const startPolling = () => {
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(() => {
        if (!destroyed && document.visibilityState !== "hidden") {
          onChangedRef.current();
        }
      }, FALLBACK_POLL_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !destroyed) {
        onChangedRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    if (IS_TAURI) {
      // Primary: Tauri fs.watch + 30s heartbeat
      transport.watchGitDir(tabId, cwd).catch(() => {/* watcher failed — Rust emits git-watch-failed */});

      listen<string>("git-changed", () => {
        if (!destroyed) onChangedRef.current();
      }).then((fn) => { unlistenChanged = fn; });

      listen<string>("git-watch-failed", () => {
        if (!destroyed) startPolling();
      }).then((fn) => { unlistenFailed = fn; });

      // Heartbeat: catches edge cases where fs events are missed
      startPolling();
    } else {
      // WebSocket mode: polling only
      startPolling();
    }

    return () => {
      destroyed = true;
      if (pollInterval) clearInterval(pollInterval);
      unlistenChanged?.();
      unlistenFailed?.();
      document.removeEventListener("visibilitychange", onVisibility);
      if (IS_TAURI) transport.unwatchGitDir(tabId).catch(() => {});
    };
  }, [tabId, cwd]);
}
