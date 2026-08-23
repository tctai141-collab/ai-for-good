import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createFounder, createOrganizer, post, startServer, type Harness, type Session } from "./helpers/harness";

/**
 * Deadline reminders.
 *
 * The tracker's whole premise is that visible shared deadlines drive
 * completion, and the nudge is most of that effect. The risk is not that the
 * email fails to send — it is that it sends too often and gets filtered, at
 * which point the feature is worse than nothing. So most of what is asserted
 * here is restraint: once per founder per deadline per kind, never for work
 * already done, never for a milestone the team archived.
 *
 * The reminder pass is driven directly inside the test process, pointed at the
 * harness's database and its stand-in mail endpoint. Deliberately not through a
 * test-only HTTP route: a scheduler trigger that exists only for tests is
 * production surface nobody audits, and reminders send email.
 */

let h: Harness;
let organizer: Session;
let alice: Session;
let bob: Session;

const NOW = new Date("2026-09-15T09:00:00Z");

async function createDeadline(title: string, dueDate: string, dueTime: string | null = null) {
  const res = await post(h, "/api/deadlines", { action: "create", title, dueDate, dueTime }, organizer.cookie);
  expect(res.status).toBe(200);
  return (await res.json() as { id: string }).id;
}

/* Loaded after the environment points at the harness, because the database
   module resolves DB_PATH when it is first imported. */
let runReminders: (now?: Date) => Promise<{ sent: number; failed: number }>;
let helsinkiDate: (now: Date, dayOffset?: number) => string;

async function runPass() {
  return runReminders(NOW);
}

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
  alice = await createFounder(h, organizer, "alice@example.test", "Alice", "alice-password-11");
  bob = await createFounder(h, organizer, "bob@example.test", "Bob", "bob-password-1122");

  process.env.DB_PATH = h.dbPath;
  process.env.RESEND_API_KEY = "test-key-not-real";
  process.env.RESEND_FROM = "Sprint Buddy Test <no-reply@send.example.test>";
  process.env.RESEND_BASE_URL = h.mailUrl;
  process.env.PUBLIC_BASE_URL = h.url;

  const reminders = await import("../src/lib/reminders");
  runReminders = reminders.runReminders;
  helsinkiDate = reminders.helsinkiDate;
});

afterAll(() => h?.stop());

describe("helsinki dates", () => {
  test("tomorrow and yesterday are the founder's, not UTC's", () => {
    // 23:30 UTC on 14 Sep is already 15 Sep in Helsinki (UTC+3 in summer), so
    // "tomorrow" must be the 16th. Getting this wrong sends the nudge a day late.
    const lateEvening = new Date("2026-09-14T23:30:00Z");
    expect(helsinkiDate(lateEvening)).toBe("2026-09-15");
    expect(helsinkiDate(lateEvening, 1)).toBe("2026-09-16");
    expect(helsinkiDate(lateEvening, -1)).toBe("2026-09-14");
  });
});

describe("who gets reminded", () => {
  test("everybody who still owes a deadline due in three days", async () => {
    await createDeadline("Customer interviews", helsinkiDate(NOW, 3));

    const result = await runPass();

    expect(result.sent).toBe(2);
    expect(h.lastEmailTo("alice@example.test")?.subject).toBe("Three days: Customer interviews");
    expect(h.lastEmailTo("bob@example.test")?.subject).toBe("Three days: Customer interviews");
  });

  test("and never a second time", async () => {
    // The point of the whole feature: a reminder, not a daily nag.
    const before = h.sent.length;
    const result = await runPass();

    expect(result.sent).toBe(0);
    expect(h.sent.length).toBe(before);
  });

  test("not somebody who already ticked it off", async () => {
    const id = await createDeadline("Pitch deck", helsinkiDate(NOW, 3));
    expect((await post(h, "/api/deadlines", { action: "toggle", id, done: true }, alice.cookie)).status).toBe(200);

    const result = await runPass();

    expect(result.sent).toBe(1);
    expect(h.lastEmailTo("bob@example.test")?.subject).toBe("Three days: Pitch deck");
  });

  test("not for a milestone the team archived", async () => {
    const id = await createDeadline("Abandoned idea", helsinkiDate(NOW, 3));
    expect((await post(h, "/api/deadlines", { action: "update", id, status: "archived" }, organizer.cookie)).status).toBe(200);

    expect((await runPass()).sent).toBe(0);
  });

  test("organizers are not founders and are left alone", async () => {
    await createDeadline("Founder-only milestone", helsinkiDate(NOW, 3));
    await runPass();

    // Every message so far has gone to a founder address.
    const toOrganizer = h.sent.filter((m) => m.to === "organizer@example.test" && m.subject.startsWith("Three days"));
    expect(toOrganizer.length).toBe(0);
  });
});

describe("overdue", () => {
  test("goes out the day after, once", async () => {
    await createDeadline("Kiilto brief", helsinkiDate(NOW, -1));

    const first = await runPass();
    expect(first.sent).toBe(2);
    expect(h.lastEmailTo("alice@example.test")?.subject).toBe("Overdue: Kiilto brief");

    const second = await runPass();
    expect(second.sent).toBe(0);
  });

  test("not for a deadline due further back than yesterday", async () => {
    // Only the day after. A milestone from three weeks ago is the organizer's
    // problem to raise in person, not something to email about indefinitely.
    await createDeadline("Ancient history", helsinkiDate(NOW, -21));

    expect((await runPass()).sent).toBe(0);
  });
});

