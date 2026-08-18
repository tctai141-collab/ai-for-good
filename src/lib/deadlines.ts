/**
 * Deadline grouping and progress.
 *
 * Two decisions are encoded here that are easy to get subtly wrong.
 *
 * **Overdue is end-of-day in Helsinki, not UTC.** The server runs UTC and every
 * founder is in Finland, so comparing raw dates would turn a Friday deadline red
 * at 03:00 on Saturday local time — technically defensible, visibly wrong to the
 * person looking at it.
 *
 * **Grouping is by due date, not sprint week.** `sprint_week` is nullable and
 * exists as a display label; using it to group would leave untagged deadlines in
 * no group at all, and would disagree with the due date whenever a week-2 item
 * happens to fall in calendar week 3.
 */

export type DeadlineGroup = "overdue" | "thisWeek" | "upcoming" | "done";

/** Finland is UTC+2, or UTC+3 under summer time (late March to late October). */
function helsinkiOffsetHours(date: Date): number {
  const year = date.getUTCFullYear();
  // EU summer time: last Sunday in March 01:00 UTC to last Sunday in October 01:00 UTC.
  const lastSunday = (month: number) => {
    const d = new Date(Date.UTC(year, month + 1, 0));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    d.setUTCHours(1, 0, 0, 0);
    return d;
  };
  return date >= lastSunday(2) && date < lastSunday(9) ? 3 : 2;
}

/**
 * The instant a deadline stops being "today" — 23:59:59.999 Helsinki on its due
 * date, expressed as a UTC timestamp.
 */
export function dueInstant(dueDate: string): number {
  const [y, m, d] = dueDate.split("-").map(Number);
  if (!y || !m || !d) return Number.NaN;
  // Start from midnight UTC to work out which offset applies, then subtract it.
  const midnightUtc = Date.UTC(y, m - 1, d);
  const offset = helsinkiOffsetHours(new Date(midnightUtc));
  return midnightUtc + 24 * 60 * 60 * 1000 - offset * 60 * 60 * 1000 - 1;
}

/** Local calendar day in Helsinki, as a day number, for "same day" comparisons. */
function helsinkiDayNumber(at: number): number {
  const offset = helsinkiOffsetHours(new Date(at));
  return Math.floor((at + offset * 60 * 60 * 1000) / (24 * 60 * 60 * 1000));
}

export function groupFor(
  dueDate: string,
  done: boolean,
  now: number = Date.now(),
): DeadlineGroup {
  if (done) return "done";
  const due = dueInstant(dueDate);
  if (Number.isNaN(due)) return "upcoming";
  if (now > due) return "overdue";
  // "This week" is the next seven days, inclusive of today.
  const daysAway = helsinkiDayNumber(due) - helsinkiDayNumber(now);
  return daysAway <= 6 ? "thisWeek" : "upcoming";
}

export type ProgressInput = { dueDate: string; done: boolean };

/**
 * "You've completed X of Y."
 *
 * Y counts only what is actually due — overdue or falling this week — plus
 * anything already finished ahead of time, so working early raises the ratio
 * instead of lowering it.
 *
 * Counting the whole 15-week sprint would show a founder "1 of 15" in week one
 * and read as permanent failure. The cohort heatmap had exactly this bug —
 * everyone flagged as needing attention before the sprint began — and it was
 * fixed there for the same reason.
 */
export function progressFor(items: ProgressInput[], now: number = Date.now()) {
  const counted = items.filter((item) => {
    if (item.done) return true;
    const group = groupFor(item.dueDate, false, now);
    return group === "overdue" || group === "thisWeek";
  });

  return {
    completed: counted.filter((item) => item.done).length,
    total: counted.length,
  };
}
