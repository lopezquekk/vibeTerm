// src/transport/token.ts
export function initToken(): string | null {
  // QR scan flow: token is in URL hash fragment
  const match = window.location.hash.match(/[#&]token=([^&]+)/);
  if (match) {
    const token = decodeURIComponent(match[1]);
    sessionStorage.setItem("vibeterm_token", token);
    // Remove fragment so token is not visible in address bar or Referer headers
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return token;
  }
  // Page refresh: token already in sessionStorage
  return sessionStorage.getItem("vibeterm_token");
}
