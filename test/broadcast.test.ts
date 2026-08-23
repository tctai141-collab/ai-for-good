import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFounder,
  createOrganizer,
  get,
  post,
  startServer,
  type Harness,
  type Session,
} from "./helpers/harness";

/**
 * Cohort broadcasts.
 *
 * The failure modes here are public and permanent, which is what these tests
 * are shaped around. A blast cannot be recalled, so the interesting assertions
 * are not "does it send" but "what does it refuse to send", and above all that
 * one founder never learns another founder's address.
 */

let h: Harness;
let organizer: Session;
let alice: Session;
let bob: Session;

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test", "Olivia Organizer");
  alice = await createFounder(h, organizer, "alice@example.test", "Alice Andersson", "alice-password-11");
  bob = await createFounder(h, organizer, "bob@example.test", "Bob Berg", "bob-password-1122");
});

afterAll(() => h?.stop());

/** Everything sent since the marker, so one test cannot read another's mail. */
function since(marker: number) {
  return h.sent.slice(marker);
}

async function sendTest(subject: string, body: string) {
  return post(h, "/api/admin/broadcast", { action: "test", subject, body }, organizer.cookie);
}

describe("who may broadcast", () => {
  test("a signed-out caller is refused", async () => {
    const res = await post(h, "/api/admin/broadcast", { action: "test", subject: "x", body: "y" });
    expect(res.status).toBe(401);
  });

  test("a founder is refused, on both reading and sending", async () => {
    const read = await get(h, "/api/admin/broadcast", alice.cookie);
    expect(read.status).toBe(403);

    const write = await post(
      h,
      "/api/admin/broadcast",
      { action: "send", subject: "Hi", body: "There", roles: ["founder"], confirm: 2 },
      alice.cookie,
    );
    expect(write.status).toBe(403);
  });
});

describe("what it refuses to send", () => {
  test("an unknown merge tag is rejected before anything leaves", async () => {
    const marker = h.sent.length;
    const res = await sendTest("Hello {{firstname}}", "Body");
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("{{firstname}}");
    // The whole point: the typo never reaches an inbox, not even the tester's.
    expect(since(marker)).toHaveLength(0);
  });

  test("an empty subject or body is rejected", async () => {
    expect((await sendTest("", "Body")).status).toBe(400);
    expect((await sendTest("Subject", "   ")).status).toBe(400);
  });

  test("sending without a test of that exact wording is refused", async () => {
    const marker = h.sent.length;
    const res = await post(
      h,
      "/api/admin/broadcast",
      { action: "send", subject: "Untested", body: "Never tested.", roles: ["founder"], confirm: 2 },
      organizer.cookie,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("test");
    expect(since(marker)).toHaveLength(0);
  });

  test("editing a single character invalidates the test", async () => {
    await sendTest("Session moved", "Hi {{first_name}}, we start at 14:00.");
    const marker = h.sent.length;

    const res = await post(
      h,
      "/api/admin/broadcast",
      {
        action: "send",
        subject: "Session moved",
        // 15:00, not 14:00. What was read in the test is not what would go out.
        body: "Hi {{first_name}}, we start at 15:00.",
        roles: ["founder"],
        confirm: 2,
      },
      organizer.cookie,
    );
    expect(res.status).toBe(400);
    expect(since(marker)).toHaveLength(0);
  });

  test("the wrong confirmation number is refused, and names the right one", async () => {
    await sendTest("Counting", "Hi {{first_name}}.");
    const marker = h.sent.length;

    const res = await post(
      h,
      "/api/admin/broadcast",
      { action: "send", subject: "Counting", body: "Hi {{first_name}}.", roles: ["founder"], confirm: 99 },
      organizer.cookie,
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string; expected: number };
    expect(data.expected).toBe(2);
    expect(data.error).toContain("2");
    expect(since(marker)).toHaveLength(0);
  });

  test("a selection that reaches nobody is refused", async () => {
    await sendTest("Nobody", "Hi {{first_name}}.");
    const res = await post(
      h,
      "/api/admin/broadcast",
      { action: "send", subject: "Nobody", body: "Hi {{first_name}}.", roles: [], emails: [], confirm: 0 },
      organizer.cookie,
    );
    expect(res.status).toBe(400);
  });
});

describe("the test send", () => {
  test("goes to the organizer alone, rendered against their own name", async () => {
    const marker = h.sent.length;
    const res = await sendTest("Preview", "Hi {{first_name}}, this is {{name}} at {{email}}.");
    expect(res.status).toBe(200);

    const mail = since(marker);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.to).toBe("organizer@example.test");
    expect(mail[0]!.text).toContain("Hi Olivia, this is Olivia Organizer at organizer@example.test.");
  });
});

