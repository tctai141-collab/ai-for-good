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
 * **A deadline with a time falls due at that time.** Only a deadline without one
 * runs to the end of the day. This grouped everything by date alone while the
 * reminder scheduler already honoured `due_time`, so the two disagreed about the
 * same row: a deadline set for 09:00 sent its overdue mail on the real schedule
 * while the founder's own tracker still showed it as due this week. Whichever
 * behaviour is right, the founder cannot be told both.
 *
 * **Grouping is by due date, not sprint week.** `sprint_week` is nullable and
 * exists as a display label; using it to group would leave untagged deadlines in
 * no group at all, and would disagree with the due date whenever a week-2 item
 * happens to fall in calendar week 3.
 */

export type DeadlineGroup = "overdue" | "thisWeek" | "upcoming" | "done";

/**
 * Finland is UTC+2, or UTC+3 under summer time (late March to late October).
 *
 * Exported so the reminder scheduler shares this one rather than keeping the
 * copy it had. Two identical implementations of a clock rule is one of them
 * waiting to be edited alone.
 */
export function helsinkiOffsetHours(date: Date): number {
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
 * The instant a deadline actually falls due, as a UTC timestamp.
 *
 * With a `due_time` that is HH:MM Helsinki on the due date. Without one it is
 * 23:59:59.999 Helsinki, which is what every deadline written before the column
 * existed meant, and what the organizer sees when they leave the time box empty.
 *
 * The offset is read from the candidate instant rather than from midnight, so a
 * deadline on the day the clocks change is counted from correctly instead of
 * expiring an hour early.
 */
export function dueInstant(dueDate: string, dueTime: string | null = null): number {
  const [y, m, d] = dueDate.split("-").map(Number);
  if (!y || !m || !d) return Number.NaN;

  const [hh, mm] = (dueTime ?? "23:59").split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return Number.NaN;

  // No time means the *end* of 23:59, not the start of it.
  const naive = Date.UTC(y, m - 1, d, hh, mm) + (dueTime ? 0 : 60_000 - 1);
  return naive - helsinkiOffsetHours(new Date(naive)) * 60 * 60 * 1000;
}

/** Local calendar day in Helsinki, as a day number, for "same day" comparisons. */
function helsinkiDayNumber(at: number): number {
  const offset = helsinkiOffsetHours(new Date(at));
  return Math.floor((at + offset * 60 * 60 * 1000) / (24 * 60 * 60 * 1000));
}

/**
 * `dueTime` is last and optional so the many callers that have only a date stay
 * as they are. Every caller that holds a row should pass it.
 */
export function groupFor(
  dueDate: string,
  done: boolean,
  now: number = Date.now(),
  dueTime: string | null = null,
): DeadlineGroup {
  if (done) return "done";
  const due = dueInstant(dueDate, dueTime);
  if (Number.isNaN(due)) return "upcoming";
  if (now > due) return "overdue";
  // "This week" is the next seven days, inclusive of today.
  const daysAway = helsinkiDayNumber(due) - helsinkiDayNumber(now);
  return daysAway <= 6 ? "thisWeek" : "upcoming";
}

export type ProgressInput = { dueDate: string; done: boolean; dueTime?: string | null };

/**
 * "You've completed X of Y."
 *
 * Y counts only what is actually due — overdue or falling this week — plus
 * anything already finished ahead of time, so working early raises the ratio
 * instead of lowering it.
 *
 * Counting the whole 13-week sprint would show a founder "1 of 13" in week one
 * and read as permanent failure. The cohort heatmap had exactly this bug —
 * everyone flagged as needing attention before the sprint began — and it was
 * fixed there for the same reason.
 */
export function progressFor(items: ProgressInput[], now: number = Date.now()) {
  const counted = items.filter((item) => {
    if (item.done) return true;
    const group = groupFor(item.dueDate, false, now, item.dueTime ?? null);
    return group === "overdue" || group === "thisWeek";
  });

  return {
    completed: counted.filter((item) => item.done).length,
    total: counted.length,
  };
}
