import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Props {
  tabId: string;
  path: string;
}

export default function TerminalView({ tabId, path }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const unlisten = useRef<(() => void) | null>(null);

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

    // Send input to PTY
    term.onData((data) => {
      invoke("write_input", { tabId, data }).catch(console.error);
    });

    // Resize PTY on terminal resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      invoke("resize_session", {
        tabId,
        cols: term.cols,
        rows: term.rows,
      }).catch(console.error);
    });
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      unlisten.current?.();
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
