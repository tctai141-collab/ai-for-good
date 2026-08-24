import type { APIRoute } from "astro";
import {
  createSessionRow,
  deleteSessionRow,
  touchSessionRow,
  deleteSessionsForUser,
  getSessionRow,
  purgeExpiredSessions,
} from "../db/index";

/**
 * Authentication for real cohort accounts.
 *
 * Replaces the hackathon's demo login, where the cookie was plain JSON naming
 * the user's role — anything that could set a cookie could claim to be an
 * organizer. The cookie now carries only an opaque random token that is
 * meaningless without the matching server-side row, so roles cannot be forged
 * and access can be revoked instantly by deleting the row.
 */

export type SessionUser = {
  email: string;
  name: string;
  role: "founder" | "organizer";
};

export const SESSION_COOKIE = "sb_session";

/*
 * Session lifetime: a rolling idle window plus an absolute ceiling.
 *
 * This was a single fixed 30 days from login, with no idle expiry at all — so a
 * founder who signed in on a shared university machine and walked away left a
 * working session behind for a month. That is a long time to leave other
 * people's private reflections reachable.
 *
 * Two timers is the ordinary shape for this, and it is what the numbers are
 * chosen around:
 *
 *   IDLE (24h, slides forward on use) — a founder checking in daily never sees
 *   a login screen. A session forgotten in a lab is dead by the next morning.
 *
 *   ABSOLUTE (14 days from login, never slides) — even someone using the app
 *   every day re-authenticates fortnightly, which bounds how long a stolen
 *   cookie is worth anything.
 *
 * Neither is a substitute for signing out, which now works; they are the
 * backstop for when nobody does.
 */
const SESSION_IDLE_HOURS = 24;
const SESSION_ABSOLUTE_DAYS = 14;
const INVITE_DAYS = 14;
export const MIN_PASSWORD_LENGTH = 10;

type AstroCookies = Parameters<APIRoute>[0]["cookies"];

/** 256 bits of CSPRNG output, hex-encoded — not guessable and not enumerable. */
export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isoInDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function isoInHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export function sessionExpiry(): string {
  return isoInHours(SESSION_IDLE_HOURS);
}

export function inviteExpiry(): string {
  return isoInDays(INVITE_DAYS);
}

/** Argon2id via Bun's built-in, so there is no third-party hashing dependency. */
export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}

/** Returns an error message, or null when the password is acceptable. */
export function validatePassword(password: string): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) return "Password is too long.";
  if (!password.trim()) return "Password cannot be only spaces.";
  return null;
}

export function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/*
 * Whether to mark the cookie Secure.
 *
 * Production is always yes, regardless of what the request looks like. Behind
 * Render the app is spoken to over plain HTTP on an internal host, so the only
 * evidence of TLS is `X-Forwarded-Proto` — and deciding on that alone means a
 * single missing header silently downgrades every session cookie to one that
 * will travel over cleartext. The deployment is HTTPS-only; that is a fact
 * about the deployment, not something to rediscover per request.
 *
 * Outside production the header check remains, so a local http:// server still
 * sets a usable cookie.
 */
function wantsSecureCookie(request: Request): boolean {
  if (process.env.NODE_ENV === "production") return true;
  return (
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https"
  );
}

export function startSession(
  cookies: AstroCookies,
  request: Request,
  email: string,
): string {
  // Retire whatever this browser was carrying before minting a new one.
  // Without it every sign-in leaves a live row behind, so a shared or stolen
  // laptop accumulates valid sessions that logging out never reaches.
  const previous = cookies.get(SESSION_COOKIE)?.value;
  if (previous) deleteSessionRow(previous);

  const token = randomToken();
  createSessionRow(token, email, sessionExpiry());
  cookies.set(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    // The browser may hold the cookie up to the absolute ceiling; the server
    // decides whether it still means anything. A cookie outliving its session
    // simply stops authenticating.
    maxAge: SESSION_ABSOLUTE_DAYS * 24 * 60 * 60,
    secure: wantsSecureCookie(request),
  });
  // Opportunistic cleanup; there is no scheduler on a single-instance deploy.
  purgeExpiredSessions();
  return token;
}