describe("the real send", () => {
  test("each founder gets their own email and sees nobody else's address", async () => {
    const subject = "Thursday session";
    const body = "Hi {{first_name}},\n\nWe start at 14:00 this week.";
    await sendTest(subject, body);
    const marker = h.sent.length;

    const res = await post(
      h,
      "/api/admin/broadcast",
      { action: "send", subject, body, roles: ["founder"], confirm: 2 },
      organizer.cookie,
    );
    expect(res.status).toBe(200);
    const result = (await res.json()) as { sent: number; failed: number; id: string };
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);

    const mail = since(marker);
    expect(mail.map((m) => m.to).sort()).toEqual(["alice@example.test", "bob@example.test"]);

    const toAlice = mail.find((m) => m.to === "alice@example.test")!;
    const toBob = mail.find((m) => m.to === "bob@example.test")!;
    expect(toAlice.text).toContain("Hi Alice,");
    expect(toBob.text).toContain("Hi Bob,");

    // The leak this feature exists to make impossible: one recipient per
    // message, and no other founder's address anywhere in the body.
    expect(toAlice.text).not.toContain("bob@example.test");
    expect(toBob.text).not.toContain("alice@example.test");
    expect(toAlice.subject).toBe(subject);
  });

  test("the organizer is not swept in by a founders-only send", async () => {
    const subject = "Founders only";
    const body = "Hi {{first_name}}.";
    await sendTest(subject, body);
    const marker = h.sent.length;

    await post(
      h,
      "/api/admin/broadcast",
      { action: "send", subject, body, roles: ["founder"], confirm: 2 },
      organizer.cookie,
    );
    expect(since(marker).some((m) => m.to === "organizer@example.test")).toBe(false);
  });

  test("someone in the role and also picked by name is mailed once", async () => {
    const subject = "No duplicates";
    const body = "Hi {{first_name}}.";
    await sendTest(subject, body);
    const marker = h.sent.length;

    const res = await post(
      h,
      "/api/admin/broadcast",
      {
        action: "send",
        subject,
        body,
        roles: ["founder"],
        emails: ["alice@example.test"],
        confirm: 2,
      },
      organizer.cookie,
    );
    expect(res.status).toBe(200);

    const toAlice = since(marker).filter((m) => m.to === "alice@example.test");
    expect(toAlice).toHaveLength(1);
  });

  test("roles and picked addresses are a union, not an intersection", async () => {
    const subject = "Founders plus one organizer";
    const body = "Hi {{first_name}}.";
    await sendTest(subject, body);
    const marker = h.sent.length;

    const res = await post(
      h,
      "/api/admin/broadcast",
      {
        action: "send",
        subject,
        body,
        roles: ["founder"],
        emails: ["organizer@example.test"],
        confirm: 3,
      },
      organizer.cookie,
    );
    expect(res.status).toBe(200);
    expect(since(marker).map((m) => m.to).sort()).toEqual([
      "alice@example.test",
      "bob@example.test",
      "organizer@example.test",
    ]);
  });

  test("the send is recorded, per recipient, and shows up in history", async () => {
    const subject = "For the record";
    const body = "Hi {{first_name}}.";
    await sendTest(subject, body);

    const res = await post(
      h,
      "/api/admin/broadcast",
      { action: "send", subject, body, roles: ["founder"], confirm: 2 },
      organizer.cookie,
    );
    const { id } = (await res.json()) as { id: string };

    const db = h.db();
    try {
      const row = db
        .query("SELECT subject, sent, failed, audience FROM broadcasts WHERE id = $id")
        .get({ $id: id }) as { subject: string; sent: number; failed: number; audience: string };
      expect(row.subject).toBe(subject);
      expect(row.sent).toBe(2);
      expect(row.failed).toBe(0);

      const recipients = db
        .query("SELECT email, status FROM broadcast_recipients WHERE broadcast_id = $id ORDER BY email")
        .all({ $id: id }) as { email: string; status: string }[];
      expect(recipients).toEqual([
        { email: "alice@example.test", status: "sent" },
        { email: "bob@example.test", status: "sent" },
      ]);

      // Every blast is attributable to a person, which is the point of the
      // audit trail existing at all.
      const audit = db
        .query("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'broadcast' AND actor_email = $who")
        .get({ $who: organizer.email }) as { n: number };
      expect(audit.n).toBeGreaterThan(0);
    } finally {
      db.close();
    }

    const listed = await get(h, "/api/admin/broadcast", organizer.cookie);
    const data = (await listed.json()) as { history: { id: string; subject: string }[] };
    expect(data.history.some((b) => b.id === id)).toBe(true);
    // Test sends are bookkeeping for the gate, not things the cohort received.
    expect(data.history.every((b) => b.subject !== undefined)).toBe(true);
  });

  test("history excludes test sends", async () => {
    const subject = "Only ever tested, never sent";
    await sendTest(subject, "Hi {{first_name}}.");

    const listed = await get(h, "/api/admin/broadcast", organizer.cookie);
    const data = (await listed.json()) as { history: { subject: string }[] };
    expect(data.history.some((b) => b.subject === subject)).toBe(false);
  });
});

describe("the compose page", () => {
  /*
   * Astro parses a bare {{ as the start of a JSX expression, so the tag hints
   * have to be HTML-escaped in the template. Getting that wrong took the whole
   * admin page down with a 500 rather than failing visibly on the broadcast
   * tab, so the literal braces are worth asserting.
   */
  test("shows the merge tags as literal text, not as an expression", async () => {
    const html = await (await get(h, "/admin", organizer.cookie)).text();
    expect(html).toContain("{{first_name}}");
    expect(html).toContain("{{name}}");
    expect(html).toContain("{{email}}");
  });
});

describe("without email configured", () => {
  test("the endpoint refuses rather than pretending to send", async () => {
    const bare = await startServer({ email: false });
    try {
      const admin = await createOrganizer(bare, "solo@example.test", "Solo Organizer");
      const res = await post(
        bare,
        "/api/admin/broadcast",
        { action: "test", subject: "Hi", body: "There" },
        admin.cookie,
      );
      expect(res.status).toBe(503);
      expect(bare.sent).toHaveLength(0);
    } finally {
      bare.stop();
    }
  });
});
