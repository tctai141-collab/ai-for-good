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
 */
const FAILURE_LIMIT = 10;
const LOCKOUT_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; firstAt: number }>();

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
  const record = failures.get(email);
  if (!record || Date.now() - record.firstAt > LOCKOUT_MS) {
    failures.set(email, { count: 1, firstAt: Date.now() });
    return;
  }
  record.count += 1;
}

export function clearLoginFailures(email: string): void {
  failures.delete(email);
}
