export type ConnStatus =
  | "connecting" | "connected" | "reconnecting"
  | "auth-failed" | "rate-limited" | "offline";

/** Classify the result of an HTTP auth probe done after a WS failure.
 *  Browsers hide a WS handshake's HTTP status, so we probe /api/ping to learn why. */
export function classifyProbe(status: number | "network-error"): ConnStatus {
  if (status === "network-error") return "offline";
  if (status === 401) return "auth-failed";
  if (status === 429) return "rate-limited";
  if (status >= 200 && status < 500) return "reconnecting";
  return "offline";
}
