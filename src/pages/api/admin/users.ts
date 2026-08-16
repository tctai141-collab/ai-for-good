import type { APIRoute } from "astro";
import {
  countOrganizers,
  createInvite,
  createUser,
  deleteUser,
  getUserRow,
  listUsers,
  updateUser,
  type Role,
} from "../../../db/index";
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
 * Where the app is reachable from the outside.
 *
 * `request.url` is the address the server bound to, not the address the person
 * typed, so behind a proxy it yields links pointing at localhost. Prefer an
 * explicit PUBLIC_BASE_URL, then the forwarded/Host headers, and only fall back
 * to the request URL.
 */
function baseUrl(request: Request): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto =
      request.headers.get("x-forwarded-proto") ??
      new URL(request.url).protocol.replace(":", "");
    return `${proto}://${host}`;
  }

  return new URL(request.url).origin;
}

function inviteUrl(request: Request, token: string): string {
  return `${baseUrl(request)}/setup?token=${token}`;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function issueInvite(request: Request, email: string): string {
  const token = randomToken();
  createInvite(token, email, inviteExpiry());
  return inviteUrl(request, token);
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
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const role: Role = body.role === "organizer" ? "organizer" : "founder";

  switch (body.action) {
    case "add": {
      if (!isValidEmail(email)) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
      if (!name) return Response.json({ error: "Name is required." }, { status: 400 });
      if (!createUser(email, name, role)) {
        return Response.json({ error: `${email} already has an account.` }, { status: 409 });
      }
      return Response.json({ ok: true, email, link: issueInvite(request, email) });
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
          return { email: entryEmail, name: entryName, link: issueInvite(request, entryEmail) };
        },
      );
      return Response.json({ ok: true, results });
    }

    // Used both for someone who never activated and for a forgotten password:
    // a fresh link invalidates any previous one.
    case "reinvite": {
      if (!getUserRow(email)) return Response.json({ error: "No such account." }, { status: 404 });
      return Response.json({ ok: true, email, link: issueInvite(request, email) });
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
      // Revoke live access first; deleting the row cascades to their data.
      endAllSessions(email);
      deleteUser(email);
      return Response.json({ ok: true });
    }

    default:
      return Response.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }
};
