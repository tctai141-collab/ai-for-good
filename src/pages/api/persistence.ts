import type { APIRoute } from "astro";
import {
  getDb,
  upsertThread,
  getThreads,
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

type SessionUser = {
  email: string;
  name: string;
  role: "founder" | "organizer";
};

function readSession(cookies: Parameters<APIRoute>[0]["cookies"]): SessionUser | null {
  const raw = cookies.get("session_user")?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionUser;
    if (!parsed.email || !parsed.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

function requireSessionForUser(session: SessionUser | null, userEmail?: string) {
  if (!session) return "not authenticated";
  if (!userEmail) return "userEmail required";
  if (session.role !== "organizer" && session.email !== userEmail) return "forbidden";
  return null;
}

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const session = readSession(cookies);
    const body = await request.json() as {
      action: string;
      user?: string;
      userEmail?: string;
      thread?: { id: string; title: string; theme: string; state: string; lastAt: string; personality?: string; messages: { role: string; content: string }[] };
      decision?: { id: string; summary: string; door: string; theme: string; status?: string; outcome?: string; threadId?: string; at?: string };
      checkin?: { id: string; theme?: string; prompt: string; mood?: number; refDecisionId?: string };
      workingGenius?: { primary: string; counts: Record<string, number>; completedAt: string };
      checkinId?: string;
    };

    const db = getDb();

    switch (body.action) {
      case "init-user": {
        if (!session) return err("not authenticated", 401);
        if (!body.user) return err("user required");
        const [email, name, role] = body.user.split("|");
        if (session.email !== email || session.role !== role) return err("forbidden", 403);
        ensureUser(email, name, role as "founder" | "organizer");
        return json({ ok: true });
      }

      case "save-thread": {
        const authError = requireSessionForUser(session, body.userEmail);
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

      case "save-decision": {
        const authError = requireSessionForUser(session, body.userEmail);
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
        const authError = requireSessionForUser(session, body.userEmail);
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
        const authError = requireSessionForUser(session, body.userEmail);
        if (authError) return err(authError, authError === "forbidden" ? 403 : 401);
        if (!body.checkinId) return err("checkinId required");
        deleteCheckin(body.checkinId);
        return json({ ok: true });
      }

      case "increment-visits": {
        const authError = requireSessionForUser(session, body.userEmail);
        if (authError) return err(authError, authError === "forbidden" ? 403 : 401);
        if (!body.userEmail) return err("userEmail required");
        const count = incrementVisits(body.userEmail);
        return json({ count });
      }

      case "save-working-genius": {
        const authError = requireSessionForUser(session, body.userEmail);
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
    const session = readSession(cookies);
    const url = new URL(request.url);
    const resource = url.searchParams.get("resource");
    const userEmail = url.searchParams.get("user");

    if (!userEmail) return err("user param required");
    const authError = requireSessionForUser(session, userEmail);
    if (authError) return err(authError, authError === "forbidden" ? 403 : 401);

    switch (resource) {
      case "threads":
        return json({ threads: getThreads(userEmail) });
      case "decisions":
        return json({ decisions: getDecisions(userEmail) });
      case "checkins":
        return json({ checkins: getCheckins(userEmail) });
      case "visits":
        return json({ visits: getVisits(userEmail) });
      case "working-genius": {
        const row = getWorkingGenius(userEmail);
        return json({ workingGenius: row });
      }
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
