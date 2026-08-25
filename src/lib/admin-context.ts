import {
  completedDeadlineIds, foundersBehindOn, getCohortCheckins, getOpenDecisionCounts,
  listAllDeadlines, listFounders, listProgrammeEvents, listProgrammeWeeks,
  listSharedThreads, listUsers, listWishesFor,
} from "../db/index";
import { currentSprintWeek, isSprintDated, TOTAL_WEEKS, weekForDate } from "./sprint-calendar";

/**
 * What the admin assistant is allowed to know.
 *
 * The brief was "knowledge of everything that happens inside the platform".
 * Taken literally that is a machine an organizer can ask "what did Aino write
 * in her check-in?" and get an answer from — which is the one thing this app
 * has promised founders it will never do. Every founder is told, on the screen
 * they type into, that nothing there is read by the team unless they hand it
 * over on purpose. An assistant that could read it would make that a lie, and
 * nobody would find out by looking at the interface.
 *
 * So the rule here is narrow and absolute: this assembles exactly what an
 * organizer can already read on /admin, and nothing else. Everything in this
 * file is a number, a name, a date, or a piece of text somebody wrote *to* the
 * operating team.
 *
 * What is deliberately not here, and why:
 *
 *   Check-in text. Organizers have never seen it. They see the 0-100 attention
 *   score the model produced and the one-word theme, which is what the cohort
 *   heatmap is built from, and that is what goes in.
 *
 *   Conversations. Not the founder's own, obviously — and not the bodies of
 *   the ones handed over either. Those are readable on the Shared tab, where
 *   opening one is recorded in the audit log and tells the founder it was
 *   read. An assistant that swallowed them would make both of those
 *   meaningless: the read would not be attributable and the founder would not
 *   be told. Titles and who shared them are enough to answer "has anybody
 *   shared anything", which is the question worth asking here.
 *
 *   Working-style answers. The same rule the consent dialog states: the
 *   profile is shared with the team, the written answers are not.
 */

export type AdminSnapshot = { text: string; founders: number };

