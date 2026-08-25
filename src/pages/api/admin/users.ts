import type { APIRoute } from "astro";
import { APP_URL_UNSET, configuredAppUrl } from "../../../lib/appUrl";
import { readJsonBody } from "../../../lib/limits";
import {
  countOrganizers,
  createInvite,
  createUser,
  deleteUser,
  getUserRow,
  listUsers,
  recordAdminAction,
  updateUser,
  type Role,
} from "../../../db/index";
import { reportError } from "../../../lib/errors";
import {
  EmailNotConfiguredError,
  isEmailConfigured,
  sendInviteEmail,
  sendResetEmail,
} from "../../../lib/email";
import {
  endAllSessions,
  getSessionUser,
  inviteExpiry,
  normalizeEmail,
  randomToken,
} from "../../../lib/auth";

/**
 * Cohort administration, restricted to organizers.
 *
 * Issuing an account returns a single-use setup link that the operating team
 * distributes over whatever channel they already use to reach founders. No
 * email service is involved, and no password is ever generated on their behalf.
 */

/**
 * The setup link.
 *
 * This used to build its origin from PUBLIC_BASE_URL *or*, failing that, the
 * request's own X-Forwarded-Host / Host. That URL goes into an email carrying a
 * single-use token that sets a founder's password, and a request header is
 * chosen by whoever sent the request — so with PUBLIC_BASE_URL unset the app
 * would mail an activation link pointing wherever it was told. The message is
 * genuinely from the programme and the token is genuinely valid, which is
 * exactly what makes it worth phishing with.
 *
 * Configured origin or nothing. See lib/appUrl.ts.
 */
