import { dueInstant } from "./deadlines";

/**
 * When a borrowed book is due back, and whether it is late.
 *
 * Deliberately thin, and deliberately built on the deadline tracker's own
 * `dueInstant` rather than a second copy of the same idea. "Overdue" has to
 * mean one thing in this app: end of day in Helsinki, on the far side of the
 * October clock change as much as in September. The deadline tracker and the
 * reminder scheduler had two implementations of that between them once, and
 * disagreed about the same row in front of a founder. One function is what
 * stops that happening again.
 *
 * Imports nothing but ./deadlines, which imports nothing at all, so a test can
 * read this without dragging the database module into the runner's process.
 */

/**
 * Four weeks.
 *
 * Long enough to actually read a business book alongside a sprint, short
 * enough that it comes back inside the fifteen-week programme. Organizers can
 * move any individual loan's date; this is only where it starts.
 */
export const LOAN_DAYS = 28;

export type LoanState = "out" | "dueSoon" | "overdue" | "returned";

/** How close to the due date counts as "due soon" on the shelf. */
const DUE_SOON_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The due date for a loan starting on `borrowedAt`, as YYYY-MM-DD.
 *
 * Date arithmetic in UTC on purpose. The result is a calendar date, and
 * `dueInstant` is what later turns it into the actual Helsinki moment, so
 * doing the day maths in local time here would apply the offset twice.
 */
export function dueDateFor(borrowedAt: Date = new Date(), days = LOAN_DAYS): string {
  return new Date(borrowedAt.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Where a loan stands right now.
 *
 * `returnedAt` wins over everything: a book that came back late is returned,
 * not overdue. Nobody needs to be chased for a book already on the shelf.
 */
export function loanStateFor(
  dueDate: string,
  returnedAt: string | null,
  now: number = Date.now(),
): LoanState {
  if (returnedAt) return "returned";

  const due = dueInstant(dueDate);
  if (Number.isNaN(due)) return "out";
  if (now > due) return "overdue";
  return due - now <= DUE_SOON_DAYS * DAY_MS ? "dueSoon" : "out";
}

/** Whether a loan should still be chased. Returned books never are. */
export function isOutstanding(returnedAt: string | null): boolean {
  return returnedAt === null;
}
