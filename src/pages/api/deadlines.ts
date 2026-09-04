import type { APIRoute } from "astro";
import { adminWriteLimiter, tooMany, readJsonBody } from "../../lib/limits";
import {
  completedDeadlineIds,
  createDeadline,
  deadlineCompletionCounts,
  deleteDeadline,
  foundersBehindOn,
  foundersDoneOn,
  getDeadline,
  listActiveDeadlines,
  listAllDeadlines,
  listFounders,
  recordAdminAction,
  setDeadlineDone,
  updateDeadline,
} from "../../db/index";
import { canReadCohort, getSessionUser } from "../../lib/auth";
import { groupFor, progressFor } from "../../lib/deadlines";
import { TOTAL_WEEKS } from "../../lib/sprint-calendar";
import { reportError } from "../../lib/errors";
import { cap } from "../../lib/limits";

/**
 * Cohort deadlines: organizers set them, founders tick them off.
 *
 * This is net-new attack surface, so it is built against the findings the audit
 * produced rather than repeating them:
 *
 *   - ids are generated server-side, never accepted from a caller
 *   - a completion is always written for the session's own email; there is no
 *     code path that reads a user identity out of a request body
 *   - every organizer-only action checks the role before doing anything
 *   - the status view returns task state only and never joins to conversations
 */

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2_000;
/** A cohort has tens of milestones, not thousands. */
const MAX_DEADLINES = 500;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400) {
  return json({ error: message }, status);
}

/** ISO calendar date, and a real one — "2026-02-31" must not pass. */
/**
 * An optional time of day, HH:MM in Helsinki.
 *
 * Empty string and null both mean end of day, which is what a deadline without
 * a time has always meant. Distinguished from undefined on update, where
 * leaving the field out has to leave the stored value alone.
 */
function validTime(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh > 23 || mm > 59) return undefined;
  return `${match[1]}:${match[2]}`;
}

function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  const roundTrips =
    date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
  return roundTrips ? value : null;
}

function validWeek(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const week = Number(value);
  // The bound is the programme length, not a number typed in twice.
  if (!Number.isInteger(week) || week < 1 || week > TOTAL_WEEKS) return undefined; // invalid
  return week;
}