describe("two days out", () => {
  test("its own moment, and its own wording", async () => {
    await createDeadline("Pricing experiment", helsinkiDate(NOW, 2));

    expect((await runPass()).sent).toBe(2);
    expect(h.lastEmailTo("alice@example.test")?.subject).toBe("Two days: Pricing experiment");
  });
});

describe("the ten-hour last call", () => {
  /*
   * The only reminder keyed to a time rather than a date, which is why the
   * scheduler now acts on every hourly tick instead of once a morning. NOW is
   * 12:00 in Helsinki.
   */
  test("does not go out before the window opens", async () => {
    // End of day, so the window opens at 13:59. It is noon.
    await createDeadline("End of day thing", helsinkiDate(NOW, 0));

    const before = h.sent.length;
    expect((await runPass()).sent).toBe(0);
    expect(h.sent.length).toBe(before);
  });

  test("goes out once inside the window", async () => {
    // 14:00 Helsinki, past the 13:59 opening for an end-of-day deadline.
    const inWindow = new Date("2026-09-15T11:30:00Z");
    const result = await runReminders(inWindow);

    expect(result.sent).toBe(2);
    expect(h.lastEmailTo("alice@example.test")?.subject).toBe("Last call: End of day thing");

    // And not again on the next tick an hour later.
    expect((await runReminders(new Date("2026-09-15T12:30:00Z"))).sent).toBe(0);
  });

  test("counts back from an explicit time, not from end of day", async () => {
    // Due 18:00 Helsinki, so the window opened at 08:00. Noon is inside it.
    await createDeadline("Session handover", helsinkiDate(NOW, 0), "18:00");

    expect((await runPass()).sent).toBe(2);
    expect(h.lastEmailTo("bob@example.test")?.subject).toBe("Last call: Session handover");
    expect(h.lastEmailTo("bob@example.test")?.text).toContain("18:00");
  });

  test("nothing once the deadline itself has passed", async () => {
    await createDeadline("Already gone", helsinkiDate(NOW, 0), "09:00");

    // 12:00 Helsinki is after a 09:00 deadline. Being late is the overdue
    // mail's job tomorrow, not a last call for a moment that has gone.
    expect((await runPass()).sent).toBe(0);
  });

  test("a window that opens the previous evening still fires", async () => {
    // Due 06:00 tomorrow, so the last call opens at 20:00 tonight. This is the
    // case a today-only scan would miss entirely.
    await createDeadline("Early start", helsinkiDate(NOW, 1), "06:00");

    const tonight = new Date("2026-09-15T18:00:00Z"); // 21:00 Helsinki
    const result = await runReminders(tonight);

    expect(result.sent).toBe(2);
    expect(h.lastEmailTo("alice@example.test")?.subject).toBe("Last call: Early start");
  });
});

describe("finishing the work stops the reminders", () => {
  test("a founder who has ticked it off gets no last call", async () => {
    const id = await createDeadline("Done early", helsinkiDate(NOW, 0), "18:00");
    expect((await post(h, "/api/deadlines", { action: "toggle", id, done: true }, alice.cookie)).status).toBe(200);

    const result = await runPass();

    expect(result.sent).toBe(1);
    expect(h.lastEmailTo("bob@example.test")?.subject).toBe("Last call: Done early");
    // Alice's most recent mail is about something else entirely.
    expect(h.lastEmailTo("alice@example.test")?.subject).not.toBe("Last call: Done early");
  });

  test("ticking it off after the first nudge silences the rest", async () => {
    const id = await createDeadline("Half chased", helsinkiDate(NOW, 3));

    // Three days out: both founders hear about it.
    expect((await runPass()).sent).toBe(2);

    // Alice finishes it. Two days later she is not chased again.
    expect((await post(h, "/api/deadlines", { action: "toggle", id, done: true }, alice.cookie)).status).toBe(200);
    const twoDaysOut = new Date("2026-09-16T09:00:00Z");
    const before = h.sent.length;
    await runReminders(twoDaysOut);

    // Counted per recipient rather than in total: other tests have left their
    // own deadlines in this database and a total would measure them too.
    const fresh = h.sent.slice(before).filter((m) => m.subject === "Two days: Half chased");
    expect(fresh.map((m) => m.to)).toEqual(["bob@example.test"]);
  });
});

describe("the morning gate", () => {
  test("nothing date-based goes out in the small hours", async () => {
    await createDeadline("Not at 4am", helsinkiDate(NOW, 3));

    // 04:00 Helsinki. The date has rolled over but the founder is asleep, and
    // the scheduler now ticks every hour so this is a real possibility.
    const smallHours = new Date("2026-09-15T01:00:00Z");
    const before = h.sent.length;
    await runReminders(smallHours);
    expect(h.sent.slice(before).filter((m) => m.subject.startsWith("Three days"))).toHaveLength(0);

    // The same pass at a civilised hour does send it.
    const atNoon = h.sent.length;
    await runPass();
    expect(
      h.sent.slice(atNoon).filter((m) => m.subject === "Three days: Not at 4am").map((m) => m.to).sort(),
    ).toEqual(["alice@example.test", "bob@example.test"]);
  });
});
