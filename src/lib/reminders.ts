import {
  pendingReminders,
  recordReminder,
  type PendingReminder,
  type ReminderKind,
} from "../db/index";
import {
  dueInstant as trackerDueInstant,
  helsinkiOffsetHours,
} from "./deadlines";
import { isEmailConfigured, sendDeadlineReminder } from "./email";
import { reportError } from "./errors";
import { APP_URL_UNSET, configuredAppUrl } from "./appUrl";

/**
 * Deadline reminders.
 *
 * The benchmark work behind the tracker is unambiguous that visible shared
 * deadlines drive completion, and that the nudge is most of the effect. This is
 * that nudge — and the whole design problem is not sending too many.
 *
 * Four moments, once each, per founder per deadline:
 *
 *   DUE-3D    three days out, while the work can still be planned.
 *   DUE-2D    two days out.
 *   DUE-10H   ten hours out. The last call, and the only one that depends on
 *             the time of day rather than the date.
 *   OVERDUE   the day after, once, when the date has actually passed.
 *
 * This was one nudge the day before, and the comment here used to argue that
 * one was the right number. Tai asked for the fuller cadence with the tradeoff
 * in front of him, so the risk is now on the record instead: four emails per
 * deadline per founder, and a sprint week with three deadlines is twelve
 * emails. If founders start filtering them, this is the first thing to cut
 * back, and DUE-2D is the one to cut because it sits a single day from DUE-3D.
 *
 * What has not changed is that finishing the work stops all of it. Every query
 * excludes founders with a completion row, so ticking a deadline off silences
 * every reminder still to come for it.
 *
 * A founder who ignores all four hears nothing further about that milestone.
 * The primary key on deadline_reminders is what enforces this, not a flag
 * somebody has to remember to check, and not the scheduler running exactly
 * once.
 *
 * Timing is computed in Helsinki, matching the tracker: the server is UTC and
 * every founder is in Finland, so "tomorrow" has to mean their tomorrow.
 */

/** The calendar date in Helsinki, offset by whole days, as YYYY-MM-DD. */
export function helsinkiDate(now: Date, dayOffset = 0): string {
  const shifted = new Date(now.getTime() + helsinkiOffsetHours(now) * 60 * 60 * 1000);
  shifted.setUTCDate(shifted.getUTCDate() + dayOffset);
  return shifted.toISOString().slice(0, 10);
}

/** The hour of the day in Helsinki, 0 to 23. */
export function helsinkiHour(now: Date): number {
  return (now.getUTCHours() + helsinkiOffsetHours(now)) % 24;
}

/**
 * The instant a deadline actually falls due.
 *
 * Delegated to the tracker's own answer rather than worked out again here. This
 * file had its own copy, and the tracker had a third behaviour: it ignored
 * `due_time` entirely. So a deadline set for 09:00 was overdue enough to mail
 * about and not overdue enough to show as late. Sharing one function is what
 * makes the mail and the screen agree by construction.
 */
export function dueInstant(dueDate: string, dueTime: string | null): Date {
  return new Date(trackerDueInstant(dueDate, dueTime));
}

/*
 * This never read a request header, which was the right call — the admin
 * route's version did, and that was a real hole. But the hardcoded fallback is
 * its own quiet failure: if PUBLIC_BASE_URL is unset and that domain is not
 * where this deployment actually lives, every reminder in the cohort carries a
 * link to a page that does not exist, and nothing anywhere says so.
 *
 * Configured value or nothing, same as everywhere else. A run with no
 * configured origin is skipped and reported rather than sent with a bad link:
 * reminders repeat, so a skipped morning costs one nudge, where a wrong link
 * costs the cohort's trust in the mail.
 */
function appUrl(): string | null {
  return configuredAppUrl();
}

/** Nothing date-based goes out before this hour, Helsinki. */
const SEND_HOUR_HELSINKI = 8;

/** How far ahead of the deadline itself the last call opens. */
const LAST_CALL_HOURS = 10;

export type ReminderRun = { sent: number; failed: number; skipped: string | null };

/**
 * Sends everything due to go out right now. Safe to call repeatedly.
 *
 * Each send is recorded only after it succeeds, so a provider outage means the
 * reminder is retried on the next run rather than silently lost. The inverse —
 * recording first — would turn one failed request into a founder who is never
 * told.
 */
