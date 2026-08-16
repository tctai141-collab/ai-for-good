import type { APIRoute } from "astro";
import {
  upsertThread,
  getThreads,
  getSharedThreads,
  setThreadShared,
  upsertDecision,
  getDecisions,
  upsertCheckin,
  getCheckins,
  deleteCheckin,
  getVisits,
  incrementVisits,
  ensureUser,
  getWorkingGenius,
  upsertWorkingGenius,
} from "../../db/index";
import { getSessionUser, type SessionUser } from "../../lib/auth";

/**
 * Reading and writing founder data, under the cohort's privacy rule:
 *
 *   Founders' raw conversations are private. The operating team sees themes,
 *   attention signals and decisions — never the transcript — unless the
 *   founder explicitly shares a specific conversation.
 *
 * This used to be advisory: any organizer session could read any founder's
 * threads verbatim. It is now enforced here, because a promise the code
 * doesn't keep is worse than no promise — founders who suspect they're being
 * read write for the audience, and the signal disappears.
 */

/** Writes are always first-person. Nobody edits anyone else's data. */
function requireSelf(session: SessionUser | null, userEmail?: string): string | null {
  if (!session) return "not authenticated";
  if (!userEmail) return "userEmail required";
  if (session.email !== userEmail) return "forbidden";
  return null;
}

/** Reads are allowed for yourself, or for an organizer subject to redaction below. */
function requireSelfOrOrganizer(session: SessionUser | null, userEmail: string): string | null {
  if (!session) return "not authenticated";
  if (session.email === userEmail) return null;
  if (session.role === "organizer") return null;
  return "forbidden";
}

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const session = getSessionUser(cookies);
    const body = await request.json() as {
      action: string;
      user?: string;
      userEmail?: string;
      threadId?: string;
      shared?: boolean;
      thread?: { id: string; title: string; theme: string; state: string; lastAt: string; personality?: string; messages: { role: string; content: string }[] };
      decision?: { id: string; summary: string; door: string; theme: string; status?: string; outcome?: string; threadId?: string; at?: string };
      checkin?: { id: string; theme?: string; prompt: string; mood?: number; refDecisionId?: string };
      workingGenius?: { primary: string; counts: Record<string, number>; completedAt: string };
      checkinId?: string;
    };

    switch (body.action) {
      case "init-user": {
        if (!session) return err("not authenticated", 401);
        // Identity comes from the session, not from anything the client sends.
        ensureUser(session.email, session.name, session.role);
        return json({ ok: true });
      }

      case "save-thread": {
        const authError = requireSelf(session, body.userEmail);
        if (authError) return err(authError, authError === "forbidden" ? 403 : 401);
        if (!body.thread || !body.userEmail) return err("thread + userEmail required");
        const t = body.thread;
        upsertThread(
          {
            id: t.id,
            user_email: body.userEmail,
            title: t.title,
            theme: t.theme,
            state: t.state,
            last_at: t.lastAt,
            personality: t.personality || "none",
          },
          t.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        );
        return json({ ok: true });
      }

      // A founder deliberately opening one conversation to their coach, or
      // taking that back again.
      case "set-thread-shared": {
        const authError = requireSelf(session, body.userEmail);
        if (authError) return err(authError, authError === "forbidden" ? 403 : 401);
        if (!body.threadId || !body.userEmail) return err("threadId + userEmail required");
        setThreadShared(body.threadId, body.userEmail, Boolean(body.shared));
        return json({ ok: true, shared: Boolean(body.shared) });
      }

      case "save-decision": {
        const authError = requireSelf(session, body.userEmail);
        if (authError) return err(authError, authError === "forbidden" ? 403 : 401);
        if (!body.decision || !body.userEmail) return err("decision + userEmail required");
        const d = body.decision;
        upsertDecision({
          id: d.id,
          user_email: body.userEmail,
          thread_id: d.threadId || null,
          summary: d.summary,
          door: d.door as "reversible" | "one-way",
          status: (d.status || "open") as "open" | "closed",
          theme: d.theme,
          outcome: d.outcome || null,
          at: d.at || "today",
        });
        return json({ ok: true });
      }

      case "save-checkin": {
        const authError = requireSelf(session, body.userEmail);
        if (authError) return err(authError, authError === "forbidden" ? 403 : 401);
        if (!body.checkin || !body.userEmail) return err("checkin + userEmail required");
        upsertCheckin({
          id: body.checkin.id,
          user_email: body.userEmail,
          ref_decision_id: body.checkin.refDecisionId || null,
          theme: body.checkin.theme || null,
          prompt: body.checkin.prompt,
          mood: body.checkin.mood ?? null,
        });
        return json({ ok: true });
      }

      case "delete-checkin": {
        const authError = requireSelf(session, body.userEmail);
        if (authError) return err(authError, authError === "forbidden" ? 403 : 401);
        if (!body.checkinId) return err("checkinId required");
        deleteCheckin(body.checkinId);
        return json({ ok: true });
      }

      case "increment-visits": {
        const authError = requireSelf(session, body.userEmail);
        if (authError) return err(authError, authError === "forbidden" ? 403 : 401);
        if (!body.userEmail) return err("userEmail required");
        return json({ count: incrementVisits(body.userEmail) });
      }

      case "save-working-genius": {
        const authError = requireSelf(session, body.userEmail);
        if (authError) return err(authError, authError === "forbidden" ? 403 : 401);
        if (!body.userEmail || !body.workingGenius) return err("workingGenius + userEmail required");
        upsertWorkingGenius({
          user_email: body.userEmail,
          primary_type: body.workingGenius.primary,
          counts_json: JSON.stringify(body.workingGenius.counts),
          completed_at: body.workingGenius.completedAt,
        });
        return json({ ok: true });
      }

      default:
        return err("unknown action: " + body.action);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Persistence error";
    return json({ error: msg }, 500);
  }
};

export const GET: APIRoute = async ({ cookies, request }) => {
  try {
    const session = getSessionUser(cookies);
    const url = new URL(request.url);
    const resource = url.searchParams.get("resource");
    const userEmail = url.searchParams.get("user");

    if (!userEmail) return err("user param required");
    const authError = requireSelfOrOrganizer(session, userEmail);
    if (authError) return err(authError, authError === "forbidden" ? 403 : 401);

    const isOwner = session!.email === userEmail;

    switch (resource) {
      case "threads":
        // The privacy line. Organizers see only what was handed to them.
        return json({
          threads: isOwner ? getThreads(userEmail) : getSharedThreads(userEmail),
          redacted: !isOwner,
        });

      case "checkins": {
        const checkins = getCheckins(userEmail);
        if (isOwner) return json({ checkins });
        // Organizers get the signal, not the founder's words: theme, the
        // attention score, and when it happened.
        return json({
          checkins: checkins.map((c) => ({
            id: c.id,
            user_email: c.user_email,
            theme: c.theme,
            mood: c.mood,
            created_at: c.created_at,
            prompt: null,
          })),
          redacted: true,
        });
      }

      // Already summary-level by construction — a one-line decision, whether
      // it's reversible, and whether it's still open.
      case "decisions":
        return json({ decisions: getDecisions(userEmail) });

      case "visits":
        return json({ visits: getVisits(userEmail) });

      case "working-genius":
        return json({ workingGenius: getWorkingGenius(userEmail) });

      default:
        return err("unknown resource: " + resource);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Persistence error";
    return json({ error: msg }, 500);
  }
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function err(msg: string, status = 400) {
  return json({ error: msg }, status);
}