function shortDate(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

/** A compact, readable brief. Text, because that is what a model reads best. */
export function buildAdminContext(): AdminSnapshot {
  const founders = listFounders();
  const week = currentSprintWeek();
  const dated = isSprintDated();

  const lines: string[] = [];

  lines.push(`THE COHORT`);
  lines.push(
    dated
      ? `Week ${week} of ${TOTAL_WEEKS}. ${founders.length} founders.`
      : `No sprint start date is configured, so there is no current week. ${founders.length} founders.`,
  );

  /*
   * Per founder: attention score by week, never a word they wrote. Same
   * numbers the heatmap draws, so the assistant and the grid cannot disagree.
   */
  const checkins = getCohortCheckins();
  const openDecisions = getOpenDecisionCounts();
  const byFounder = new Map<string, { scores: number[]; themes: string[]; last: string | null; count: number }>();
  for (const founder of founders) {
    byFounder.set(founder.email, { scores: [], themes: [], last: null, count: 0 });
  }
  for (const row of checkins) {
    const entry = byFounder.get(row.user_email);
    if (!entry) continue;
    entry.count++;
    entry.last = row.created_at;
    if (typeof row.mood === "number") entry.scores.push(row.mood);
    if (row.theme) entry.themes.push(row.theme);
  }

  if (founders.length) {
    lines.push("", "EACH FOUNDER (attention score is 0-100, higher means more worth a conversation)");
    for (const founder of founders) {
      const entry = byFounder.get(founder.email)!;
      const latest = entry.scores.length ? entry.scores[entry.scores.length - 1] : null;
      const themes = [...new Set(entry.themes)].slice(0, 3);
      lines.push(
        `- ${founder.name}: ${entry.count} check-ins` +
          (latest === null ? ", no score yet" : `, latest score ${latest}`) +
          (entry.last ? `, last on ${shortDate(entry.last)}` : ", never checked in") +
          (themes.length ? `, themes: ${themes.join(", ")}` : "") +
          (openDecisions[founder.email] ? `, ${openDecisions[founder.email]} open decisions` : ""),
      );
    }
  }

  const deadlines = listAllDeadlines().filter((d) => d.status === "active");
  if (deadlines.length) {
    lines.push("", "DEADLINES");
    for (const deadline of deadlines) {
      const behind = foundersBehindOn(deadline.id);
      const done = founders.length - behind.length;
      lines.push(
        `- "${deadline.title}" due ${deadline.due_date}: ${done}/${founders.length} done` +
          (behind.length ? `. Not done: ${behind.map((f) => f.name).join(", ")}` : ""),
      );
    }
  }

  const events = listProgrammeEvents();
  if (events.length) {
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = events.filter((e) => e.startsOn >= today).slice(0, 15);
    const past = events.filter((e) => e.startsOn < today).length;
    lines.push("", `PROGRAMME (${events.length} entries, ${past} already happened)`);
    for (const event of upcoming) {
      lines.push(
        `- ${event.startsOn}${event.startTime ? ` ${event.startTime}` : " all day"}: ` +
          `${event.title} [${event.kind}]${event.location ? ` — ${event.location}` : ""}`,
      );
    }
    if (!upcoming.length) lines.push("Nothing upcoming.");
  }

  const weeks = listProgrammeWeeks().filter((w) => w.title || w.phase);
  if (weeks.length) {
    lines.push("", "WEEK THEMES");
    for (const entry of weeks) {
      lines.push(`- Week ${entry.week}: ${[entry.phase, entry.title].filter(Boolean).join(" — ")}`);
    }
  }

  const wishes = listWishesFor(["organizers", "mentors"]);
  if (wishes.length) {
    lines.push("", "WHAT THE COHORT HAS ASKED FOR");
    for (const wish of wishes.slice(0, 25)) {
      lines.push(
        `- ${wish.fromName} to the ${wish.audience} (${shortDate(wish.createdAt)}, ${wish.status}): ${wish.body}` +
          (wish.replies.length ? ` [answered: ${wish.replies.map((r) => r.body).join(" / ")}]` : ""),
      );
    }
  }

  /* Titles only. See the note at the top of this file. */
  const shared = listSharedThreads();
  if (shared.length) {
    lines.push("", "CONVERSATIONS HANDED TO THE TEAM (titles only — open them on the Shared tab to read)");
    for (const thread of shared.slice(0, 20)) {
      lines.push(
        `- ${thread.founderName}: "${thread.title}"` +
          (thread.shared_seen_at ? "" : " (nobody has opened it yet)"),
      );
    }
  }

  const staff = listUsers().filter((u) => u.role !== "founder");
  if (staff.length) {
    lines.push("", "THE OPERATING TEAM");
    for (const person of staff) lines.push(`- ${person.name} (${person.role})`);
  }

  const pending = listUsers().filter((u) => !u.activated);
  if (pending.length) {
    lines.push("", `NOT SET UP YET: ${pending.map((u) => u.name).join(", ")}`);
  }

  return { text: lines.join("\n"), founders: founders.length };
}

/** Which sprint week a check-in landed in, for callers that need it. */
export function weekOfCheckin(created: string): number | null {
  return weekForDate(new Date(created));
}

/** Deadlines a given founder has ticked off. Exposed for the same brief. */
export function doneByFounder(email: string): string[] {
  return completedDeadlineIds(email);
}

export const ADMIN_ASSISTANT_SYSTEM = `You are the operating team's assistant inside Sprint Buddy, the app the Aalto Founder Sprint runs on. You help organizers run the programme: who to talk to, what is due, what is on, what the cohort has asked for.

WHAT YOU KNOW
Everything you know is in the briefing below. It is a snapshot taken when this message was sent. If something is not in it, say so plainly rather than guessing — "that is not in what I can see" is a useful answer and a made-up one is not.

WHAT YOU CANNOT SEE, AND MUST NOT PRETEND TO
You cannot read founders' conversations with Sprint Buddy, or the text of their check-ins, or their working-style answers. Those are private to each founder and the team has never had access to them. You see attention scores, themes, dates and counts.

If somebody asks what a founder wrote, said, or is feeling in their own words, tell them you cannot see that and that it is private by design. Do not infer it from the score and present the inference as fact. You may say "her last score was 82, which is high" — you may not say "she is struggling with her cofounder" unless that is written in the briefing.

Conversations a founder handed over are on the Shared tab. You see their titles, not their contents. Point people there rather than summarising something you cannot read.

HOW TO ANSWER
Short. Concrete. Lead with the answer. Names and numbers, not hedging.
Where an answer implies an action somebody should take, say what it is in one line.
No preamble, no restating the question, no closing summary.`;
