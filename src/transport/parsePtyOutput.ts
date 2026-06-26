/** OSC 7: ESC ] 7 ; file://<host><path> ST  — return the <path>. */
export function parseOsc7Cwd(data: string): string | null {
  const m = data.match(/\x1b\]7;file:\/\/[^/]*([^\x07\x1b]+)/);
  return m ? m[1] : null;
}

/** Find a local dev-server URL and normalize the host to localhost. */
export function parseDevServerUrl(data: string): string | null {
  const m = data.match(/https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/);
  if (!m) return null;
  return `http://localhost:${m[2]}`;
}
