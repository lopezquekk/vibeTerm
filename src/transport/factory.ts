// src/transport/factory.ts
import { TauriTransport } from "./tauri";
import type { Transport } from "./types";

// WebSocketTransport added in Task 12
export const transport: Transport = new TauriTransport();
