/**
 * Where the cohort is in the sprint.
 *
 * Prefers SPRINT_START_DATE (an ISO date, e.g. 2026-09-08), from which the
 * current week is derived automatically. SPRINT_WEEK remains as a manual
 * override for a cohort whose start date isn't configured — but it has to be
 * bumped by hand every week, and a forgotten bump silently drifts the advisor
 * out of step with the programme.
 */

/*
 * The length of the programme, in weeks.
 *
 * F26 runs Tuesday 8 September to Thursday 3 December 2026, which is 86 days:
 * twelve whole weeks and two days over. Counting the week of the 8th as week
 * one, the 3rd falls inside week thirteen, so thirteen is the number of weeks
 * the cohort is actually in.
 *
 * It was 15, from an earlier plan. Nothing broke on that — every API already
 * derives from this and sends it to the client — but the heatmap drew two
 * columns nobody could ever reach, week themes offered two rows that would
 * never be filled, and a deadline could be filed into a week after the end.
 *
 * Everything that shows a week count reads this or the totalWeeks the API
 * sends from it. Anything that hard-codes a number here is a bug waiting for
 * the next cohort with different dates.
 */
export const TOTAL_WEEKS = 13;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

function startDate(): Date | null {
  const raw = process.env.SPRINT_START_DATE?.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Which sprint week a moment falls in, 1-based.
 *
 * Returns null before the sprint starts or after it ends, so callers can tell
 * "outside the programme" apart from week 1.
 */
export function weekForDate(date: Date): number | null {
  const start = startDate();
  if (!start) return null;
  const week = Math.floor((date.getTime() - start.getTime()) / MS_PER_WEEK) + 1;
  if (week < 1 || week > TOTAL_WEEKS) return null;
  return week;
}

/**
 * Whether a start date is configured. Without one, check-ins cannot be placed
 * into sprint weeks, so the cohort heatmap has nothing meaningful to draw.
 */
/**
 * The configured start date as YYYY-MM-DD, or null when there isn't one.
 *
 * Sent to the browser so the programme timeline can group dated events into
 * sprint weeks itself. That is arithmetic on a public date, not a secret: the
 * cohort is told when the sprint starts on the day they are invited.
 */
export function sprintStartDate(): string | null {
  const start = startDate();
  return start ? start.toISOString().slice(0, 10) : null;
}

export function isSprintDated(): boolean {
  return startDate() !== null;
}

/**
 * Like weekForDate, but clamped into the programme instead of returning null.
 *
 * Founders use the app before the sprint formally begins — accounts are issued
 * ahead of the start date — and anything written then has no sprint week at
 * all. Dropping those signals meant a founder's themes were empty until the
 * start date passed, which reads as "nothing tracked" rather than "not started
 * yet". Anything before week 1 counts as week 1; anything after the end counts
 * as the final week.
 */
export function weekForDateClamped(date: Date): number | null {
  const start = startDate();
  if (!start) return null;
  const week = Math.floor((date.getTime() - start.getTime()) / MS_PER_WEEK) + 1;
  return Math.min(TOTAL_WEEKS, Math.max(1, week));
}

/** The cohort's current week, clamped to the programme's bounds. */
export function currentSprintWeek(): number {
  const start = startDate();
  if (start) {
    const week = Math.floor((Date.now() - start.getTime()) / MS_PER_WEEK) + 1;
    return Math.min(TOTAL_WEEKS, Math.max(1, week));
  }
  const manual = Number(process.env.SPRINT_WEEK || "1");
  return Number.isFinite(manual) ? Math.min(TOTAL_WEEKS, Math.max(1, manual)) : 1;
}
