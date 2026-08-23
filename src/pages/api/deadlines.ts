import type { APIRoute } from "astro";
import {
  completedDeadlineIds,
  createDeadline,
  deadlineCompletionCounts,
  foundersBehindOn,
  getDeadline,
  listActiveDeadlines,
  listAllDeadlines,
  listFounders,
  recordAdminAction,
  setDeadlineDone,
  updateDeadline,
} from "../../db/index";
import { getSessionUser } from "../../lib/auth";
import { groupFor, progressFor } from "../../lib/deadlines";
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
  if (!Number.isInteger(week) || week < 1 || week > 15) return undefined; // invalid
  return week;
}

export const GET: APIRoute = async ({ cookies, request }) => {
  try {
    const session = getSessionUser(cookies);
    if (!session) return err("Not signed in.", 401);

    const url = new URL(request.url);

    // The completion matrix. Organizers only, and task status only.
    if (url.searchParams.get("view") === "status") {
      if (session.role !== "organizer") return err("Organizers only.", 403);

      const founders = listFounders();
      const counts = deadlineCompletionCounts();
      const deadlines = listAllDeadlines();

      return json({
        cohortSize: founders.length,
        deadlines: deadlines.map((d) => ({
          id: d.id,
          title: d.title,
          dueDate: d.due_date,
          sprintWeek: d.sprint_week,
          status: d.status,
          doneCount: counts[d.id] ?? 0,
          // Names only — never anything they wrote.
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
      group: groupFor(d.due_date, done.has(d.id), now),
    }));

    return json({
      deadlines: items,
      progress: progressFor(
        items.map((i) => ({ dueDate: i.dueDate, done: i.done })),
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

    try {
      body = (await request.json()) as typeof body;
    } catch {
      return err("Malformed request.");
    }

    const organizerOnly = () =>
      session.role === "organizer" ? null : err("Organizers only.", 403);

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
        if (sprintWeek === undefined) return err("Sprint week must be between 1 and 15.");

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
          if (week === undefined) return err("Sprint week must be between 1 and 15.");
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
