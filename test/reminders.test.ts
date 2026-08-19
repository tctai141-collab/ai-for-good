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

async function createDeadline(title: string, dueDate: string) {
  const res = await post(h, "/api/deadlines", { action: "create", title, dueDate }, organizer.cookie);
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
  test("everybody who still owes a deadline due tomorrow", async () => {
    await createDeadline("Customer interviews", helsinkiDate(NOW, 1));

    const result = await runPass();

    expect(result.sent).toBe(2);
    expect(h.lastEmailTo("alice@example.test")?.subject).toBe("Due tomorrow: Customer interviews");
    expect(h.lastEmailTo("bob@example.test")?.subject).toBe("Due tomorrow: Customer interviews");
  });

  test("and never a second time", async () => {
    // The point of the whole feature: a reminder, not a daily nag.
    const before = h.sent.length;
    const result = await runPass();

    expect(result.sent).toBe(0);
    expect(h.sent.length).toBe(before);
  });

  test("not somebody who already ticked it off", async () => {
    const id = await createDeadline("Pitch deck", helsinkiDate(NOW, 1));
    expect((await post(h, "/api/deadlines", { action: "toggle", id, done: true }, alice.cookie)).status).toBe(200);

    const result = await runPass();

    expect(result.sent).toBe(1);
    expect(h.lastEmailTo("bob@example.test")?.subject).toBe("Due tomorrow: Pitch deck");
  });

  test("not for a milestone the team archived", async () => {
    const id = await createDeadline("Abandoned idea", helsinkiDate(NOW, 1));
    expect((await post(h, "/api/deadlines", { action: "update", id, status: "archived" }, organizer.cookie)).status).toBe(200);

    expect((await runPass()).sent).toBe(0);
  });

  test("organizers are not founders and are left alone", async () => {
    await createDeadline("Founder-only milestone", helsinkiDate(NOW, 1));
    await runPass();

    // Every message so far has gone to a founder address.
    const toOrganizer = h.sent.filter((m) => m.to === "organizer@example.test" && m.subject.startsWith("Due tomorrow"));
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
