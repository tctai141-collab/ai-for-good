import type { APIRoute } from "astro";
import {
  getCohortCheckins,
  getOpenDecisionCounts,
  listFounders,
} from "../../db/index";
import { getSessionUser } from "../../lib/auth";
import { TOTAL_WEEKS, currentSprintWeek, isSprintDated, weekForDate } from "../../lib/sprint-calendar";

/**
 * The operating team's cohort view.
 *
 * Replaces the hackathon's eight hardcoded fictional founders with the real
 * cohort. Everything here is derived from check-in signals — theme, the 0-100
 * attention score, and timing. No conversation text and no check-in summaries
 * cross this boundary, matching the rule enforced in persistence.ts.
 */

/**
 * Temperature buckets, matching the heatmap the dashboard already draws:
 *   0 = no check-in that week  1 = stable  2 = monitor  3 = needs attention
 *
 * Zero is not "fine" — a founder who stops checking in is the case worth
 * noticing, so the UI colours 0 the same as 3.
 */
function bucket(score: number | null): number {
  if (score == null) return 1;
  if (score >= 70) return 3;
  if (score >= 40) return 2;
  return 1;
}

type Trend = "tenser" | "calmer" | "steady" | "quiet";

/**
 * Compares the two most recent weeks that have data against the two before
 * them. Needs at least three weeks of signal before claiming a direction —
 * otherwise a single tough week reads as a trend.
 */
function trendFrom(weekly: (number | null)[], weeksSinceCheckin: number | null): Trend {
  if (weeksSinceCheckin === null || weeksSinceCheckin >= 2) return "quiet";

  const withData = weekly
    .map((score, index) => ({ score, index }))
    .filter((entry): entry is { score: number; index: number } => entry.score !== null);

  if (withData.length < 3) return "steady";

  const recent = withData.slice(-2);
  const earlier = withData.slice(-4, -2);
  if (earlier.length === 0) return "steady";

  const mean = (xs: { score: number }[]) => xs.reduce((a, b) => a + b.score, 0) / xs.length;
  const delta = mean(recent) - mean(earlier);

  if (delta >= 12) return "tenser";
  if (delta <= -12) return "calmer";
  return "steady";
}

/**
 * A factual opening line for the coach. Deliberately derived from signals
 * rather than generated — an invented narrative about someone's private
 * conversations is exactly what this dashboard must not produce.
 */
function openWith(
  latestScore: number | null,
  theme: string | null,
  daysSince: number | null,
  trend: Trend,
  openDecisions: number,
): string {
  const parts: string[] = [];

  if (daysSince === null) {
    return "No check-ins yet. Worth confirming they can sign in.";
  }
  if (daysSince >= 14) {
    parts.push(`Quiet for ${daysSince} days — the silence is the signal.`);
  } else if (daysSince >= 7) {
    parts.push(`Last check-in ${daysSince} days ago.`);
  }

  if (latestScore != null && latestScore >= 70) {
    parts.push(`Latest signal is high (${latestScore}/100).`);
  } else if (trend === "tenser") {
    parts.push("Attention score rising over recent weeks.");
  } else if (trend === "calmer") {
    parts.push("Settling — scores easing off.");
  }

  if (theme) parts.push(`Recurring theme: ${theme}.`);
  if (openDecisions > 0) {
    parts.push(`${openDecisions} open decision${openDecisions === 1 ? "" : "s"} unresolved.`);
  }

  return parts.length ? parts.join(" ") : "Steady. Nothing flagged this week.";
}

export const GET: APIRoute = async ({ cookies }) => {
  const session = getSessionUser(cookies);
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  if (session.role !== "organizer") {
    return Response.json({ error: "Organizers only." }, { status: 403 });
  }

  const founders = listFounders();
  const checkins = getCohortCheckins();
  const openDecisions = getOpenDecisionCounts();
  const week = currentSprintWeek();
  const now = Date.now();

  const byFounder = new Map<string, typeof checkins>();
  for (const row of checkins) {
    const list = byFounder.get(row.user_email) ?? [];
    list.push(row);
    byFounder.set(row.user_email, list);
  }

  const teams = founders.map((founder) => {
    const rows = byFounder.get(founder.email) ?? [];

    // Highest score per sprint week — the worst moment matters more than an
    // average that a good day could mask.
    const weekly: (number | null)[] = Array(TOTAL_WEEKS).fill(null);
    for (const row of rows) {
      const at = new Date(row.created_at.replace(" ", "T") + "Z");
      const index = weekForDate(at);
      if (index === null) continue;
      const score = row.mood ?? null;
      if (score === null) continue;
      const existing = weekly[index - 1] ?? null;
      weekly[index - 1] = existing === null ? score : Math.max(existing, score);
    }

    const latest = rows.length ? rows[rows.length - 1]! : null;
    const latestAt = latest ? new Date(latest.created_at.replace(" ", "T") + "Z") : null;
    const daysSince = latestAt
      ? Math.floor((now - latestAt.getTime()) / (24 * 60 * 60 * 1000))
      : null;
    const weeksSince = daysSince === null ? null : Math.floor(daysSince / 7);
    const trend = trendFrom(weekly, weeksSince);

    // Most frequent theme across all their check-ins.
    const themeCounts = new Map<string, number>();
    for (const row of rows) {
      if (!row.theme || row.theme === "checkin" || row.theme === "—") continue;
      themeCounts.set(row.theme, (themeCounts.get(row.theme) ?? 0) + 1);
    }
    const theme =
      [...themeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    // A missing check-in only counts against someone once the week is over
    // and they were actually in the cohort for it. Without this, everyone
    // reads as "needs attention" on day one, and rows go red for weeks that
    // happened before the person was even invited — noise that trains the
    // team to ignore the colour.
    const joinedAt = founder.created_at
      ? new Date(founder.created_at.replace(" ", "T") + "Z")
      : null;
    const accountWeek = joinedAt ? weekForDate(joinedAt) ?? 1 : 1;
    // Take the earlier of "account created" and "first check-in seen", so
    // imported or backdated history isn't silently ignored.
    const firstSignalWeek = weekly.findIndex((score) => score !== null) + 1;
    const joinedWeek = firstSignalWeek > 0 ? Math.min(accountWeek, firstSignalWeek) : accountWeek;

    return {
      id: founder.email,
      name: founder.name,
      email: founder.email,
      temp: weekly.map((score, index) => {
        const weekNumber = index + 1;
        if (score !== null) return bucket(score);
        const isPast = weekNumber < week;
        const wasEnrolled = weekNumber >= joinedWeek;
        return isPast && wasEnrolled ? 0 : 1;
      }),
      trend,
      theme: theme ?? "—",
      checkinCount: rows.length,
      lastCheckinDaysAgo: daysSince,
      openDecisions: openDecisions[founder.email] ?? 0,
      openWith: openWith(
        latest?.mood ?? null,
        theme,
        daysSince,
        trend,
        openDecisions[founder.email] ?? 0,
      ),
    };
  });

  // Judged on the most recently completed week, not the one still running.
  const settledWeek = Math.max(1, week - 1);
  const needAttention = teams.filter((t) => {
    const value = t.temp[settledWeek - 1] ?? 1;
    return value >= 2 || value === 0;
  }).length;

  return Response.json({
    week,
    totalWeeks: TOTAL_WEEKS,
    teams,
    needAttention,
    // Lets the UI say "no cohort yet" rather than drawing an empty grid.
    cohortSize: founders.length,
    // False means SPRINT_START_DATE is unset, so check-ins cannot be placed
    // into weeks and the grid would be misleading rather than merely empty.
    startDateConfigured: isSprintDated(),
  });
};
