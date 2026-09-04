import type { APIRoute } from "astro";
import {
  archiveProgrammeEvent,
  listProgrammeEvents,
  recordAdminAction,
  upsertProgrammeEvent,
  type ProgrammeEventRow,
} from "../../db/index";
import { getSessionUser } from "../../lib/auth";
import { reportError } from "../../lib/errors";
import { adminWriteLimiter, cap, readJsonBody, tooMany } from "../../lib/limits";
import { validDate, validTime } from "../../lib/programme-dates";

/**
 * The dated programme: sessions, milestones, checkpoints, the trip.
 *
 * Readable by anybody signed in — it is the cohort's own schedule and nothing
 * in it is private; every item is announced in the room. Writable only by
 * organizers, because a calendar twenty people can edit is not a calendar.
 */

const MAX_TITLE = 200;
const MAX_LOCATION = 200;
const MAX_DESCRIPTION = 2_000;

/*
 * A ceiling on how many can exist, not just how fast they arrive.
 *
 * The rate limit above slows a loop down; this stops it. Deadlines already
 * carried a cap for the same reason — the database is a file on a 1 GB disk,
 * and unbounded rows from a stolen organizer session is the cheapest way to
 * take the whole thing down. A thirteen-week programme with four things a day
 * would not reach a quarter of this.
 */
const MAX_EVENTS = 2_000;

/** The kinds an event can be. Anything else is rejected rather than coerced. */
const KINDS = ["session", "milestone", "checkpoint", "social", "trip"] as const;
type Kind = (typeof KINDS)[number];

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
    return json({ events: listProgrammeEvents() });
  } catch (error) {
    reportError(error, { where: "programme-events.GET" });
    return json({ error: "Could not load the programme." }, 500);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const session = getSessionUser(cookies);
    if (!session) return json({ error: "Not signed in." }, 401);
    if (session.role !== "organizer") return json({ error: "Organizers only." }, 403);

    /* Rows on a 1 GB disk the database also lives on. */
    const limited = adminWriteLimiter.check(session.email);
    if (limited) return tooMany(limited.retryAfterSeconds);

    const read = await readJsonBody<Record<string, unknown>>(request);
    if (!read.ok) return read.response;
    const body = read.value;

    if (body.action === "delete") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return json({ error: "Which event?" }, 400);
      if (!archiveProgrammeEvent(id)) return json({ error: "That event is already gone." }, 404);
      recordAdminAction(session.email, "programme:event-delete", null, id);
      return json({ ok: true });
    }

    const title = cap(body.title, MAX_TITLE).trim();
    if (!title) return json({ error: "An event needs a title." }, 400);

    /* Checked only for new entries, so editing one of them stays possible at
       the ceiling rather than locking the schedule. */
    const isNew = !(typeof body.id === "string" && body.id);
    if (isNew && listProgrammeEvents().length >= MAX_EVENTS) {
      return json({ error: "There are already too many entries in the programme." }, 413);
    }

    if (!validDate(body.startsOn)) return json({ error: "Pick a date." }, 400);

    const kind = KINDS.includes(body.kind as Kind) ? (body.kind as Kind) : "session";

    const startTime = validTime(body.startTime) ? body.startTime : "";
    const endTime = validTime(body.endTime) ? body.endTime : "";

    /*
     * An end before a start is refused rather than swapped. Both are plain
     * clock times on the same day, so "14:00 to 09:00" is a typo, and quietly
     * turning it into "09:00 to 14:00" would put a session on the calendar
     * that nobody scheduled.
     */
    if (startTime && endTime && endTime < startTime) {
      return json({ error: "That ends before it starts." }, 400);
    }
    // An end time without a start has nothing to be the end of.
    if (endTime && !startTime) return json({ error: "Give it a start time too." }, 400);

    const row: ProgrammeEventRow = {
      id: typeof body.id === "string" && body.id ? body.id : crypto.randomUUID(),
      title,
      kind,
      startsOn: body.startsOn,
      startTime,
      endTime,
      location: cap(body.location, MAX_LOCATION),
      description: cap(body.description, MAX_DESCRIPTION),
    };

    upsertProgrammeEvent(row, session.email);
    recordAdminAction(session.email, "programme:event-save", null, `${row.startsOn} ${row.title}`);
    return json({ ok: true, event: row });
  } catch (error) {
    reportError(error, { where: "programme-events.POST" });
    return json({ error: "That did not save. Nothing was changed." }, 500);
  }
};
