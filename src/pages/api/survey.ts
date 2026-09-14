import type { APIRoute } from "astro";
import {
  deleteSurveyRound, getSurveyRound, hasSubmittedSurvey, listSurveyRounds,
  nextSurveyRound, openSurveyRound, recordAdminAction, saveSurveyRound,
  submitSurvey, surveyResponseCount, surveyResults,
  type SurveyGroupInput, type SurveyRound,
} from "../../db/index";
import { getSessionUser } from "../../lib/auth";
import { dueInstant } from "../../lib/deadlines";
import { reportError } from "../../lib/errors";
import { adminWriteLimiter, cap, readJsonBody, tooMany } from "../../lib/limits";

/**
 * Surveys: Roman's research questionnaire, taken inside Sprint Buddy.
 *
 * Who does what:
 *   founder   — takes the round that is open, once
 *   organizer — reads every answer, creates and edits rounds
 *   mentor    — nothing. Answers are personal research data and the decision
 *               was organizers only.
 *
 * Answers are final. There is no editing a submission: this is research data,
 * and a score changed after the fact is a different measurement.
 */

const MAX_TITLE = 200;
const MAX_INTRO = 4_000;
const MAX_HEADING = 300;
const MAX_LABEL = 80;
const MAX_STATEMENT = 500;
const MAX_GROUPS = 10;
const MAX_ITEMS = 40;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/* What a founder is shown: the questions, never anybody's answers. */
function forFounder(round: SurveyRound) {
  return {
    id: round.id, title: round.title, intro: round.intro,
    opensAt: round.opensAt, closesAt: round.closesAt, groups: round.groups,
  };
}

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const session = getSessionUser(cookies);
    if (!session) return json({ error: "Not signed in." }, 401);
    const now = new Date().toISOString();

    if (session.role === "organizer") {
      return json({
        rounds: listSurveyRounds().map((round) => {
          const responses = surveyResponseCount(round.id);
          return { ...round, responses, locked: responses > 0, results: surveyResults(round.id) };
        }),
        openRoundId: openSurveyRound(now)?.id ?? null,
      });
    }

    if (session.role !== "founder") return json({ error: "Organizers only." }, 403);

    const round = openSurveyRound(now);
    return json({
      round: round ? forFounder(round) : null,
      submitted: round ? hasSubmittedSurvey(round.id, session.email) : false,
      next: round ? null : nextSurveyRound(now),
    });
  } catch (error) {
    reportError(error, { where: "survey.GET" });
    return json({ error: "Could not load the survey." }, 500);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const session = getSessionUser(cookies);
    if (!session) return json({ error: "Not signed in." }, 401);

    const read = await readJsonBody<Record<string, unknown>>(request);
    if (!read.ok) return read.response;
    const body = read.value;

    if (body.action === "submit") return submit(session, body);

    if (session.role !== "organizer") return json({ error: "Organizers only." }, 403);
    const limited = adminWriteLimiter.check(session.email);
    if (limited) return tooMany(limited.retryAfterSeconds);

    if (body.action === "save-round") return saveRound(session, body);
    if (body.action === "clone-round") return cloneRound(session);
    if (body.action === "delete-round") return removeRound(session, body);
    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    reportError(error, { where: "survey.POST" });
    return json({ error: "That did not save." }, 500);
  }
};

function submit(session: { email: string; role: string }, body: Record<string, unknown>): Response {
  if (session.role !== "founder") return json({ error: "Only founders take the survey." }, 403);
  if (typeof body.roundId !== "string" || !body.roundId) return json({ error: "roundId required." }, 400);

  const round = getSurveyRound(body.roundId);
  if (!round) return json({ error: "No such survey." }, 404);

  /*
   * 423 rather than 403, as the check-in hold does: this is not about who they
   * are, and it stops being true at a known moment. Checked before the answers
   * are looked at, so a tab left open after the meeting gets the reason and not
   * a validation error.
   */
  const now = Date.now();
  const opens = round.opensAt ? Date.parse(round.opensAt) : NaN;
  const closes = round.closesAt ? Date.parse(round.closesAt) : NaN;
  if (!(now >= opens && now < closes)) {
    return json(
      {
        error: now < opens ? "This survey has not opened yet." : "This survey is closed.",
        opensAt: round.opensAt, closesAt: round.closesAt,
      },
      423,
    );
  }

  if (hasSubmittedSurvey(round.id, session.email)) {
    return json({ error: "You have already answered this one." }, 409);
  }

  const raw = body.answers;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return json({ error: "answers required." }, 400);
  }
  const given = raw as Record<string, unknown>;
  const itemIds = round.groups.flatMap((g) => g.items.map((i) => i.id));
  const known = new Set(itemIds);

  /* Every question is required, as it was in Webropol. A half-answered scale is
     not a score, and an unknown id is a client that is out of date. */
  for (const key of Object.keys(given)) {
    if (!known.has(key)) return json({ error: "That answers a question this survey does not have." }, 400);
  }
  const answers: Record<string, number> = {};
  for (const id of itemIds) {
    const value = given[id];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) {
      return json({ error: "Every question needs an answer from 1 to 5." }, 400);
    }
    answers[id] = value;
  }

  submitSurvey(round.id, session.email, answers);
  return json({ ok: true });
}

