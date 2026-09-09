import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFounder, createOrganizer, post, startServer,
  type Harness, type Session,
} from "./helpers/harness";
import { helsinkiDay } from "../src/lib/deadlines";
import { dailyLimitFor, CHAT_DAILY_LIMIT, CHECKIN_DAILY_LIMIT, STAFF_DAILY_LIMIT } from "../src/lib/limits";

/**
 * What one person can spend on the metered API in a day.
 *
 * The per-minute limiter stops a script hammering the endpoint and nothing
 * else: twenty a minute sustained is twelve hundred an hour, and above it there
 * was no ceiling at all. Nineteen founders against no daily cap is half a
 * million calls a day in theory, on somebody's card, with the first sign of it
 * being the invoice.
 *
 * The tests seed the counter rather than making forty real calls, because
 * forty real calls would hit the per-minute limiter first and prove nothing
 * about this one.
 */

let h: Harness;
let organizer: Session;
let founder: Session;

const seed = (email: string, kind: "chat" | "checkin", calls: number) => {
  const db = h.db();
  try {
    db.run(
      /* alerted_at goes back to NULL too: seeding is meant to establish a
         fresh day, and a row left claimed by an earlier test silently swallows
         the next alert. */
      `INSERT INTO chat_usage (user_email, day, kind, calls) VALUES ($e, $d, $k, $c)
       ON CONFLICT(user_email, day, kind) DO UPDATE SET calls = $c, alerted_at = NULL`,
      { $e: email, $d: helsinkiDay(), $k: kind, $c: calls },
    );
  } finally {
    db.close();
  }
};

const usageRow = (email: string, kind: "chat" | "checkin") => {
  const db = h.db();
  try {
    return db
      .query("SELECT calls, input_tokens, output_tokens FROM chat_usage WHERE user_email = $e AND day = $d AND kind = $k")
      .get({ $e: email, $d: helsinkiDay(), $k: kind }) as
      { calls: number; input_tokens: number; output_tokens: number } | null;
  } finally {
    db.close();
  }
};

const say = (who: Session, kind?: "checkin") =>
  post(h, "/api/chat", {
    messages: [{ role: "user", content: "hello" }],
    ...(kind ? { kind, userEmail: who.email } : {}),
    personality: "marten",
  }, who.cookie);

beforeAll(async () => {
  // checkinOpen, because half of what is being tested is that a spent
  // conversation allowance still leaves the check-in reachable.
  h = await startServer({ checkinOpen: true });
  organizer = await createOrganizer(h, "olivia@example.test");
  founder = await createFounder(h, organizer, "frida@example.test", "Frida Founder", "frida-password-11");
});

afterAll(() => h?.stop());

