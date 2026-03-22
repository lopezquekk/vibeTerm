import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { transport } from "../transport/factory";
import { useTabStore } from "../store/tabStore";

interface Props {
  tabId: string;
  path: string;
}

const SEARCH_OPTIONS = { caseSensitive: false, incremental: true };

const IS_TAURI = typeof (window as any).__TAURI_INTERNALS__ !== "undefined";

// Common control sequences for the mobile toolbar
const CTRL_KEYS = [
  { label: "Ctrl+C", seq: "\x03", title: "Interrupt" },
  { label: "Ctrl+D", seq: "\x04", title: "EOF / exit" },
  { label: "Ctrl+Z", seq: "\x1a", title: "Suspend" },
  { label: "Ctrl+L", seq: "\x0c", title: "Clear screen" },
  { label: "Tab",    seq: "\x09", title: "Autocomplete" },
  { label: "Ctrl+A", seq: "\x01", title: "Start of line" },
  { label: "Ctrl+E", seq: "\x05", title: "End of line" },
  { label: "Ctrl+U", seq: "\x15", title: "Clear line" },
  { label: "Ctrl+W", seq: "\x17", title: "Delete word" },
  { label: "↑",      seq: "\x1b[A", title: "Previous command" },
  { label: "↓",      seq: "\x1b[B", title: "Next command" },
  { label: "Esc",    seq: "\x1b",   title: "Escape" },
];