/** YYYY-MM-DD plus HH:MM, Helsinki, to a UTC instant — or null for both empty. */
function windowFrom(body: Record<string, unknown>): { opensAt: string | null; closesAt: string | null } | string {
  const parts = ["opensOn", "opensTime", "closesOn", "closesTime"].map((k) => cap(body[k], 10).trim());
  if (parts.every((p) => !p)) return { opensAt: null, closesAt: null };
  if (parts.some((p) => !p)) return "Give both an opening and a closing date and time, or neither.";
  const [opensOn, opensTime, closesOn, closesTime] = parts as [string, string, string, string];
  if (![opensOn, closesOn].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) return "Dates must be YYYY-MM-DD.";
  if (![opensTime, closesTime].every((t) => /^\d{2}:\d{2}$/.test(t))) return "Times must be HH:MM.";
  const opens = dueInstant(opensOn, opensTime);
  const closes = dueInstant(closesOn, closesTime);
  if (!Number.isFinite(opens) || !Number.isFinite(closes)) return "That date or time does not exist.";
  if (closes <= opens) return "The survey has to close after it opens.";
  return { opensAt: new Date(opens).toISOString(), closesAt: new Date(closes).toISOString() };
}

function groupsFrom(raw: unknown): SurveyGroupInput[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return "A survey needs at least one group of questions.";
  if (raw.length > MAX_GROUPS) return `At most ${MAX_GROUPS} groups.`;
  const groups: SurveyGroupInput[] = [];
  for (const g of raw) {
    if (!g || typeof g !== "object") return "Each group needs a heading, scale labels and statements.";
    const group = g as Record<string, unknown>;
    const heading = cap(group.heading, MAX_HEADING).trim();
    const lowLabel = cap(group.lowLabel, MAX_LABEL).trim();
    const highLabel = cap(group.highLabel, MAX_LABEL).trim();
    if (!heading || !lowLabel || !highLabel) return "Each group needs a heading and both scale labels.";
    if (!Array.isArray(group.items)) return "Each group needs statements.";
    const items = group.items.map((i) => cap(i, MAX_STATEMENT).trim()).filter(Boolean);
    if (items.length === 0) return "Each group needs at least one statement.";
    if (items.length > MAX_ITEMS) return `At most ${MAX_ITEMS} statements in a group.`;
    groups.push({ heading, lowLabel, highLabel, items });
  }
  return groups;
}

/* The questions as a comparable value, to tell a question edit from a title edit. */
function questionsKey(groups: { heading: string; lowLabel: string; highLabel: string; items: (string | { statement: string })[] }[]) {
  return JSON.stringify(groups.map((g) => [g.heading, g.lowLabel, g.highLabel, g.items.map((i) => (typeof i === "string" ? i : i.statement))]));
}

function saveRound(session: { email: string }, body: Record<string, unknown>): Response {
  const title = cap(body.title, MAX_TITLE).trim();
  if (!title) return json({ error: "The survey needs a title." }, 400);
  const intro = cap(body.intro, MAX_INTRO).trim();

  const window = windowFrom(body);
  if (typeof window === "string") return json({ error: window }, 400);

  const groups = groupsFrom(body.groups);
  if (typeof groups === "string") return json({ error: groups }, 400);

  const id = typeof body.id === "string" && body.id ? body.id : crypto.randomUUID();
  const existing = typeof body.id === "string" && body.id ? getSurveyRound(body.id) : null;
  if (typeof body.id === "string" && body.id && !existing) return json({ error: "No such survey." }, 404);

  /*
   * Questions lock once anybody has answered.
   *
   * The title and the window can still move — extending a window by ten
   * minutes because the meeting ran long is ordinary. Changing a statement is
   * not: the answers already given were to the old wording, and the table would
   * show them against the new one.
   */
  let replaceQuestions = true;
  if (existing) {
    const sameQuestions = questionsKey(existing.groups) === questionsKey(groups);
    if (surveyResponseCount(existing.id) > 0) {
      if (!sameQuestions) {
        return json({ error: "Questions are locked once anyone has answered. Make a new round instead." }, 409);
      }
      replaceQuestions = false;
    } else if (sameQuestions) {
      replaceQuestions = false;
    }
  }

  saveSurveyRound({ id, title, intro, ...window }, replaceQuestions ? groups : null, session.email);
  recordAdminAction(session.email, "survey:save", null, id);
  return json({ ok: true, id });
}

/** A new draft round with the last round's questions, ready to rename and schedule. */
function cloneRound(session: { email: string }): Response {
  const rounds = listSurveyRounds().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const source = rounds[0];
  if (!source) return json({ error: "There is no round to copy yet." }, 404);
  const id = crypto.randomUUID();
  saveSurveyRound(
    { id, title: `${source.title} (copy)`, intro: source.intro, opensAt: null, closesAt: null },
    source.groups.map((g) => ({
      heading: g.heading, lowLabel: g.lowLabel, highLabel: g.highLabel,
      items: g.items.map((i) => i.statement),
    })),
    session.email,
  );
  recordAdminAction(session.email, "survey:clone", null, `${source.id} -> ${id}`);
  return json({ ok: true, id });
}

function removeRound(session: { email: string }, body: Record<string, unknown>): Response {
  if (typeof body.id !== "string" || !body.id) return json({ error: "id required." }, 400);
  if (!getSurveyRound(body.id)) return json({ error: "No such survey." }, 404);
  /* A round with answers is part of the study's record, not a draft to tidy. */
  if (surveyResponseCount(body.id) > 0) {
    return json({ error: "This round has answers, so it stays." }, 409);
  }
  deleteSurveyRound(body.id);
  recordAdminAction(session.email, "survey:delete", null, body.id);
  return json({ ok: true });
}
