import type { APIRoute } from "astro";
import {
  upsertThread,
  getThreads,
  getSharedThreads,
  setThreadShared,
  deleteThread,
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
  getThemeSignals,
  NotOwnerError,
} from "../../db/index";
import { TOTAL_WEEKS, currentSprintWeek, weekForDateClamped } from "../../lib/sprint-calendar";
import { getSessionUser, type SessionUser } from "../../lib/auth";
import { reportError } from "../../lib/errors";
import {
  cap, MAX_MESSAGES_PER_THREAD, MAX_MESSAGE_CHARS,
  MAX_SUMMARY_CHARS, MAX_TITLE_CHARS,
} from "../../lib/limits";

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

/**
 * Writes are always first-person. Nobody edits anyone else's data.
 *
 * This proves *identity* only. Every record id below is chosen by the client,
 * so passing this check does not establish that the record being written
 * belongs to the caller — that is enforced separately in the db layer, which
 * throws NotOwnerError and is translated to 403 at the bottom of this handler.
 * Conflating the two is what let one founder overwrite another's thread.
 */
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
        if (typeof t.id !== "string" || !t.id) return err("thread.id required");
        if (!Array.isArray(t.messages)) return err("thread.messages must be an array");
        if (t.messages.length > MAX_MESSAGES_PER_THREAD) {
          return err(`A conversation cannot exceed ${MAX_MESSAGES_PER_THREAD} messages.`, 413);
        }
        upsertThread(
          {
            id: t.id.slice(0, 200),
            user_email: session!.email,
            // Capped so a single oversized field cannot fill the disk. The
            // middleware rejects giant bodies; these bound what a legitimate
            // request can still write.
            title: cap(t.title, MAX_TITLE_CHARS),
            theme: cap(t.theme, MAX_TITLE_CHARS),
            // Matches the CHECK constraint on the column.
            state: (["panic", "thinking", "venting"] as const).includes(t.state as never)
              ? t.state
              : "thinking",
            last_at: cap(t.lastAt, 80),
            personality: cap(t.personality, 40) || "none",
          },
          t.messages.map((m) => ({
            role: m.role === "assistant" ? "assistant" as const : "user" as const,
            content: cap(m.content, MAX_MESSAGE_CHARS),
          })),
        );
        return json({ ok: true });
      }

      // A founder deliberately opening one conversation to their coach, or
      // taking that back again.
      case "set-thread-shared": {
        const authError = requireSelf(session, body.userEmail);
        if (authError) return err(authError, authError === "forbidden" ? 403 : 401);
        if (!body.threadId || !body.userEmail) return err("threadId + userEmail required");
        // Report the state the database actually holds, not the state that
        // was requested — a write that matched no row used to report success.
        const shared = setThreadShared(body.threadId, session!.email, Boolean(body.shared));
        return json({ ok: true, shared });
      }

      // Removing a conversation the founder no longer wants. Their own only —
      // requireSelf plus a user-scoped DELETE, the same discipline as every
      // other write here.
      case "delete-thread": {
        const authError = requireSelf(session, body.userEmail);
        if (authError) return err(authError, authError === "forbidden" ? 403 : 401);
        if (!body.threadId || !body.userEmail) return err("threadId + userEmail required");
        const deleted = deleteThread(body.threadId, session!.email);
        if (!deleted) return err("No such conversation.", 404);
        return json({ ok: true });
      }

      case "save-decision": {
        const authError = requireSelf(session, body.userEmail);
        if (authError) return err(authError, authError === "forbidden" ? 403 : 401);
        if (!body.decision || !body.userEmail) return err("decision + userEmail required");
        const d = body.decision;
        if (typeof d.id !== "string" || !d.id) return err("decision.id required");
        if (d.door !== "reversible" && d.door !== "one-way") return err("decision.door invalid");
        if (d.status && d.status !== "open" && d.status !== "closed") return err("decision.status invalid");
        upsertDecision({
          id: d.id.slice(0, 200),
          user_email: session!.email,
          thread_id: d.threadId ? d.threadId.slice(0, 200) : null,
          summary: cap(d.summary, MAX_SUMMARY_CHARS),
          door: d.door,
          status: (d.status || "open") as "open" | "closed",
          theme: cap(d.theme, MAX_TITLE_CHARS),
          outcome: d.outcome ? cap(d.outcome, MAX_SUMMARY_CHARS) : null,
          at: cap(d.at, 80) || "today",
        });
        return json({ ok: true });
      }

      case "save-checkin": {
        const authError = requireSelf(session, body.userEmail);
        if (authError) return err(authError, authError === "forbidden" ? 403 : 401);
        if (!body.checkin || !body.userEmail) return err("checkin + userEmail required");
        const c = body.checkin;
        if (typeof c.id !== "string" || !c.id) return err("checkin.id required");
        const mood = typeof c.mood === "number" && Number.isFinite(c.mood)
          ? Math.max(0, Math.min(100, Math.round(c.mood)))
          : null;
        upsertCheckin({
          id: c.id.slice(0, 200),
          user_email: session!.email,
          ref_decision_id: c.refDecisionId ? c.refDecisionId.slice(0, 200) : null,
          theme: c.theme ? cap(c.theme, MAX_TITLE_CHARS) : null,
          prompt: cap(c.prompt, MAX_SUMMARY_CHARS),
          mood,
        });
        return json({ ok: true });
      }

      case "delete-checkin": {
        const authError = requireSelf(session, body.userEmail);
        if (authError) return err(authError, authError === "forbidden" ? 403 : 401);
        if (!body.checkinId) return err("checkinId required");
        deleteCheckin(body.checkinId, session!.email);
        return json({ ok: true });
      }

      case "increment-visits": {
        const authError = requireSelf(session, body.userEmail);
        if (authError) return err(authError, authError === "forbidden" ? 403 : 401);
        if (!body.userEmail) return err("userEmail required");
        return json({ count: incrementVisits(session!.email) });
      }

      case "save-working-genius": {
        const authError = requireSelf(session, body.userEmail);
        if (authError) return err(authError, authError === "forbidden" ? 403 : 401);
        if (!body.userEmail || !body.workingGenius) return err("workingGenius + userEmail required");
        upsertWorkingGenius({
          user_email: session!.email,
          primary_type: cap(body.workingGenius.primary, 60),
          counts_json: JSON.stringify(body.workingGenius.counts ?? {}).slice(0, 2_000),
          completed_at: cap(body.workingGenius.completedAt, 60),
        });
        return json({ ok: true });
      }

      default:
        return err("unknown action: " + body.action);
    }
  } catch (e) {
    // Writing to a record somebody else owns is a permission failure, not a
    // server fault.
    if (e instanceof NotOwnerError) return err("forbidden", 403);
    reportError(e, { where: "persistence.POST" });
    return json({ error: "Could not save that. Please try again." }, 500);
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

      // NOT summary-level by construction, whatever this comment used to
      // claim. detectDecision() in the client stores the founder's own first
      // nine words verbatim, so `summary` and `outcome` are transcript, and an
      // organizer reading them was reading the founder's words without any
      // opt-in. Same redaction as check-ins above: the coach gets the shape of
      // the decision — theme, reversible or one-way, still open or not — and
      // none of the prose.
      case "decisions": {
        const decisions = getDecisions(userEmail);
        if (isOwner) return json({ decisions });
        return json({
          decisions: decisions.map((d) => ({
            id: d.id,
            user_email: d.user_email,
            thread_id: d.thread_id,
            door: d.door,
            status: d.status,
            theme: d.theme,
            at: d.at,
            summary: null,
            outcome: null,
          })),
          redacted: true,
        });
      }

      case "visits":
        return json({ visits: getVisits(userEmail) });

      case "working-genius":
        return json({ workingGenius: getWorkingGenius(userEmail) });

      // Derived here rather than in the browser because placing a date into a
      // sprint week needs SPRINT_START_DATE, which is server-side only.
      case "themes": {
        // Only the founder sees their own themes. An organizer gets the
        // aggregate theme on the cohort dashboard, not this breakdown.
        if (!isOwner) return err("forbidden", 403);

        const counts = new Map<string, number[]>();
        for (const signal of getThemeSignals(userEmail)) {
          const label = (signal.theme || "").trim();
          if (!label || label === "—" || label === "checkin") continue;
          const at = new Date(signal.created_at.replace(" ", "T") + "Z");
          const week = weekForDateClamped(at);
          if (week === null) continue;
          const arc = counts.get(label) ?? Array(TOTAL_WEEKS).fill(0);
          arc[week - 1] += 1;
          counts.set(label, arc);
        }

        const themes = [...counts.entries()]
          .map(([name, arc]) => ({ name, arc }))
          .sort((a, b) => b.arc.reduce((x, y) => x + y, 0) - a.arc.reduce((x, y) => x + y, 0))
          .slice(0, 6);

        return json({ themes, week: currentSprintWeek() });
      }

      default:
        return err("unknown resource: " + resource);
    }
  } catch (e) {
    if (e instanceof NotOwnerError) return err("forbidden", 403);
    reportError(e, { where: "persistence.GET" });
    return json({ error: "Could not load that. Please try again." }, 500);
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