describe("the daily allowance", () => {
  test("the last call inside it is allowed, the next one is not", async () => {
    seed(founder.email, "chat", CHAT_DAILY_LIMIT - 1);
    expect((await say(founder)).status).toBe(200);

    const over = await say(founder);
    expect(over.status).toBe(429);
    const body = await over.json() as { error: string; resetsOn: string };
    /* It has to say when it comes back. "You have reached a limit" with no
       horizon reads as "you are in trouble" rather than "try tomorrow". */
    expect(body.error).toContain("resets at midnight");
    expect(body.resetsOn).toBe(helsinkiDay());
  });

  test("a spent conversation allowance does not touch the check-in", async () => {
    /*
     * The reason there are two counters and not one pool. A founder who talks
     * all afternoon and then cannot do the day's check-in has lost the ritual
     * the programme is actually built on, which is far worse than being told
     * to stop chatting.
     */
    seed(founder.email, "chat", CHAT_DAILY_LIMIT + 5);
    expect((await say(founder)).status).toBe(429);
    expect((await say(founder, "checkin")).status).toBe(200);
  });

  test("and the check-in has its own ceiling, which is not the chat one", async () => {
    expect(CHECKIN_DAILY_LIMIT).toBeLessThan(CHAT_DAILY_LIMIT);
    seed(founder.email, "checkin", CHECKIN_DAILY_LIMIT);
    expect((await say(founder, "checkin")).status).toBe(429);
  });

  test("staff get a larger allowance, and still an allowance", async () => {
    // They demo and test the thing. A compromised staff account is worse than
    // a founder's, not better, so "larger" and not "unlimited".
    expect(dailyLimitFor("organizer", "chat")).toBe(STAFF_DAILY_LIMIT);
    expect(dailyLimitFor("mentor", "chat")).toBe(STAFF_DAILY_LIMIT);
    expect(dailyLimitFor("founder", "chat")).toBe(CHAT_DAILY_LIMIT);

    seed(organizer.email, "chat", CHAT_DAILY_LIMIT + 5);
    expect((await say(organizer)).status).toBe(200);
  });

  test("the count is taken before the call, not after a successful one", async () => {
    /* A reply that dies upstream still cost money. A counter that only records
       successes is one a failing loop can spend against all day. */
    seed(founder.email, "chat", 0);
    await say(founder);
    expect(usageRow(founder.email, "chat")?.calls).toBe(1);
  });

  test("what the call cost is recorded, not only that it happened", async () => {
    // Calls alone do not price anything: input size moves with history length.
    seed(founder.email, "chat", 0);
    await say(founder);
    const row = usageRow(founder.email, "chat")!;
    expect(row.input_tokens).toBeGreaterThan(0);
    expect(row.output_tokens).toBeGreaterThan(0);
  });

  test("the organizers are told once, not once per attempt", async () => {
    const marker = h.sent.length;
    seed(founder.email, "chat", CHAT_DAILY_LIMIT);
    await say(founder);
    await say(founder);
    await say(founder);
    /* The send is fire-and-forget, so it lands after the 429 the founder got.
       Give it a moment rather than asserting into the gap. */
    let alerts = h.sent.slice(marker).filter((m) => m.subject.includes("limit"));
    for (let i = 0; i < 50 && alerts.length === 0; i++) {
      await Bun.sleep(20);
      alerts = h.sent.slice(marker).filter((m) => m.subject.includes("limit"));
    }
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.to).toBe(organizer.email);
  });

  test("removing an account removes what it spent", async () => {
    const gus = await createFounder(h, organizer, "gus@example.test", "Gus", "gus-password-1234");
    seed(gus.email, "chat", 3);
    await post(h, "/api/admin/users", { action: "remove", email: gus.email }, organizer.cookie);
    expect(usageRow(gus.email, "chat")).toBeNull();
  });
});

describe("which model the call goes to", () => {
  test("the check-in runs on the smaller one, conversation on the larger", async () => {
    /*
     * The check-in is the highest-volume path in the app — every founder, every
     * day, for thirteen weeks — and the most structured. Open conversation is
     * where the coaching voice has to carry something.
     */
    seed(founder.email, "chat", 0);
    seed(founder.email, "checkin", 0);

    await say(founder, "checkin");
    expect(h.advisorCalls.at(-1)!.model).toContain("sonnet");

    await say(founder);
    expect(h.advisorCalls.at(-1)!.model).toContain("opus");
  });
});

describe("what the advisor is for", () => {
  const prompt = readFileSync("src/lib/personas.ts", "utf-8");

  test("the prompt says what it is, and what it is not", () => {
    /*
     * There was no scope at all: a voice and a set of beliefs, and nothing
     * saying what the thing is for. A founder pasting code got a real attempt
     * at it, billed at the open-conversation rate.
     */
    expect(prompt).toContain("What you are for:");
    expect(prompt).toContain("not a general-purpose assistant");
    for (const refused of ["write or debug code", "scrapers", "coursework"]) {
      expect(prompt).toContain(refused);
    }
  });

  test("it refuses the task without refusing the subject", () => {
    /*
     * "Should we build or buy this?" is a real founder question and turning it
     * away would be the wrong fix. The line is doing the work for them, not
     * the topic — and the refusal has to land somewhere, per the prompt's own
     * rule that a refusal with nothing after it is a dead end.
     */
    expect(prompt).toContain("Technical choices themselves are fair game");
    expect(prompt).toContain("The line is doing the work for them, not the subject matter");
    expect(prompt).toContain("take the decision underneath it");
  });

  test("it says it once", () => {
    // A coach that re-explains its own policy every time somebody strays is
    // worse company than one that redirects and moves on.
    expect(prompt).toContain("Say this once and lightly");
  });
});
