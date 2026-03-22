import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTabStore } from "../store/tabStore";

interface Props {
  tabId: string;
  path: string;
}

const SEARCH_DECORATIONS = {
  matchBackground: "#fbbf2430",
  matchBorder: "#fbbf2460",
  matchOverviewRuler: "#fbbf2480",
  activeMatchBackground: "#fbbf2470",
  activeMatchBorder: "#fbbf24",
  activeMatchColorOverviewRuler: "#fbbf24",
};

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

  // Run search whenever the query changes while the bar is open
  useEffect(() => {
    if (!searchOpen || !searchRef.current) return;
    if (searchQuery) {
      searchRef.current.findNext(searchQuery, { caseSensitive: false, decorations: SEARCH_DECORATIONS });
    }
  }, [searchQuery, searchOpen]);

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
      overviewRulerWidth: 15,
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
        requestAnimationFrame(() => searchInputRef.current?.focus());
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
      if (activeTabIdRef.current !== tabId) {
        updateTab(tabId, { hasActivity: true });
      }
    }).then((fn) => {
      unlisten.current = fn;
    });

    // Listen for local server detection and store the URL
    listen(`port-detected-${tabId}`, (e) => {
      updateTab(tabId, { detectedPort: e.payload as string });
    }).then((fn) => {
      unlistenPort.current = fn;
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

    // Re-fit when the app window regains focus
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
      invoke("kill_session", { tabId }).catch(console.error);
      term.dispose();
    };
  }, [tabId]);

  const findNext = () => {
    if (!searchRef.current || !searchQuery) return;
    searchRef.current.findNext(searchQuery, { caseSensitive: false, decorations: SEARCH_DECORATIONS });
  };

  const findPrev = () => {
    if (!searchRef.current || !searchQuery) return;
    searchRef.current.findPrevious(searchQuery, { caseSensitive: false, decorations: SEARCH_DECORATIONS });
  };

  const closeSearch = () => {
    searchOpenRef.current = false;
    setSearchOpen(false);
    setSearchQuery("");
    termRef.current?.focus();
  };

  return (
    <div className="h-full w-full bg-surface p-1 relative">
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

      {/* xterm.js measures this inner div — keeping it padding-free ensures
          FitAddon computes the exact available columns. */}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
