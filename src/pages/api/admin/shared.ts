import type { APIRoute } from "astro";
import { listSharedThreads, markSharedThreadSeen, recordAdminAction } from "../../../db/index";
import { getSessionUser } from "../../../lib/auth";
import { reportError } from "../../../lib/errors";

/**
 * Conversations the cohort has handed over.
 *
 * The share toggle has written its flag since it shipped and nothing ever read
 * it from a screen, so founders were sharing into a void — Tai looked in
 * /admin, found nothing, and asked where it goes. This is the missing half.
 *
 * The privacy line is the flag and only the flag. A conversation appears here
 * because a founder chose to hand it over; everything else stays unreadable to
 * organizers no matter who is asking. That is the same rule
 * `/api/persistence` already enforces when an organizer reads one founder, and
 * it must not weaken just because this view is cohort-wide.
 *
 * Reads are audited. Someone opening a founder's private reflection is exactly
 * the action an operating team should be able to account for later.
 */

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function guard(cookies: Parameters<APIRoute>[0]["cookies"]) {
  const session = getSessionUser(cookies);
  if (!session) return { error: json({ error: "Not signed in." }, 401) };
  if (session.role !== "organizer") return { error: json({ error: "Organizers only." }, 403) };
  return { session };
}

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const { error } = guard(cookies);
    if (error) return error;

    const threads = listSharedThreads().map((t) => ({
      id: t.id,
      founderName: t.founderName,
      founderEmail: t.user_email,
      title: t.title,
      theme: t.theme,
      state: t.state,
      lastAt: t.last_at,
      updatedAt: t.updated_at,
      seenAt: t.shared_seen_at ?? null,
      messages: t.messages,
    }));

    return json({ threads });
  } catch (err) {
    reportError(err, { where: "admin.shared.GET" });
    return json({ error: "Could not load shared conversations." }, 500);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const { session, error } = guard(cookies);
    if (error) return error;

    let body: { action?: string; id?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Malformed request." }, 400);
    }

    if (body.action === "seen") {
      if (typeof body.id !== "string" || !body.id) return json({ error: "id required." }, 400);
      // Returns false for a thread that is not shared, so a stray id cannot
      // stamp a private conversation.
      if (!markSharedThreadSeen(body.id)) return json({ error: "Not a shared conversation." }, 404);
      recordAdminAction(session!.email, "shared:read", null, body.id.slice(0, 120));
      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${String(body.action)}` }, 400);
  } catch (err) {
    reportError(err, { where: "admin.shared.POST" });
    return json({ error: "That did not work." }, 500);
  }
};
