import type { APIRoute } from "astro";
import { listProgrammeWeeks, recordAdminAction, upsertProgrammeWeek } from "../../db/index";
import { getSessionUser } from "../../lib/auth";
import { reportError } from "../../lib/errors";
import { cap } from "../../lib/limits";
import { TOTAL_WEEKS } from "../../lib/sprint-calendar";

/**
 * The cohort's programme, editable by organizers.
 *
 * Organizer-only in both directions. Founders never read this endpoint — the
 * advisor is given the current week server-side — so there is no reason to
 * expose the whole schedule to them through an API.
 */

const MAX_SHORT = 200;
const MAX_LONG = 4_000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const session = getSessionUser(cookies);
    if (!session) return json({ error: "Not signed in." }, 401);
    if (session.role !== "organizer") return json({ error: "Organizers only." }, 403);

    return json({ totalWeeks: TOTAL_WEEKS, weeks: listProgrammeWeeks() });
  } catch (error) {
    reportError(error, { where: "programme.GET" });
    return json({ error: "Could not load the programme." }, 500);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const session = getSessionUser(cookies);
    if (!session) return json({ error: "Not signed in." }, 401);
    if (session.role !== "organizer") return json({ error: "Organizers only." }, 403);

    let body: { week?: unknown; phase?: unknown; title?: unknown; milestones?: unknown; sessions?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Malformed request." }, 400);
    }

    const week = Number(body.week);
    if (!Number.isInteger(week) || week < 1 || week > TOTAL_WEEKS) {
      return json({ error: `Week must be between 1 and ${TOTAL_WEEKS}.` }, 400);
    }

    upsertProgrammeWeek({
      week,
      phase: cap(body.phase, MAX_SHORT),
      title: cap(body.title, MAX_SHORT),
      milestones: cap(body.milestones, MAX_LONG),
      sessions: cap(body.sessions, MAX_LONG),
    });

    recordAdminAction(session.email, "programme:update", null, `week ${week}`);
    return json({ ok: true });
  } catch (error) {
    reportError(error, { where: "programme.POST" });
    return json({ error: "That did not save. Nothing was changed." }, 500);
  }
};
