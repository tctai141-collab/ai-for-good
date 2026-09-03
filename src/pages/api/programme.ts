import type { APIRoute } from "astro";
import { readJsonBody } from "../../lib/limits";
import {
  deleteProgrammeWeek,
  listProgrammeWeeks,
  recordAdminAction,
  upsertProgrammeWeek,
} from "../../db/index";
import { getSessionUser } from "../../lib/auth";
import { reportError } from "../../lib/errors";
import { cap } from "../../lib/limits";
import { currentSprintWeek, sprintStartDate, TOTAL_WEEKS } from "../../lib/sprint-calendar";

/**
 * The cohort's programme: readable by the cohort, editable by organizers.
 *
 * The read was organizers-only, on the reasoning that the advisor is handed the
 * current week server-side so founders had no need for the endpoint. That was
 * wrong about what founders need. It is their own schedule, and not being able
 * to look up what is on this week was the most obvious gap in the product.
 */

const MAX_SHORT = 200;
const MAX_LONG = 4_000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/*
 * Readable by the whole cohort, editable only by organizers.
 *
 * The read used to be organizers-only, which meant the one thing every founder
 * would want to look up, what is on this week, was the one thing the product
 * would not tell them. It is the cohort's own schedule; there is nothing in it
 * that is not said out loud in the room.
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    const session = getSessionUser(cookies);
    if (!session) return json({ error: "Not signed in." }, 401);

    return json({
      totalWeeks: TOTAL_WEEKS,
      weeks: listProgrammeWeeks(),
      currentWeek: currentSprintWeek(),
      /* So the timeline can place a dated event into its sprint week without a
         second round trip, and can say "no start date set" rather than
         silently filing everything under week 1. */
      startDate: sprintStartDate(),
    });
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

    const read = await readJsonBody<{ action?: unknown; week?: unknown; phase?: unknown; title?: unknown; milestones?: unknown; sessions?: unknown }>(request);
    if (!read.ok) return read.response;
    const body = read.value;

    const week = Number(body.week);
    if (!Number.isInteger(week) || week < 1 || week > TOTAL_WEEKS) {
      return json({ error: `Week must be between 1 and ${TOTAL_WEEKS}.` }, 400);
    }

    /*
     * Deleting is opt-in, and the shape without an action is untouched.
     *
     * A body with no `action` still means "save this week", which is what
     * every existing caller sends and what programme.test.ts pins. Only the
     * explicit action removes anything, so a request that loses its fields on
     * the way here cannot turn into a delete by accident.
     */
    if (body.action === "delete") {
      deleteProgrammeWeek(week);
      recordAdminAction(session.email, "programme:delete", null, `week ${week}`);
      return json({ ok: true, deleted: week });
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