export default function TerminalView({ tabId, path }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const unlisten = useRef<(() => void) | null>(null);
  const unlistenCwd = useRef<(() => void) | null>(null);
  const unlistenPort = useRef<(() => void) | null>(null);
  const unlistenFocus = useRef<(() => void) | null>(null);
  const rafRef = useRef<number | null>(null);
  const searchOpenRef = useRef(false);
  const updateTab = useTabStore((s) => s.updateTab);
  const activeTabIdRef = useRef(useTabStore.getState().activeTabId);
  useEffect(() => {
    return useTabStore.subscribe((s) => { activeTabIdRef.current = s.activeTabId; });
  }, []);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Focus the input after React has committed the render — reliable regardless
  // of where setSearchOpen(true) was called from (xterm handler, window handler, etc.)
  useEffect(() => {
    if (searchOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [searchOpen]);

  // Run search whenever the query changes while the bar is open
  useEffect(() => {
    if (!searchOpen || !searchRef.current) return;
    if (searchQuery) {
      searchRef.current.findNext(searchQuery, SEARCH_OPTIONS);
    }
  }, [searchQuery, searchOpen]);

  // Window-level ⌘F fallback: fires when the terminal element is visible but
  // doesn't have keyboard focus (e.g. user clicked outside the terminal).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey || e.key !== "f") return;
      const el = containerRef.current;
      if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return;
      e.preventDefault();
      searchOpenRef.current = true;
      setSearchOpen(true);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;
    searchRef.current = searchAddon;

    // Intercept ⌘F to open search bar, Escape to close it
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if (e.metaKey && e.key === "f") {
        searchOpenRef.current = true;
        setSearchOpen(true);
        return false; // don't pass ⌘F to the shell
      }
      if (e.key === "Escape" && searchOpenRef.current) {
        searchOpenRef.current = false;
        setSearchOpen(false);
        setSearchQuery("");
        term.focus();
        return false;
      }
      return true;
    });

    // Fit inside a rAF so the layout is fully calculated before measuring.
    const scheduleFit = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const el = containerRef.current;
        if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return;
        try { fitAddon.fit(); } catch { /* ignore if terminal disposed */ }
        transport.ptyResize(tabId, term.cols, term.rows);
      });
    };

    // Start PTY session — ensure non-zero cols/rows even if fit hasn't measured yet
    const initCols = Math.max(term.cols, 80);
    const initRows = Math.max(term.rows, 24);
    transport.ptyCreate(tabId, path, initCols, initRows).catch((err) => {
      term.writeln(`\r\n\x1b[31mConnection error: ${err?.message ?? err}\x1b[0m`);
      console.error(err);
    });

    // Detect if this path is inside a linked worktree
    const refreshWorktree = (p: string) => {
      transport.getWorktreeMain(p)
        .then((main) => updateTab(tabId, { worktreeOf: main ?? null }))
        .catch(() => {});
    };
    refreshWorktree(path);

    // Listen for PTY output
    unlisten.current = transport.onPtyData(tabId, (data) => {
      term.write(data);
      if (activeTabIdRef.current !== tabId) {
        updateTab(tabId, { hasActivity: true });
      }
    });

    // Listen for local server detection and store the URL
    unlistenPort.current = transport.onPortDetected(tabId, (port) => {
      updateTab(tabId, { detectedPort: port });
    });

    // Listen for CWD changes (OSC 7) and update the store
    unlistenCwd.current = transport.onCwdChanged(tabId, (newPath) => {
      updateTab(tabId, { path: newPath });
      transport.getGitStatus(newPath)
        .then((git) => updateTab(tabId, { git }))
        .catch(() => updateTab(tabId, { git: null }));
      refreshWorktree(newPath);
    });

    // Re-fit when the app window regains focus
    const isTauri = typeof (window as any).__TAURI_INTERNALS__ !== "undefined";
    if (isTauri) {
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
        getCurrentWindow()
          .onFocusChanged(({ payload: focused }) => {
            if (focused) scheduleFit();
          })
          .then((fn) => { unlistenFocus.current = fn; });
      });
    }

    // Send input to PTY
    term.onData((data) => {
      transport.ptyWrite(tabId, data);
    });

    // Re-fit when the container's dimensions change
    const resizeObserver = new ResizeObserver(scheduleFit);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      unlisten.current?.();
      unlistenCwd.current?.();
      unlistenPort.current?.();
      unlistenFocus.current?.();
      resizeObserver.disconnect();
      transport.ptyClose(tabId).catch(console.error);
      term.dispose();
    };
  }, [tabId]);

  const findNext = () => {
    if (!searchRef.current || !searchQuery) return;
    searchRef.current.findNext(searchQuery, SEARCH_OPTIONS);
  };

  const findPrev = () => {
    if (!searchRef.current || !searchQuery) return;
    searchRef.current.findPrevious(searchQuery, SEARCH_OPTIONS);
  };

  const closeSearch = () => {
    searchOpenRef.current = false;
    setSearchOpen(false);
    setSearchQuery("");
    termRef.current?.focus();
  };

  const sendKey = (seq: string) => {
    transport.ptyWrite(tabId, seq);
    termRef.current?.focus();
  };

  return (
    <div className="h-full w-full bg-surface p-1 relative flex flex-col">
      {/* Search bar — floats over the terminal at the top-right */}
      {searchOpen && (
        <div className="absolute top-2 right-3 z-10 flex items-center gap-1 bg-zinc-900 border border-border rounded-md shadow-xl px-2 py-1">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.shiftKey ? findPrev() : findNext();
              if (e.key === "Escape") closeSearch();
            }}
            placeholder="Search…"
            className="w-44 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none font-mono"
            spellCheck={false}
          />
          <button
            onClick={findPrev}
            title="Previous match (⇧↵)"
            className="w-5 h-5 flex items-center justify-center text-zinc-400 hover:text-zinc-100 transition-colors text-[11px]"
          >
            ↑
          </button>
          <button
            onClick={findNext}
            title="Next match (↵)"
            className="w-5 h-5 flex items-center justify-center text-zinc-400 hover:text-zinc-100 transition-colors text-[11px]"
          >
            ↓
          </button>
          <button
            onClick={closeSearch}
            title="Close (Esc)"
            className="w-5 h-5 flex items-center justify-center text-zinc-600 hover:text-zinc-300 transition-colors text-[10px] ml-0.5"
          >
            ✕
          </button>
        </div>
      )}

      {/* Mobile control bar — shown only in browser (remote access) */}
      {!IS_TAURI && (
        <div className="flex-shrink-0 flex items-center gap-1 overflow-x-auto py-1 px-0.5 border-b border-border scrollbar-none">
          {CTRL_KEYS.map(({ label, seq, title }) => (
            <button
              key={label}
              title={title}
              onPointerDown={(e) => { e.preventDefault(); sendKey(seq); }}
              className="flex-shrink-0 px-2.5 py-1 text-[11px] font-mono text-zinc-300 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 rounded border border-zinc-700 select-none touch-manipulation"
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* xterm.js measures this inner div — keeping it padding-free ensures
          FitAddon computes the exact available columns. */}
      <div ref={containerRef} className="flex-1 min-h-0 w-full" />
    </div>
  );
}