export const GET: APIRoute = async ({ cookies, request }) => {
  try {
    const session = getSessionUser(cookies);
    if (!session) return err("Not signed in.", 401);

    const url = new URL(request.url);

    // The completion matrix. Staff only, and task status only — who is behind
    // on what, never anything they wrote.
    if (url.searchParams.get("view") === "status") {
      if (!canReadCohort(session)) return err("Organizers and mentors only.", 403);

      const founders = listFounders();
      const counts = deadlineCompletionCounts();
      const deadlines = listAllDeadlines();

      return json({
        cohortSize: founders.length,
        deadlines: deadlines.map((d) => ({
          id: d.id,
          title: d.title,
          /*
           * description and dueTime are here so the admin list can open an
           * editor on a row without a second request.
           *
           * They are not optional extras. update treats an absent key as
           * "leave it alone", so a form that could not see these two would
           * either have to omit them — making it impossible to clear a
           * description — or send them empty, which silently wipes both the
           * moment anybody edits a title. Neither is a thing to find out
           * afterwards.
           *
           * Nothing a founder wrote is added by this: both are organizer
           * copy about the deadline, and this view is already staff-only.
           */
          description: d.description,
          dueTime: d.due_time,
          dueDate: d.due_date,
          sprintWeek: d.sprint_week,
          status: d.status,
          doneCount: counts[d.id] ?? 0,
          /*
           * Both halves, named. The count said how many were done and the list
           * named only those who were not, which answers "who do I chase" and
           * leaves "did the person I just spoke to actually tick it off"
           * unanswerable without counting.
           *
           * Names only — never anything they wrote. Same line as before,
           * drawn around a second list.
           */
          done: foundersDoneOn(d.id).map((f) => ({ email: f.email, name: f.name })),
          behind: foundersBehindOn(d.id).map((f) => ({ email: f.email, name: f.name })),
        })),
      });
    }

    // A founder's own list. Organizers see the same shape for themselves, which
    // is how they preview what the cohort sees.
    const deadlines = listActiveDeadlines();
    const done = new Set(completedDeadlineIds(session.email));
    const now = Date.now();

    const items = deadlines.map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      dueDate: d.due_date,
      dueTime: d.due_time,
      sprintWeek: d.sprint_week,
      done: done.has(d.id),
      // The time is part of when it is due, not just part of how it reads.
      group: groupFor(d.due_date, done.has(d.id), now, d.due_time),
    }));

    return json({
      deadlines: items,
      progress: progressFor(
        items.map((i) => ({ dueDate: i.dueDate, done: i.done, dueTime: i.dueTime })),
        now,
      ),
    });
  } catch (error) {
    reportError(error, { where: "deadlines.GET" });
    return err("Could not load deadlines. Please try again.", 500);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  let body: {
    action?: string;
    id?: unknown;
    title?: unknown;
    description?: unknown;
    dueDate?: unknown;
    dueTime?: unknown;
    sprintWeek?: unknown;
    status?: unknown;
    done?: unknown;
  };

  try {
    const session = getSessionUser(cookies);
    if (!session) return err("Not signed in.", 401);

    const read = await readJsonBody<typeof body>(request);
    if (!read.ok) return read.response;
    body = read.value;

    /*
     * Role and pace in one gate.
     *
     * Every organizer-only action here writes a row, and they all go through
     * this, so putting the ceiling here covers them together and cannot be
     * forgotten when a new action is added below. MAX_DEADLINES already bounds
     * how many can exist; this bounds how fast a stolen session can get there.
     */
    const organizerOnly = () => {
      if (session.role !== "organizer") return err("Organizers only.", 403);
      const limited = adminWriteLimiter.check(session.email);
      return limited ? tooMany(limited.retryAfterSeconds) : null;
    };

    switch (body.action) {
      case "create": {
        const denied = organizerOnly();
        if (denied) return denied;

        const title = cap(body.title, MAX_TITLE).trim();
        if (!title) return err("A title is required.");
        if (listAllDeadlines().length >= MAX_DEADLINES) {
          return err("Too many deadlines already exist.", 413);
        }

        const dueDate = validDate(body.dueDate);
        if (!dueDate) return err("A valid due date (YYYY-MM-DD) is required.");

        const dueTime = validTime(body.dueTime);
        if (body.dueTime !== undefined && dueTime === undefined) {
          return err("A due time must look like 14:30, or be left empty.");
        }

        const sprintWeek = validWeek(body.sprintWeek);
        if (sprintWeek === undefined) return err(`Sprint week must be between 1 and ${TOTAL_WEEKS}.`);

        // id, created_at and created_by are all set server-side.
        const created = createDeadline(
          {
            title,
            description: cap(body.description, MAX_DESCRIPTION).trim() || null,
            dueDate,
            dueTime: dueTime ?? null,
            sprintWeek,
          },
          session.email,
        );
        recordAdminAction(session.email, "deadline:create", null, `${created.id} ${title}`);
        return json({ ok: true, id: created.id });
      }

      case "update": {
        const denied = organizerOnly();
        if (denied) return denied;

        if (typeof body.id !== "string" || !body.id) return err("id required.");
        if (!getDeadline(body.id)) return err("No such deadline.", 404);

        const fields: Parameters<typeof updateDeadline>[1] = {};

        if (body.title !== undefined) {
          const title = cap(body.title, MAX_TITLE).trim();
          if (!title) return err("A title is required.");
          fields.title = title;
        }
        if (body.description !== undefined) {
          fields.description = cap(body.description, MAX_DESCRIPTION).trim() || null;
        }
        if (body.dueDate !== undefined) {
          const dueDate = validDate(body.dueDate);
          if (!dueDate) return err("A valid due date (YYYY-MM-DD) is required.");
          fields.dueDate = dueDate;
        }
        if (body.dueTime !== undefined) {
          const dueTime = validTime(body.dueTime);
          if (dueTime === undefined) {
            return err("A due time must look like 14:30, or be left empty.");
          }
          fields.dueTime = dueTime;
        }
        if (body.sprintWeek !== undefined) {
          const week = validWeek(body.sprintWeek);
          if (week === undefined) return err(`Sprint week must be between 1 and ${TOTAL_WEEKS}.`);
          fields.sprintWeek = week;
        }
        if (body.status !== undefined) {
          if (body.status !== "active" && body.status !== "archived") {
            return err("Status must be active or archived.");
          }
          fields.status = body.status;
        }

        updateDeadline(body.id, fields);
        recordAdminAction(session.email, "deadline:update", null, `${body.id} ${JSON.stringify(fields).slice(0, 120)}`);
        return json({ ok: true });
      }

      /*
       * Removes a deadline outright, for one set up wrong.
       *
       * Archiving already existed and is the right move for something that
       * happened and is over: it keeps the completion history and hides the
       * row from founders. This is for the other case, a deadline that should
       * never have existed, where leaving the record is leaving a mistake.
       *
       * The completions and the sent-reminder rows go with it: both reference
       * deadlines(id) ON DELETE CASCADE and this database runs with
       * foreign_keys ON, so there is nothing to clean up by hand and nothing
       * left pointing at an id that is gone.
       *
       * Founders see it disappear because their dashboard reads the deadlines
       * table; there is no separate copy to keep in step.
       */
      case "delete": {
        const denied = organizerOnly();
        if (denied) return denied;

        if (typeof body.id !== "string" || !body.id) return err("id required.");
        const existing = getDeadline(body.id);
        if (!existing) return err("No such deadline.", 404);

        deleteDeadline(body.id);
        /* Audited with the title, not just the id: after the row is gone the
           id says nothing about what was removed. */
        recordAdminAction(session.email, "deadline:delete", null, `${body.id} ${existing.title}`);
        return json({ ok: true });
      }

      // The one action founders may take. Note what is absent: any notion of
      // *whose* completion this is. It is always the caller's.
      case "toggle": {
        if (typeof body.id !== "string" || !body.id) return err("id required.");
        const found = setDeadlineDone(body.id, session.email, Boolean(body.done));
        if (!found) return err("No such deadline.", 404);
        return json({ ok: true, done: Boolean(body.done) });
      }

      default:
        return err(`Unknown action: ${String(body.action)}`);
    }
  } catch (error) {
    reportError(error, { where: "deadlines.POST" });
    return err("That did not work. Nothing was changed.", 500);
  }
};
