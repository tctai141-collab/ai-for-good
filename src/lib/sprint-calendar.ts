/**
 * Where the cohort is in the 15-week sprint.
 *
 * Prefers SPRINT_START_DATE (an ISO date, e.g. 2026-09-09), from which the
 * current week is derived automatically. SPRINT_WEEK remains as a manual
 * override for a cohort whose start date isn't configured — but it has to be
 * bumped by hand every week, and a forgotten bump silently drifts the advisor
 * out of step with the programme.
 */

export const TOTAL_WEEKS = 15;
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
export function isSprintDated(): boolean {
  return startDate() !== null;
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
