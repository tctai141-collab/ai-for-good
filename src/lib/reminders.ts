import { pendingReminders, recordReminder, type ReminderKind } from "../db/index";
import { isEmailConfigured, sendDeadlineReminder } from "./email";
import { reportError } from "./errors";

/**
 * Deadline reminders.
 *
 * The benchmark work behind the tracker is unambiguous that visible shared
 * deadlines drive completion, and that the nudge is most of the effect. This is
 * that nudge — and the whole design problem is not sending too many.
 *
 * Two moments, once each, per founder per deadline:
 *
 *   DUE-SOON  the day before it is due, while there is still time to act.
 *   OVERDUE   the day after, once, when the date has actually passed.
 *
 * A founder who ignores both hears nothing further about that milestone. The
 * primary key on deadline_reminders is what enforces this — not a flag someone
 * has to remember to check, and not the scheduler running exactly once.
 *
 * Timing is computed in Helsinki, matching the tracker: the server is UTC and
 * every founder is in Finland, so "tomorrow" has to mean their tomorrow.
 */

function helsinkiOffsetHours(date: Date): number {
  const year = date.getUTCFullYear();
  const lastSunday = (month: number) => {
    const d = new Date(Date.UTC(year, month + 1, 0));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    d.setUTCHours(1, 0, 0, 0);
    return d;
  };
  return date >= lastSunday(2) && date < lastSunday(9) ? 3 : 2;
}

/** The calendar date in Helsinki, offset by whole days, as YYYY-MM-DD. */
export function helsinkiDate(now: Date, dayOffset = 0): string {
  const shifted = new Date(now.getTime() + helsinkiOffsetHours(now) * 60 * 60 * 1000);
  shifted.setUTCDate(shifted.getUTCDate() + dayOffset);
  return shifted.toISOString().slice(0, 10);
}

function appUrl(): string {
  return process.env.PUBLIC_BASE_URL?.trim() || "https://aaltofoundersprint.com";
}

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

  const work: { kind: ReminderKind; dueDate: string }[] = [
    { kind: "due-soon", dueDate: helsinkiDate(now, 1) },
    { kind: "overdue", dueDate: helsinkiDate(now, -1) },
  ];

  let sent = 0;
  let failed = 0;

  for (const { kind, dueDate } of work) {
    for (const row of pendingReminders(kind, dueDate)) {
      try {
        await sendDeadlineReminder(
          row.email,
          row.name,
          { title: row.title, description: row.description, dueDate: row.due_date },
          kind,
          appUrl(),
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
  }

  return { sent, failed, skipped: null };
}

let scheduled = false;

/**
 * Runs the reminders once an hour.
 *
 * Hourly rather than daily on purpose. A daily timer anchored to boot sends at
 * whatever time the last deploy happened, which for a cohort in one timezone
 * could be the middle of the night. Checking hourly and only acting when the
 * Helsinki date has advanced means the send lands in the morning regardless of
 * when the process started, and a restart cannot skip a day.
 */
export function startReminderScheduler(): void {
  if (scheduled) return;
  if (process.env.NODE_ENV !== "production") return;
  if (!isEmailConfigured()) {
    console.warn("[reminders] scheduler not started: email is not configured");
    return;
  }
  scheduled = true;

  const SEND_HOUR_HELSINKI = 8;
  let lastSentDate: string | null = null;

  const tick = async () => {
    try {
      const now = new Date();
      const localHour = (now.getUTCHours() + helsinkiOffsetHours(now)) % 24;
      const today = helsinkiDate(now);
      if (localHour < SEND_HOUR_HELSINKI || lastSentDate === today) return;

      const result = await runReminders(now);
      lastSentDate = today;
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
