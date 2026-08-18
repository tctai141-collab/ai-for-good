import type { APIRoute } from "astro";
import {
  createSessionRow,
  deleteSessionRow,
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

const SESSION_DAYS = 30;
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

export function sessionExpiry(): string {
  return isoInDays(SESSION_DAYS);
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

function isHttps(request: Request): boolean {
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
  const token = randomToken();
  createSessionRow(token, email, sessionExpiry());
  cookies.set(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    secure: isHttps(request),
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
export function getSessionUser(cookies: AstroCookies): SessionUser | null {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = getSessionRow(token);
  if (!row) return null;

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    deleteSessionRow(token);
    return null;
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
