import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTabStore } from "../store/tabStore";

interface Props {
  tabId: string;
  path: string;
}

export default function TerminalView({ tabId, path }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const unlisten = useRef<(() => void) | null>(null);
  const unlistenCwd = useRef<(() => void) | null>(null);
  const unlistenFocus = useRef<(() => void) | null>(null);
  const rafRef = useRef<number | null>(null);
  const updateTab = useTabStore((s) => s.updateTab);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
        background: "#0f0f0f",
        foreground: "#e5e5e5",
        cursor: "#e5e5e5",
        selectionBackground: "#3b82f640",
        black: "#1a1a1a",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e5e5e5",
        brightBlack: "#404040",
        brightRed: "#ff8080",
        brightGreen: "#86efac",
        brightYellow: "#fde68a",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#ffffff",
      },
      fontFamily: "JetBrains Mono, Fira Code, Cascadia Code, monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    // Fit inside a rAF so the layout is fully calculated before measuring.
    // Skips the call if the container has no visible area (display:none).
    const scheduleFit = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const el = containerRef.current;
        if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return;
        try { fitAddon.fit(); } catch { /* ignore if terminal disposed */ }
        invoke("resize_session", {
          tabId,
          cols: term.cols,
          rows: term.rows,
        }).catch(console.error);
      });
    };

    // Start PTY session
    invoke("create_session", {
      tabId,
      cwd: path,
      cols: term.cols,
      rows: term.rows,
    }).catch(console.error);

    // Listen for PTY output
    listen(`pty-output-${tabId}`, (e) => {
      term.write(e.payload as string);
    }).then((fn) => {
      unlisten.current = fn;
    });

    // Listen for CWD changes (OSC 7) and update the store
    listen(`cwd-changed-${tabId}`, (e) => {
      const newPath = e.payload as string;
      updateTab(tabId, { path: newPath });
      invoke<import("../store/tabStore").GitStatus>("get_git_status", { path: newPath })
        .then((git) => updateTab(tabId, { git }))
        .catch(() => updateTab(tabId, { git: null }));
    }).then((fn) => {
      unlistenCwd.current = fn;
    });

    // Re-fit when the app window regains focus (covers the "came back from
    // another app and terminal is squished" case on macOS/Tauri).
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) scheduleFit();
      })
      .then((fn) => {
        unlistenFocus.current = fn;
      });

    // Send input to PTY
    term.onData((data) => {
      invoke("write_input", { tabId, data }).catch(console.error);
    });

    // Re-fit when the container's dimensions change (tab switch, sidebar
    // resize, window resize, etc.)
    const resizeObserver = new ResizeObserver(scheduleFit);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      unlisten.current?.();
      unlistenCwd.current?.();
      unlistenFocus.current?.();
      resizeObserver.disconnect();
      invoke("kill_session", { tabId }).catch(console.error);
      term.dispose();
    };
  }, [tabId]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-surface"
      style={{ padding: "4px" }}
    />
  );
}
