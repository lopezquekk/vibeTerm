// src/transport/factory.ts
import { TauriTransport } from "./tauri";
import { WebSocketTransport } from "./websocket";
import { initToken } from "./token";
import type { Transport } from "./types";

const isTauri = typeof (window as any).__TAURI_INTERNALS__ !== "undefined";

let _hasToken = true;

function createTransport(): Transport {
  if (isTauri) return new TauriTransport();
  const token = initToken();
  _hasToken = token !== null;
  if (!token) console.warn("VibeTerm: no auth token — scan the QR code to connect.");
  return new WebSocketTransport(token ?? "");
}

export const transport: Transport = createTransport();
/** false when running in browser with no token (user needs to scan QR) */
export const hasToken = () => _hasToken;