export function endSession(cookies: AstroCookies): void {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) deleteSessionRow(token);
  cookies.delete(SESSION_COOKIE, { path: "/" });
}

/** Signs the user out of every device — used after a password change. */
export function endAllSessions(email: string): void {
  deleteSessionsForUser(email);
}

/**
 * The single source of truth for "who is making this request". Every protected
 * endpoint must go through here rather than reading the cookie directly.
 */
/**
 * Parses a timestamp out of the database.
 *
 * Two formats reach this column. SQLite's own datetime('now') default writes
 * "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker, and Date parses that as
 * *local* time — hours out, and in the wrong direction in Helsinki, which is
 * enough to expire a session early or keep a stale one alive. Anything written
 * from application code is a full ISO string that already carries a zone.
 *
 * So: add the UTC marker only when there is not one already. Appending it
 * blindly turns a valid ISO string into an unparseable one, which fails open —
 * the deadline silently stops being enforced.
 */
function parseStoredTime(value: string): number {
  const trimmed = value.trim();
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  return Date.parse(hasZone ? trimmed : trimmed.replace(" ", "T") + "Z");
}

export function getSessionUser(cookies: AstroCookies): SessionUser | null {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = getSessionRow(token);
  if (!row) return null;

  const now = Date.now();

  // Idle deadline: has this session gone unused for too long?
  if (new Date(row.expires_at).getTime() <= now) {
    deleteSessionRow(token);
    return null;
  }

  // Absolute deadline: has it existed for too long, however busy it has been?
  const createdAt = parseStoredTime(row.created_at);
  if (Number.isFinite(createdAt) && now - createdAt >= SESSION_ABSOLUTE_DAYS * 24 * 60 * 60 * 1000) {
    deleteSessionRow(token);
    return null;
  }

  /*
   * Slide the idle window forward, but not on every single request — that
   * would be a write per API call, and this app makes several per screen.
   * Extending only once the window is more than half gone keeps the guarantee
   * (a session in continuous use never expires) at roughly one write per
   * twelve hours per person.
   */
  const remaining = new Date(row.expires_at).getTime() - now;
  if (remaining < (SESSION_IDLE_HOURS * 60 * 60 * 1000) / 2) {
    touchSessionRow(token, sessionExpiry());
  }

  return { email: row.user_email, name: row.name, role: row.role };
}

/**
 * Per-email login throttle. In-memory is sufficient: the app runs as a single
 * instance for one ~24-person cohort, and a restart clearing the counters is an
 * acceptable trade for having no extra infrastructure.
 *
 * Bounded, though. A failure is recorded for every address tried, including
 * ones that do not exist, and entries used to be evicted only when that same
 * address came back — so an attacker cycling fresh addresses grew this map
 * without limit. It now sheds expired entries once it gets large, and refuses
 * to exceed a hard ceiling.
 */
const FAILURE_LIMIT = 10;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_TRACKED_EMAILS = 5_000;
const FAILURE_LOW_WATER = 4_000;
const failures = new Map<string, { count: number; firstAt: number }>();

function evictStaleFailures(now: number): void {
  if (failures.size < MAX_TRACKED_EMAILS) return;
  for (const [email, record] of failures) {
    if (now - record.firstAt > LOCKOUT_MS) failures.delete(email);
  }
  // Every entry still inside its window means this is an attack, not traffic.
  // Clear down to a low-water mark rather than to exactly the cap: sweeping on
  // every call once full would make each login attempt O(n) at precisely the
  // moment somebody is hammering the endpoint.
  if (failures.size >= FAILURE_LOW_WATER) {
    let toDrop = failures.size - FAILURE_LOW_WATER;
    for (const email of failures.keys()) {
      if (toDrop-- <= 0) break;
      failures.delete(email);
    }
  }
}

/**
 * The caller's IP, as far as it can be trusted.
 *
 * Render terminates TLS and appends the real client to `X-Forwarded-For`, so
 * the first hop is the client and the rest are proxies. Taking the first entry
 * is the standard read, and the header is only meaningful because nothing
 * reaches this process except through Render — stated here because that is the
 * assumption the throttle rests on. Direct access to the container would let a
 * caller forge this, and would also let them bypass every other proxy-level
 * control, so it is not a limit worth engineering around.
 *
 * Returns null rather than a placeholder when there is no header: lumping every
 * unknown caller under one key would let one of them lock out the others.
 */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length <= 45 ? first : null;
}

