import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AUDIENCE_LABEL, whenLabel, type Wish } from "../src/components/Wishes";
import {
  createFounder, createMentor, createOrganizer, get, post, startServer,
  type Harness, type Session,
} from "./helpers/harness";

/**
 * Wishes: a founder asking the organizers or the mentors for something.
 *
 * The load-bearing property is who reads what. A wish is addressed to the
 * people running the programme, not posted to the cohort — somebody asking for
 * help with a cofounder problem has not agreed to say it in front of nineteen
 * peers. Most of this file guards that.
 */

let h: Harness;
let organizer: Session;
let mentor: Session;
let alice: Session;
let bob: Session;

const admin = readFileSync("src/pages/admin.astro", "utf-8");

const send = (body: Record<string, unknown>, cookie: string) => post(h, "/api/wishes", body, cookie);

async function wishesFor(cookie: string): Promise<Wish[]> {
  const res = await get(h, "/api/wishes", cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { wishes: Wish[] }).wishes;
}

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "org@example.test");
  mentor = await createMentor(h, "marten@example.test", "Mårten");
  alice = await createFounder(h, organizer, "alice@example.test", "Alice", "alice-password-11");
  bob = await createFounder(h, organizer, "bob@example.test", "Bob", "bob-password-1111");
});
afterAll(() => h?.stop());

describe("sending one", () => {
  test("a founder can ask the organisers or the mentors", async () => {
    expect((await send({ audience: "organizers", body: "More time between sessions." }, alice.cookie)).status).toBe(200);
    expect((await send({ audience: "mentors", body: "A session on pricing." }, alice.cookie)).status).toBe(200);
  });

  test("it needs both a body and an audience", async () => {
    expect((await send({ audience: "organizers", body: "   " }, alice.cookie)).status).toBe(400);
    expect((await send({ audience: "everyone", body: "Hello" }, alice.cookie)).status).toBe(400);
    expect((await send({ body: "Hello" }, alice.cookie)).status).toBe(400);
  });

  test("staff do not send wishes; they reply", async () => {
    expect((await send({ audience: "mentors", body: "Hi" }, organizer.cookie)).status).toBe(403);
    expect((await send({ audience: "mentors", body: "Hi" }, mentor.cookie)).status).toBe(403);
  });

  test("signed out is refused", async () => {
    expect((await send({ audience: "organizers", body: "Hi" }, "")).status).toBe(401);
    expect((await get(h, "/api/wishes", "")).status).toBe(401);
  });
});

describe("who can read what", () => {
  test("a founder reads their own and nobody else's", async () => {
    await send({ audience: "organizers", body: "BOB'S PRIVATE ASK" }, bob.cookie);

    const mine = await wishesFor(alice.cookie);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((w) => w.fromEmail === alice.email)).toBe(true);
    expect(JSON.stringify(mine)).not.toContain("BOB'S PRIVATE ASK");
  });

  test("a mentor reads what was addressed to the mentors, and only that", async () => {
    const inbox = await wishesFor(mentor.cookie);
    expect(inbox.length).toBeGreaterThan(0);
    expect(inbox.every((w) => w.audience === "mentors")).toBe(true);
    // Addressed to the organisers, so not the mentor's to read.
    expect(JSON.stringify(inbox)).not.toContain("BOB'S PRIVATE ASK");
  });

  test("an organizer reads both queues", async () => {
    /* They run the programme, and a wish for a mentor is still theirs to make
       happen. This matches what they may reply to. */
    const inbox = await wishesFor(organizer.cookie);
    expect(inbox.some((w) => w.audience === "organizers")).toBe(true);
    expect(inbox.some((w) => w.audience === "mentors")).toBe(true);
  });

  test("the sender's name travels with it, because it expects an answer", async () => {
    const inbox = await wishesFor(organizer.cookie);
    const fromBob = inbox.find((w) => w.body === "BOB'S PRIVATE ASK");
    expect(fromBob?.fromName).toBe("Bob");
  });
});

