import type { APIRoute } from "astro";
import {
  BUG_STATUSES, countBugReportsSince, createBugReport, getBugReport,
  listBugReports, listUsersByRole, recordAdminAction, setBugStatus,
  type BugStatus,
} from "../../db/index";
import { canReadCohort, getSessionUser } from "../../lib/auth";
import { configuredAppUrl } from "../../lib/appUrl";
import { sendBugReportEmail } from "../../lib/email";
import { reportError } from "../../lib/errors";
import { cap, readJsonBody } from "../../lib/limits";

/**
 * Bug reports: somebody saying the software is wrong.
 *
 * Who does what:
 *   anyone signed in — files one
 *   organizer        — reads the queue and moves a report's status
 *   mentor           — reads the queue, changes nothing
 *   founder          — files, and cannot read the queue
 *
 * Filing is open to every role, which is where this differs from wishes. A
 * wish comes from the cohort by definition; a bug is a fact about the software
 * and an organizer who finds one on /admin needs somewhere to put it too.
 *
 * Reading is not. The queue is other people's reports, and a founder browsing
 * what everybody else has complained about is a different feature nobody asked
 * for — it also turns a bug report into something written in front of an
 * audience, which changes what people are willing to file.
 */

const MAX_BODY = 2_000;
/* Both come from the browser, and neither is trusted. Long enough for a real
   user-agent string, short enough that the column cannot be used as storage. */
const MAX_PAGE = 200;
const MAX_UA = 300;

/*
 * Every report emails the organizers, so there is a cap.
 *
 * Ten an hour is above anything anybody files on purpose — a bad afternoon is
 * three or four — and below what makes an inbox unusable. The same reasoning
 * as the wish limit, one notch higher because a person hitting a broken screen
 * repeatedly has more to say than somebody making requests.
 */
const REPORTS_PER_HOUR = 10;

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
    if (!canReadCohort(session)) {
      return json({ error: "Organizers and mentors only." }, 403);
    }
    return json({ reports: listBugReports() });
  } catch (error) {
    reportError(error, { where: "bugs.GET" });
    return json({ error: "Could not load the reports." }, 500);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const session = getSessionUser(cookies);
    if (!session) return json({ error: "Not signed in." }, 401);

    const read = await readJsonBody<{
      action?: unknown; id?: unknown; status?: unknown;
      body?: unknown; page?: unknown; userAgent?: unknown;
    }>(request);
    if (!read.ok) return read.response;
    const body = read.value;

    if (body.action === "update") return updateStatus(session, body);

    const text = cap(body.body, MAX_BODY).trim();
    if (!text) return json({ error: "Say what went wrong." }, 400);

    /*
     * The two fields nobody types.
     *
     * A report that says "the button does nothing" is a question; the same
     * report with the screen and the browser attached is usually the answer.
     * The bugs that have cost the most here only happened on somebody's phone,
     * where the difference between iOS Safari and everything else is the whole
     * story and the person reporting has no reason to know that.
     *
     * Capped and stored as the strings they are. Never parsed, never branched
     * on: they came from the client and they are evidence, not proof.
     */
    const page = cap(body.page, MAX_PAGE).trim();
    const userAgent = cap(body.userAgent, MAX_UA).trim();

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
    if (countBugReportsSince(session.email, hourAgo) >= REPORTS_PER_HOUR) {
      return json({ error: "That is a lot in one hour. Try again shortly." }, 429);
    }

    const id = crypto.randomUUID();
    createBugReport(id, session.email, session.name || session.email, text, page, userAgent);

    /*
     * Recorded first, emailed after, and never awaited into the response. A
     * mail provider having a bad minute must not lose the report or make the
     * person filing it think it failed — it is in the queue either way.
     */
    notify(session.name || session.email, text, page, userAgent).catch((error) => {
      reportError(error, { where: "bugs.notify" });
    });

    return json({ ok: true, id });
  } catch (error) {
    reportError(error, { where: "bugs.POST" });
    return json({ error: "That did not send. Nothing was recorded." }, 500);
  }
};

async function notify(fromName: string, text: string, page: string, userAgent: string): Promise<void> {
  const base = configuredAppUrl();
  const link = base ? `${base}/admin` : "";
  await Promise.all(
    listUsersByRole("organizer").map((person) =>
      sendBugReportEmail(person.email, fromName, text, page, userAgent, link),
    ),
  );
}

/**
 * Moving a report along.
 *
 * Organizers only. A mentor reads the queue — they are on the programme and a
 * bug they hit is one they should be able to see already filed — but triage is
 * operational work and belongs to whoever is going to do it.
 */
function updateStatus(
  session: { email: string; role: string },
  body: { id?: unknown; status?: unknown },
): Response {
  if (session.role !== "organizer") {
    return json({ error: "Organizers only." }, 403);
  }
  if (typeof body.id !== "string" || !body.id) return json({ error: "id required." }, 400);
  if (!getBugReport(body.id)) return json({ error: "No such report." }, 404);

  const status = body.status;
  if (typeof status !== "string" || !(BUG_STATUSES as readonly string[]).includes(status)) {
    return json({ error: `Status must be one of: ${BUG_STATUSES.join(", ")}.` }, 400);
  }

  setBugStatus(body.id, status as BugStatus);
  recordAdminAction(session.email, "bug:status", null, `${body.id} ${status}`);
  return json({ ok: true });
}
