/* Agent credentials are random bearer keys; only their SHA-256 hash is stored. */

export const TOKEN_PREFIX = "mna_";
const TOKEN_PATTERN = /^mna_[A-Za-z0-9_-]{43}$/;
export const MAX_CONNECTIONS_PER_USER = 20;
export const MAX_CONNECTION_NAME = 60;
export const RATE_WINDOW_MS = 60_000;
export const RATE_LIMIT_PER_WINDOW = 120;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateToken(): string {
  return TOKEN_PREFIX + base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function isWellFormedToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/* A short, non-secret label so people can tell keys apart. */
export function tokenLabel(token: string): string {
  return `${token.slice(0, 8)}…`;
}

export function cleanConnectionName(name: string): string | null {
  const trimmed = name.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length > MAX_CONNECTION_NAME) return null;
  return trimmed;
}

export const PAIRING_CODE_PREFIX = "mnp_";
const PAIRING_CODE_PATTERN = /^mnp_[A-Za-z0-9_-]{27}$/;
export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const MAX_PENDING_PAIRINGS = 5;
export const MAX_PAIRINGS_PER_HOUR = 30;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/* A pairing code carries 160 random bits; only its hash is stored. */
export function generatePairingCode(): string {
  return PAIRING_CODE_PREFIX + base64Url(crypto.getRandomValues(new Uint8Array(20)));
}

export function isWellFormedPairingCode(code: string): boolean {
  return PAIRING_CODE_PATTERN.test(code);
}

/*
 * The Monotes address an agent should use, accepted only in canonical form:
 * HTTPS, or HTTP on a loopback host for local development; no credentials,
 * path, query or fragment. The result is written into the agent's access
 * file, so anything else is refused.
 */
export function cleanSiteOrigin(origin: string): string | null {
  if (origin.length > 200) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  const secure = url.protocol === "https:";
  const localDev = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (!secure && !localDev) return null;
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
  if (!/^(\[::1\]|[a-z0-9.-]+)$/.test(url.hostname)) return null;
  return url.origin === origin ? url.origin : null;
}

/*
 * The agent's access file name: unique per site and connection, built only
 * from safe characters so it can be used in shell commands as is.
 */
export function credentialFileName(siteOrigin: string, connectionId: string): string {
  const url = new URL(siteOrigin);
  // Start and end with a letter or digit, with no "..", so the name matches
  // what the skill accepts ([a-z0-9][a-z0-9.-]*.env); "[::1]" becomes "1".
  const site = `${url.hostname}${url.port ? `-${url.port}` : ""}`
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "") || "site";
  const id = connectionId.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${site}-${id}.env`;
}

/* The access file the agent saves. Every value is from a validated character set. */
export function credentialFileContents(options: {
  siteOrigin: string;
  token: string;
  fileName: string;
  noteId: string;
}): string {
  return [
    "# Monotes agent access. Private: keep this file to yourself and never print it.",
    "# Send the key only to MONOTES_URL. MONOTES_FIRST_NOTE_URL is the note this",
    "# connection was set up with, to check access; the person can share more notes later.",
    `MONOTES_URL=${options.siteOrigin}`,
    `MONOTES_AGENT_KEY=${options.token}`,
    `MONOTES_CREDENTIAL_FILE=${options.fileName}`,
    `MONOTES_FIRST_NOTE_URL=${options.siteOrigin}/${options.noteId}`,
    "",
  ].join("\n");
}