function inviteUrl(token: string): string | null {
  const origin = configuredAppUrl();
  return origin ? `${origin}/setup?token=${token}` : null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/**
 * Issues a setup link and emails it to the account holder.
 *
 * Returns nothing. The link used to come back in the response body, which meant
 * any organizer could press "Reset password" on a founder, redeem the link
 * themselves, and sign in as that founder — reading the conversations the
 * privacy model promises they cannot see. The operator now triggers an email
 * they never see the contents of.
 */
async function issueInvite(
  email: string,
  name: string,
  kind: "invite" | "reset",
): Promise<void> {
  const token = randomToken();
  const link = inviteUrl(token);
  /* Checked before the invite row is written: a token created and never
     delivered is a live credential sitting in the table for fourteen days. */
  if (!link) throw new AppUrlUnset();
  createInvite(token, email, inviteExpiry());
  if (kind === "invite") await sendInviteEmail(email, name, link);
  else await sendResetEmail(email, name, link);
}

/** Turns an email failure into a response without leaking provider detail. */
/** Raised when there is no configured origin to build a setup link from. */
class AppUrlUnset extends Error {}

function emailFailure(error: unknown) {
  if (error instanceof AppUrlUnset) {
    return Response.json({ error: APP_URL_UNSET }, { status: 503 });
  }
  if (error instanceof EmailNotConfiguredError) {
    return Response.json(
      { error: "Email is not configured, so the setup link cannot be delivered. Set RESEND_API_KEY and RESEND_FROM." },
      { status: 503 },
    );
  }
  console.error("[admin] invite email failed:", error);
  return Response.json(
    { error: "The account is ready but the email could not be sent. Try 'Resend link' in a moment." },
    { status: 502 },
  );
}

export const GET: APIRoute = async ({ cookies }) => {
  const session = getSessionUser(cookies);
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  if (session.role !== "organizer") {
    return Response.json({ error: "Organizers only." }, { status: 403 });
  }
  return Response.json({ users: listUsers(), you: session.email });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const session = getSessionUser(cookies);
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  if (session.role !== "organizer") {
    return Response.json({ error: "Organizers only." }, { status: 403 });
  }

  let body: {
    action?: string;
    email?: unknown;
    name?: unknown;
    role?: unknown;
    entries?: unknown;
  };
  const read = await readJsonBody<typeof body>(request);
  if (!read.ok) return read.response;
  body = read.value;

  const email = normalizeEmail(body.email);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const role: Role = body.role === "organizer" ? "organizer" : "founder";

  // One try/catch around every branch. An unhandled throw here used to return
  // a 500 with an *empty body*, so the admin page's `await res.json()` rejected
  // before it could read an error — leaving the button disabled and showing
  // nothing at all.
  try {
  switch (body.action) {
    case "add": {
      if (!isValidEmail(email)) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
      if (!name) return Response.json({ error: "Name is required." }, { status: 400 });
      if (!isEmailConfigured()) {
        return Response.json(
          { error: "Email is not configured, so a setup link cannot be delivered. Set RESEND_API_KEY and RESEND_FROM." },
          { status: 503 },
        );
      }
      if (!createUser(email, name, role)) {
        return Response.json({ error: `${email} already has an account.` }, { status: 409 });
      }
      try {
        await issueInvite(email, name, "invite");
      } catch (error) {
        recordAdminAction(session.email, "add-user:email-failed", email, role);
        return emailFailure(error);
      }
      recordAdminAction(session.email, "add-user", email, role);
      return Response.json({ ok: true, email, emailed: true });
    }

    // Adding a whole cohort at once. Each row is reported independently so one
    // bad line doesn't discard the rest of the paste.
    case "add-bulk": {
      if (!Array.isArray(body.entries)) {
        return Response.json({ error: "No rows to add." }, { status: 400 });
      }
      const results = (body.entries as { email?: unknown; name?: unknown; role?: unknown }[]).map(
        (entry) => {
          const entryEmail = normalizeEmail(entry.email);
          const entryName = typeof entry.name === "string" ? entry.name.trim() : "";
          const entryRole: Role = entry.role === "organizer" ? "organizer" : "founder";
          if (!isValidEmail(entryEmail)) return { email: entryEmail, error: "Invalid email address." };
          if (!entryName) return { email: entryEmail, error: "Missing name." };
          if (!createUser(entryEmail, entryName, entryRole)) {
            return { email: entryEmail, error: "Already has an account." };
          }
          return { email: entryEmail, name: entryName, role: entryRole };
        },
      );

      // Deliver outside the map so one failing address does not abort the rest.
      const delivered = [];
      for (const entry of results) {
        if ("error" in entry && entry.error) {
          delivered.push(entry);
          continue;
        }
        try {
          await issueInvite(entry.email, entry.name!, "invite");
          recordAdminAction(session.email, "add-user", entry.email, entry.role);
          delivered.push({ email: entry.email, name: entry.name, emailed: true });
        } catch (error) {
          console.error("[admin] bulk invite email failed:", error);
          recordAdminAction(session.email, "add-user:email-failed", entry.email, entry.role);
          delivered.push({ email: entry.email, name: entry.name, error: "Created, but the email could not be sent. Use 'Resend link'." });
        }
      }
      return Response.json({ ok: true, results: delivered });
    }

    // Used both for someone who never activated and for a forgotten password:
    // a fresh link invalidates any previous one.
    case "reinvite": {
      const existing = getUserRow(email);
      if (!existing) return Response.json({ error: "No such account." }, { status: 404 });
      try {
        // A reset the account holder did not ask for is exactly what they need
        // to hear about, so the email says so explicitly.
        await issueInvite(email, existing.name, existing.password_hash ? "reset" : "invite");
      } catch (error) {
        recordAdminAction(session.email, "reinvite:email-failed", email);
        return emailFailure(error);
      }
      recordAdminAction(session.email, existing.password_hash ? "reset-password" : "reinvite", email);
      return Response.json({ ok: true, email, emailed: true });
    }

    case "update": {
      const existing = getUserRow(email);
      if (!existing) return Response.json({ error: "No such account." }, { status: 404 });
      if (!name) return Response.json({ error: "Name is required." }, { status: 400 });
      // Don't allow the last organizer to demote themselves and lock everyone out.
      if (existing.role === "organizer" && role !== "organizer" && countOrganizers() <= 1) {
        return Response.json(
          { error: "This is the only organizer account. Add another before changing this one." },
          { status: 409 },
        );
      }
      updateUser(email, name, role);
      recordAdminAction(session.email, "update-user", email, `${existing.role} -> ${role}`);
      return Response.json({ ok: true });
    }

    case "remove": {
      const existing = getUserRow(email);
      if (!existing) return Response.json({ error: "No such account." }, { status: 404 });
      if (email === session.email) {
        return Response.json({ error: "You cannot remove your own account." }, { status: 409 });
      }
      if (existing.role === "organizer" && countOrganizers() <= 1) {
        return Response.json({ error: "This is the only organizer account." }, { status: 409 });
      }
      // Revoke live access first, then remove the account and every row that
      // belongs to it. deleteUser() does the children in one transaction — it
      // used to rely on a cascade that these tables do not have.
      endAllSessions(email);
      deleteUser(email);
      recordAdminAction(session.email, "remove-user", email, existing.role);
      return Response.json({ ok: true });
    }

    default:
      return Response.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }
  } catch (error) {
    reportError(error, { where: "admin.users", extra: { action: String(body.action) } });
    return Response.json(
      { error: "That did not work. Nothing was changed — check the server logs." },
      { status: 500 },
    );
  }
};
