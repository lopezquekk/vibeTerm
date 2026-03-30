import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node-pty", () => {
  const spawn = vi.fn();
  return { default: { spawn }, spawn };
});

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    default: {
      ...(actual as any).default,
      accessSync: vi.fn(),
      statSync: vi.fn().mockReturnValue({ isDirectory: () => true }),
      constants: actual.constants,
    },
    accessSync: vi.fn(),
    statSync: vi.fn().mockReturnValue({ isDirectory: () => true }),
  };
});

import * as nodePty from "node-pty";
import {
  createSession,
  attachSession,
  detachSession,
  killSession,
} from "../pty-manager";
import type WebSocket from "ws";

function makeMockPty() {
  const onDataCallbacks: Array<(data: string) => void> = [];
  const mockPty = {
    onData: vi.fn((cb: (data: string) => void) => {
      onDataCallbacks.push(cb);
      return { dispose: vi.fn() };
    }),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    _triggerData: (d: string) => onDataCallbacks.forEach((cb) => cb(d)),
  };
  return mockPty;
}

function makeMockWs(): WebSocket {
  return {
    send: vi.fn(),
    readyState: 1, // OPEN
    close: vi.fn(),
  } as unknown as WebSocket;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createSession", () => {
  it("spawns a PTY and sends pty-ready to the WebSocket", () => {
    const mockPty = makeMockPty();
    vi.mocked(nodePty.spawn).mockReturnValue(mockPty as any);

    const ws = makeMockWs();
    createSession("sess-1", "~", 80, 24, ws);

    expect(nodePty.spawn).toHaveBeenCalledOnce();
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: "pty-ready" }));
  });

  it("forwards PTY data to the WebSocket while it is OPEN", () => {
    const mockPty = makeMockPty();
    vi.mocked(nodePty.spawn).mockReturnValue(mockPty as any);

    const ws = makeMockWs();
    createSession("sess-2", "~", 80, 24, ws);

    // Simulate PTY emitting data
    mockPty._triggerData("hello");

    // First call is pty-ready, second call is the data
    expect(ws.send).toHaveBeenCalledTimes(2);
    expect(ws.send).toHaveBeenLastCalledWith("hello");
  });
});

describe("detachSession + TTL", () => {
  it("kills the PTY after 30 s with no WebSocket attached", () => {
    const mockPty = makeMockPty();
    vi.mocked(nodePty.spawn).mockReturnValue(mockPty as any);

    const ws = makeMockWs();
    createSession("sess-ttl", "~", 80, 24, ws);

    detachSession("sess-ttl");

    // PTY should not be killed yet
    expect(mockPty.kill).not.toHaveBeenCalled();

    // Advance past the 30 s TTL
    vi.advanceTimersByTime(30_001);

    expect(mockPty.kill).toHaveBeenCalledOnce();
  });
});

describe("attachSession", () => {
  it("returns false for a non-existent session", () => {
    const ws = makeMockWs();
    const result = attachSession("does-not-exist", ws);
    expect(result).toBe(false);
  });

  it("cancels the TTL timer and reattaches before timeout fires", () => {
    const mockPty = makeMockPty();
    vi.mocked(nodePty.spawn).mockReturnValue(mockPty as any);

    const ws1 = makeMockWs();
    createSession("sess-reattach", "~", 80, 24, ws1);

    detachSession("sess-reattach");

    // Advance time but stay within TTL window
    vi.advanceTimersByTime(15_000);

    const ws2 = makeMockWs();
    const result = attachSession("sess-reattach", ws2);

    expect(result).toBe(true);
    // pty-ready should be sent to the new ws
    expect(ws2.send).toHaveBeenCalledWith(JSON.stringify({ type: "pty-ready" }));

    // Advance past the original TTL — PTY should NOT be killed
    vi.advanceTimersByTime(30_001);
    expect(mockPty.kill).not.toHaveBeenCalled();
  });

  it("returns true and sends pty-ready when reattaching to an existing session", () => {
    const mockPty = makeMockPty();
    vi.mocked(nodePty.spawn).mockReturnValue(mockPty as any);

    const ws1 = makeMockWs();
    createSession("sess-attach-ok", "~", 80, 24, ws1);

    const ws2 = makeMockWs();
    const result = attachSession("sess-attach-ok", ws2);

    expect(result).toBe(true);
    expect(ws2.send).toHaveBeenCalledWith(JSON.stringify({ type: "pty-ready" }));
  });
});

describe("killSession", () => {
  it("kills the PTY immediately and clears state", () => {
    const mockPty = makeMockPty();
    vi.mocked(nodePty.spawn).mockReturnValue(mockPty as any);

    const ws = makeMockWs();
    createSession("sess-kill", "~", 80, 24, ws);
    killSession("sess-kill");

    expect(mockPty.kill).toHaveBeenCalledOnce();

    // Further attach should return false — session is gone
    const ws2 = makeMockWs();
    expect(attachSession("sess-kill", ws2)).toBe(false);
  });
});
