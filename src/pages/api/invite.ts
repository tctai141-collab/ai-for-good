import type { APIRoute } from "astro";
import { getInvite, markInviteUsed, setUserPassword } from "../../db/index";
import {
  endAllSessions,
  hashPassword,
  startSession,
  validatePassword,
} from "../../lib/auth";

/**
 * Account setup and password reset via a single-use invite link.
 *
 * The operating team issues a link; the founder chooses their own password.
 * Nobody on the team ever sees or handles it.
 */

// One message for expired, already-used, and unknown tokens alike — the exact
// reason is not useful to the person and is useful to someone guessing.
const INVALID_LINK =
  "This setup link is not valid any more. Ask the Sprint team for a new one.";

type ValidInvite = { email: string; name: string };

function validate(token: string | null): ValidInvite | null {
  if (!token) return null;
  const invite = getInvite(token);
  if (!invite) return null;
  if (invite.used_at) return null;
  if (new Date(invite.expires_at).getTime() <= Date.now()) return null;
  return { email: invite.user_email, name: invite.name };
}

/** Lets the setup page greet the user by name before they submit anything. */
export const GET: APIRoute = async ({ request }) => {
  const token = new URL(request.url).searchParams.get("token");
  const invite = validate(token);
  if (!invite) return Response.json({ error: INVALID_LINK }, { status: 400 });
  return Response.json({ ok: true, email: invite.email, name: invite.name });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  let body: { token?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : null;
  const password = typeof body.password === "string" ? body.password : "";

  const invite = validate(token);
  if (!invite || !token) return Response.json({ error: INVALID_LINK }, { status: 400 });

  const problem = validatePassword(password);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  setUserPassword(invite.email, await hashPassword(password));
  markInviteUsed(token);
  // On a reset, drop any session opened with the old password.
  endAllSessions(invite.email);
  startSession(cookies, request, invite.email);

  return Response.json({ ok: true, email: invite.email, name: invite.name });
};