describe("replying", () => {
  /*
   * Its own sender, because the hourly cap is per founder and real. Reusing
   * Alice across the whole file put her over it partway through and the
   * failures looked like a permissions bug rather than the cap doing its job.
   */
  let carol: Session;
  beforeAll(async () => {
    carol = await createFounder(h, organizer, "carol@example.test", "Carol", "carol-password-11");
  });

  async function newWish(audience: Wish["audience"], body: string, who: Session) {
    const res = await send({ audience, body }, who.cookie);
    expect(res.status).toBe(200);
    return ((await res.json()) as { id: string }).id;
  }

  test("a mentor answers a mentor wish, and the founder sees it", async () => {
    const id = await newWish("mentors", "How do we price this?", carol);
    expect((await send({ action: "reply", id, body: "Charge more." }, mentor.cookie)).status).toBe(200);

    const mine = await wishesFor(carol.cookie);
    const answered = mine.find((w) => w.id === id);
    expect(answered?.replies.map((r) => r.body)).toContain("Charge more.");
    expect(answered?.replies[0]?.authorName).toBe("Mårten");
  });

  test("answering is what marks it answered", async () => {
    // No separate button, so there is nothing to forget to press.
    const id = await newWish("mentors", "Another one", carol);
    let mine = await wishesFor(carol.cookie);
    expect(mine.find((w) => w.id === id)?.status).toBe("open");

    await send({ action: "reply", id, body: "Here you go." }, mentor.cookie);
    mine = await wishesFor(carol.cookie);
    expect(mine.find((w) => w.id === id)?.status).toBe("answered");
  });

  test("a mentor cannot answer what was addressed to the organisers", async () => {
    const id = await newWish("organizers", "Change the schedule", carol);
    expect((await send({ action: "reply", id, body: "No" }, mentor.cookie)).status).toBe(403);
  });

  test("an organizer can answer either", async () => {
    const forMentors = await newWish("mentors", "Mentor question", bob);
    const forOrganizers = await newWish("organizers", "Organizer question", bob);
    expect((await send({ action: "reply", id: forMentors, body: "Sure." }, organizer.cookie)).status).toBe(200);
    expect((await send({ action: "reply", id: forOrganizers, body: "Sure." }, organizer.cookie)).status).toBe(200);
  });

  test("a founder cannot reply to anything, including their own", async () => {
    const id = await newWish("organizers", "Mine", carol);
    expect((await send({ action: "reply", id, body: "Replying to myself" }, carol.cookie)).status).toBe(403);
    expect((await send({ action: "reply", id, body: "Replying to Carol" }, bob.cookie)).status).toBe(403);
  });

  test("an empty reply and a missing wish are both refused", async () => {
    const id = await newWish("mentors", "Real one", carol);
    expect((await send({ action: "reply", id, body: "  " }, mentor.cookie)).status).toBe(400);
    expect((await send({ action: "reply", id: "nope", body: "Hi" }, mentor.cookie)).status).toBe(404);
  });
});

describe("it emails a real person, so it is capped", () => {
  test("a burst is refused rather than forwarded", async () => {
    const spammer = await createFounder(h, organizer, "spam@example.test", "Spam", "spam-password-111");
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) {
      codes.push((await send({ audience: "mentors", body: `Ask ${i}` }, spammer.cookie)).status);
    }
    /* Six an hour is far above anything anybody does on purpose and far below
       what makes an inbox unusable. Without it one stuck key sends the mentor
       forty emails and the feature gets switched off by whoever owns it. */
    expect(codes.filter((c) => c === 200).length).toBe(6);
    expect(codes.filter((c) => c === 429).length).toBe(2);
  });
});

describe("what the interface promises", () => {
  test("the founder is told their name goes with it, before they type", () => {
    const source = readFileSync("src/components/Wishes.tsx", "utf-8");
    expect(source).toContain("Sent with your name");
    // And in the form, not buried in a confirmation afterwards.
    expect(source.indexOf("Sent with your name")).toBeLessThan(source.indexOf("wi-list"));
  });

  test("the audience is a role, never a named person", () => {
    expect(AUDIENCE_LABEL.organizers).toBe("The organisers");
    expect(AUDIENCE_LABEL.mentors).toBe("The mentors");
    const source = readFileSync("src/components/Wishes.tsx", "utf-8");
    expect(source).not.toContain("Mårten");
  });

  test("the admin badge counts what is unanswered, not what exists", () => {
    // A number that only goes up stops meaning anything.
    expect(admin).toContain('w.status !== "answered"');
  });

  test("mentors get the wishes tab", () => {
    expect(admin).toContain('new Set(["mentor", "shared", "wishes"])');
  });

  test("dates render without crashing on the SQLite format", () => {
    expect(whenLabel("2026-08-25 09:15:00", new Date("2026-12-01"))).toBe("25 Aug");
    expect(whenLabel("2025-08-25 09:15:00", new Date("2026-12-01"))).toBe("25 Aug 2025");
    expect(whenLabel("nonsense")).toBe("");
  });
});