/*
 * Per-address throttle, alongside the per-email one.
 *
 * The per-email limit alone stops somebody grinding one account, and does
 * nothing about the attack that actually fits this app: twenty-four known
 * addresses, ten tries each, one common password. That is 240 guesses from a
 * single machine without ever tripping a limit. This caps the machine.
 *
 * Deliberately looser than the per-email limit. A shared office NAT can put
 * the whole cohort behind one address, and locking out a room of founders
 * because one of them fumbled a password is a worse failure than the attack.
 */
/*
 * Exported so the test can assert the boundary rather than hunt for it. It
 * used to try up to forty times and stop at the first 429, which meant the
 * suite paid an Argon2id verify for every attempt with no idea how many it
 * would need.
 */
export const IP_FAILURE_LIMIT = 30;
const ipFailures = new Map<string, { count: number; firstAt: number }>();
const MAX_TRACKED_IPS = 5_000;

function bumpWindow(
  map: Map<string, { count: number; firstAt: number }>,
  key: string,
  now: number,
): void {
  const record = map.get(key);
  if (!record || now - record.firstAt > LOCKOUT_MS) {
    map.set(key, { count: 1, firstAt: now });
    return;
  }
  record.count += 1;
}

export function isIpLockedOut(ip: string | null): boolean {
  if (!ip) return false;
  const record = ipFailures.get(ip);
  if (!record) return false;
  if (Date.now() - record.firstAt > LOCKOUT_MS) {
    ipFailures.delete(ip);
    return false;
  }
  return record.count >= IP_FAILURE_LIMIT;
}

export function recordIpFailure(ip: string | null): void {
  if (!ip) return;
  const now = Date.now();
  if (ipFailures.size >= MAX_TRACKED_IPS) {
    for (const [key, record] of ipFailures) {
      if (now - record.firstAt > LOCKOUT_MS) ipFailures.delete(key);
    }
    // Still full of live windows: that is the attack, so stop adding keys
    // rather than letting the map grow without bound.
    if (ipFailures.size >= MAX_TRACKED_IPS) return;
  }
  bumpWindow(ipFailures, ip, now);
}

export function clearIpFailures(ip: string | null): void {
  if (ip) ipFailures.delete(ip);
}

/** Test seam. */
export function resetIpFailures(): void {
  ipFailures.clear();
}

export function isLockedOut(email: string): boolean {
  const record = failures.get(email);
  if (!record) return false;
  if (Date.now() - record.firstAt > LOCKOUT_MS) {
    failures.delete(email);
    return false;
  }
  return record.count >= FAILURE_LIMIT;
}

export function recordLoginFailure(email: string): void {
  const now = Date.now();
  evictStaleFailures(now);
  const record = failures.get(email);
  if (!record || now - record.firstAt > LOCKOUT_MS) {
    failures.set(email, { count: 1, firstAt: now });
    return;
  }
  record.count += 1;
}

export function clearLoginFailures(email: string): void {
  failures.delete(email);
}

/** Test/telemetry only. */
export function trackedFailureCount(): number {
  return failures.size;
}

/**
 * Makes an unknown account cost the same as a known one.
 *
 * Argon2id runs only when there is a hash to check, so a missing account
 * returned in ~1.5 ms while a real one took ~60 ms. That 35x gap is a reliable
 * oracle for "does this address have an account here" no matter how carefully
 * the error messages are matched. Verifying against a throwaway hash spends
 * the same work on the path that has nothing to verify.
 *
 * Computed once, lazily, so it costs nothing at boot.
 */
let decoyHash: string | null = null;

export async function equalizeVerifyCost(password: string): Promise<void> {
  try {
    decoyHash ??= await Bun.password.hash(randomToken(16));
    await Bun.password.verify(password, decoyHash);
  } catch {
    // Never let the decoy change the outcome of a login.
  }
}
