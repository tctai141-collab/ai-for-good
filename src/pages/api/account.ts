import type { APIRoute } from "astro";
import { readJsonBody } from "../../lib/limits";
import {
  countOrganizers,
  deleteUser,
  getCheckins,
  getBookLoans,
  getDeadlineCompletions,
  getDecisions,
  getThreads,
  getUserRow,
  getVisits,
  getWorkingGenius,
  listWorkingGeniusTakes,
  recordAdminAction,
} from "../../db/index";
import { endSession, getSessionUser } from "../../lib/auth";
import { reportError } from "../../lib/errors";

/**
 * A person's own data: a copy of it, or the end of it.
 *
 * GDPR gives every founder here the right to a copy of what is held about them
 * and the right to have it erased, and neither was reachable — deletion existed
 * only as an organizer action, which is the operating team removing somebody
 * rather than somebody leaving. Both act strictly on the signed-in account:
 * there is no id parameter to tamper with, because the only account either
 * route will touch is the one the session names.
 */

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

    const user = getUserRow(session.email);
    if (!user) return json({ error: "No such account." }, 404);

    /*
     * Assembled by hand rather than by dumping rows, so that adding a column
     * somewhere does not silently start exporting it. Notably absent:
     * password_hash, and session or invite rows — a copy of your data should
     * not be a copy of your credentials, and an export lands in a downloads
     * folder or an inbox.
     */
    const payload = {
      exportedAt: new Date().toISOString(),
      account: {
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.created_at ?? null,
      },
      conversations: getThreads(session.email),
      decisions: getDecisions(session.email),
      checkins: getCheckins(session.email),
      /*
       * The working-style profile belongs in here and was missing.
       *
       * Assembling this by hand is right, because it stops a new column
       * exporting itself, but the same property means a whole new table stays
       * invisible until somebody remembers it. This one is the most personal
       * thing the product holds after the conversations, and every take is
       * included rather than only the latest, because the takes are the point.
       */
      workingStyle: {
        latest: getWorkingGenius(session.email),
        everyTake: listWorkingGeniusTakes(session.email),
      },
      deadlinesCompleted: getDeadlineCompletions(session.email),
      /* Library loans, for the same reason the working-style profile is here:
         a whole new table stays invisible in a hand-assembled export until
         somebody remembers it, and a record of what you borrowed and when is
         data about you. Returned loans are included; the history is the point. */
      booksBorrowed: getBookLoans(session.email),
      timesOpened: getVisits(session.email),
      note:
        "Conversations you deleted are not here. Encrypted backups may still " +
        "contain them for up to 30 days before rotating out.",
    };

    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="sprint-buddy-${session.email}.json"`,
      },
    });
  } catch (err) {
    reportError(err, { where: "account.GET" });
    return json({ error: "Could not build your export." }, 500);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const session = getSessionUser(cookies);
    if (!session) return json({ error: "Not signed in." }, 401);

    const read = await readJsonBody<{ action?: string; confirm?: unknown }>(request);
    if (!read.ok) return read.response;
    const body = read.value;

    if (body.action !== "delete") {
      return json({ error: `Unknown action: ${String(body.action)}` }, 400);
    }

    // Typing the address is the confirmation. A destructive, irreversible
    // action reached by a single POST is one a stray click can perform.
    if (typeof body.confirm !== "string" || body.confirm.trim().toLowerCase() !== session.email) {
      return json({ error: "Type your email address to confirm." }, 400);
    }

    // Locking every organizer out of the admin surface would leave nobody able
    // to invite one back in, and the database is the only way to recover from
    // that. Refuse rather than create it.
    if (session.role === "organizer" && countOrganizers() <= 1) {
      return json(
        { error: "You are the only organizer. Make someone else an organizer first." },
        409,
      );
    }

    recordAdminAction(session.email, "account:self-delete", null, session.email.slice(0, 120));
    deleteUser(session.email);
    // The row is gone, so the session it pointed at is too; clearing the
    // cookie stops the browser presenting a token that now resolves to
    // nothing on every subsequent request.
    endSession(cookies);

    return json({ ok: true });
  } catch (err) {
    reportError(err, { where: "account.POST" });
    return json({ error: "That did not work. Nothing was deleted." }, 500);
  }
};
