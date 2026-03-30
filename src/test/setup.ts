// Provide an in-memory localStorage so Zustand persist middleware works in jsdom
const _localStorageStore: Record<string, string> = {};
Object.defineProperty(window, "localStorage", {
  value: {
    getItem: (key: string) => _localStorageStore[key] ?? null,
    setItem: (key: string, value: string) => { _localStorageStore[key] = value; },
    removeItem: (key: string) => { delete _localStorageStore[key]; },
    clear: () => { Object.keys(_localStorageStore).forEach((k) => delete _localStorageStore[k]); },
  },
  writable: true,
});

// Mock Tauri APIs — they don't exist in jsdom
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

// Mock xterm — it requires a real DOM canvas
vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    loadAddon: vi.fn(),
    onData: vi.fn(),
    onKey: vi.fn(),
    attachCustomKeyEventHandler: vi.fn(),
    writeln: vi.fn(),
    dispose: vi.fn(),
    cols: 80,
    rows: 24,
    focus: vi.fn(),
  })),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({ fit: vi.fn(), dispose: vi.fn() })),
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: vi.fn().mockImplementation(() => ({ findNext: vi.fn(), findPrevious: vi.fn() })),
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({})),
}));