export async function runReminders(now = new Date()): Promise<ReminderRun> {
  if (!isEmailConfigured()) {
    return { sent: 0, failed: 0, skipped: "email is not configured" };
  }

  const jobs: { kind: ReminderKind; row: PendingReminder }[] = [];

  /*
   * The date-based three, held back until the founder's day has started. The
   * scheduler checks every hour so that the ten-hour nudge can be timed, and
   * without this gate the three-day warning would go out in the first tick
   * after midnight, which is when the Helsinki date rolls over.
   */
  if (helsinkiHour(now) >= SEND_HOUR_HELSINKI) {
    const daily: { kind: ReminderKind; dueDate: string }[] = [
      { kind: "due-3d", dueDate: helsinkiDate(now, 3) },
      { kind: "due-2d", dueDate: helsinkiDate(now, 2) },
      { kind: "overdue", dueDate: helsinkiDate(now, -1) },
    ];
    for (const { kind, dueDate } of daily) {
      for (const row of pendingReminders(kind, dueDate)) jobs.push({ kind, row });
    }
  }

  /*
   * The last call, ten hours out.
   *
   * Both today and tomorrow are scanned because ten hours before a deadline
   * can land on the previous calendar day: a deadline set for 06:00 opens its
   * window at 20:00 the evening before. The window is closed at the deadline
   * itself, so a founder who is already late gets the overdue mail tomorrow
   * rather than a "last call" for a moment that has passed.
   *
   * Note what this means for an early deadline: one set for 09:00 opens its
   * window at 23:00 the night before, and the next tick sends it then. There
   * is no quiet-hours guard, because suppressing the send would mean the last
   * call never arrives at all for that deadline, which is worse than arriving
   * late in the evening. Deadlines with no time are end of day, so the common
   * case opens at 13:59 and this does not arise.
   */
  for (const dueDate of [helsinkiDate(now, 0), helsinkiDate(now, 1)]) {
    for (const row of pendingReminders("due-10h", dueDate)) {
      const due = dueInstant(row.due_date, row.due_time).getTime();
      const opens = due - LAST_CALL_HOURS * 60 * 60 * 1000;
      if (now.getTime() >= opens && now.getTime() < due) {
        jobs.push({ kind: "due-10h", row });
      }
    }
  }

  let sent = 0;
  let failed = 0;

  const link = appUrl();
  if (!link) {
    reportError(new Error(APP_URL_UNSET), { where: "reminders", level: "warning" });
    return { sent: 0, failed: 0, skipped: "no configured base url" };
  }

  for (const { kind, row } of jobs) {
    try {
        await sendDeadlineReminder(
        row.email,
        row.name,
        {
          title: row.title,
          description: row.description,
          dueDate: row.due_date,
          dueTime: row.due_time,
        },
        kind,
        link,
      );
      recordReminder(row.deadline_id, row.email, kind);
      sent += 1;
    } catch (error) {
      failed += 1;
      // One founder's bounced address must not stop the rest of the cohort
      // being reminded.
      reportError(error, {
        where: "reminders",
        level: "warning",
        extra: { kind, deadline: row.deadline_id },
      });
    }
  }

  return { sent, failed, skipped: null };
}

let scheduled = false;

/**
 * Runs the reminders once an hour, and acts on every one of those ticks.
 *
 * It used to check hourly and act once a day, because everything it sent was
 * keyed to a date. The ten-hour last call is keyed to a time, so a once-a-day
 * pass would miss its window entirely on most deadlines. runReminders is safe
 * to call as often as this: the morning gate lives inside it, and the primary
 * key on deadline_reminders is what stops a second send, not the frequency of
 * the caller.
 */
export function startReminderScheduler(): void {
  if (scheduled) return;
  if (process.env.NODE_ENV !== "production") return;
  if (!isEmailConfigured()) {
    console.warn("[reminders] scheduler not started: email is not configured");
    return;
  }
  /* Said once at boot rather than once per skipped run, so a misconfigured
     deployment is visible in the deploy log instead of at 08:00. */
  if (!configuredAppUrl()) {
    console.warn(`[reminders] scheduler not started: ${APP_URL_UNSET}`);
    return;
  }
  scheduled = true;

  const tick = async () => {
    try {
      const result = await runReminders(new Date());
      if (result.sent > 0 || result.failed > 0) {
        console.info(`[reminders] sent ${result.sent}, failed ${result.failed}`);
      }
    } catch (error) {
      reportError(error, { where: "reminders.scheduler" });
    }
  };

  const first = setTimeout(tick, 90_000);
  const repeat = setInterval(tick, 60 * 60 * 1000);
  first.unref?.();
  repeat.unref?.();
}
