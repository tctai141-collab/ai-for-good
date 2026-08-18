import type { APIRoute } from "astro";
import { getUserRow } from "../../db/index";
import {
  clearLoginFailures,
  endSession,
  equalizeVerifyCost,
  getSessionUser,
  isLockedOut,
  normalizeEmail,
  recordLoginFailure,
  startSession,
  verifyPassword,
} from "../../lib/auth";

/**
 * Login, session check, and logout.
 *
 * Accounts live in the database and passwords are verified server-side. The
 * previous version compared against a hardcoded list and issued a cookie that
 * simply asserted the caller's role.
 */

// Deliberately identical for unknown email, wrong password, and not-yet-
// activated accounts, so the endpoint cannot be used to discover who has one.
const INVALID_CREDENTIALS = "Invalid email or password.";

export const POST: APIRoute = async ({ cookies, request }) => {
  let body: { email?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return Response.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  if (isLockedOut(email)) {
    return Response.json(
      { error: "Too many failed attempts. Try again in 15 minutes." },
      { status: 429 },
    );
  }

  const user = getUserRow(email);

  // An invited user who has not set a password yet has no hash to verify
  // against; they must finish setup via their invite link first.
  if (!user || !user.password_hash) {
    // Spend the same time an Argon2id verify would, so the response time does
    // not reveal whether the account exists.
    await equalizeVerifyCost(password);
    recordLoginFailure(email);
    return Response.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  if (!(await verifyPassword(password, user.password_hash))) {
    recordLoginFailure(email);
    return Response.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  clearLoginFailures(email);
  startSession(cookies, request, user.email);

  return Response.json({
    ok: true,
    user: { email: user.email, name: user.name, role: user.role },
  });
};

export const GET: APIRoute = async ({ cookies }) => {
  return Response.json({ user: getSessionUser(cookies) });
};

export const DELETE: APIRoute = async ({ cookies }) => {
  endSession(cookies);
  return Response.json({ ok: true });
};
