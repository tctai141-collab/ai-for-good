import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFounder, createMentor, createOrganizer, post, startServer,
  type Harness, type Session,
} from "./helpers/harness";

/**
 * The operating team's assistant.
 *
 * The brief was "knowledge of everything that happens inside the platform".
 * Taken literally that is a machine an organizer can ask "what did Aino write
 * in her check-in?" and get an answer from, which is the one thing this app
 * promises founders it will never do — on the screen they type into.
 *
 * So nearly all of this is about the boundary. The briefing it answers from
 * must contain exactly what an organizer can already read, and none of what
 * they cannot.
 */

let h: Harness;
let organizer: Session;
let mentor: Session;
let alice: Session;

const PRIVATE_THREAD = "MY-COFOUNDER-IS-STEALING-FROM-US";
const PRIVATE_CHECKIN = "I-CRIED-IN-THE-BATHROOM-ON-TUESDAY";
const SHARED_BODY = "SHARED-CONVERSATION-BODY-TEXT";

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "o@example.test");
  mentor = await createMentor(h, "m@example.test", "M");
  alice = await createFounder(h, organizer, "alice@example.test", "Alice", "alice-password-11");

  // A private conversation.
  await post(h, "/api/persistence", {
    action: "save-thread", userEmail: alice.email,
    thread: {
      id: "private", title: "Private", theme: "team", state: "thinking", lastAt: "now",
      messages: [{ role: "user", content: PRIVATE_THREAD }],
    },
  }, alice.cookie);

  // A conversation she chose to hand over.
  await post(h, "/api/persistence", {
    action: "save-thread", userEmail: alice.email,
    thread: {
      id: "handed", title: "Pricing", theme: "pricing", state: "thinking", lastAt: "now",
      messages: [{ role: "user", content: SHARED_BODY }],
    },
  }, alice.cookie);
  await post(h, "/api/persistence", {
    action: "set-thread-shared", userEmail: alice.email, threadId: "handed", shared: true,
  }, alice.cookie);

  // A check-in, with its written summary.
  await post(h, "/api/persistence", {
    action: "save-checkin", userEmail: alice.email,
    checkin: { id: "c1", theme: "runway", prompt: PRIVATE_CHECKIN, mood: 82, refDecisionId: null },
  }, alice.cookie);

  // Something addressed to the team, which it may read.
  await post(h, "/api/wishes", { audience: "organizers", body: "A session on pricing." }, alice.cookie);
});

afterAll(() => h?.stop());

/*
 * Fetched over HTTP rather than by importing the module.
 *
 * startServer points DB_PATH at the harness for the *server* process; this one
 * still has its own, so calling buildAdminContext() in here read the local
 * development database and cheerfully asserted against somebody else's cohort.
 * Setting DB_PATH in this process instead would work and is what one other
 * test file does, but it leaks into every file sharing the process, which has
 * broken an unrelated suite before.
 *
 * The endpoint returns the briefing verbatim for exactly this reason: an
 * assistant claiming a privacy boundary should let it be read.
 */
async function briefing(): Promise<string> {
  const res = await post(h, "/api/admin/assistant", { briefing: true }, organizer.cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { text: string }).text;
}

describe("what the briefing may not contain", () => {
  test("no word a founder wrote in a private conversation", async () => {
    expect(await briefing()).not.toContain(PRIVATE_THREAD);
  });

  test("no word of a check-in, only its score", async () => {
    /*
     * Organizers have never seen check-in text. They see the 0-100 attention
     * score, which is what the heatmap is built from, and that is what goes in.
     */
    const text = await briefing();
    expect(text).not.toContain(PRIVATE_CHECKIN);
    expect(text).toContain("82");
  });

  test("not even the body of a conversation she handed over", async () => {
    /*
     * Those are readable on the Shared tab, where opening one is recorded and
     * the founder is told it was read. An assistant that swallowed them would
     * make both meaningless: the read would not be attributable, and she would
     * not be told. The title is enough to answer "has anybody shared anything".
     */
    const text = await briefing();
    expect(text).not.toContain(SHARED_BODY);
    expect(text).toContain("Pricing");
  });
});

describe("what it does contain", () => {
  test("the things an organizer can already read", async () => {
    const text = await briefing();
    expect(text).toContain("Alice");
    // Written to the team on purpose, so it is fair game.
    expect(text).toContain("A session on pricing.");
  });
});

describe("who may ask", () => {
  const ask = (who: Session | { cookie: string }) =>
    post(h, "/api/admin/assistant", { messages: [{ role: "user", content: "hello" }] }, who.cookie);

  test("and who may read the briefing — the same people", async () => {
    for (const who of [alice, mentor, { cookie: "" }]) {
      const res = await post(h, "/api/admin/assistant", { briefing: true }, who.cookie);
      expect([401, 403]).toContain(res.status);
      expect(await res.text()).not.toContain(PRIVATE_CHECKIN);
    }
  });

  test("organizers only", async () => {
    expect((await ask({ cookie: "" })).status).toBe(401);
    expect((await ask(alice)).status).toBe(403);
    /* Not because mentors are untrusted: the briefing is the whole cohort's
       state, and a mentor's view of this app is deliberately narrower. */
    expect((await ask(mentor)).status).toBe(403);
  });

  test("an empty conversation is refused before it costs anything", async () => {
    const res = await post(h, "/api/admin/assistant", { messages: [] }, organizer.cookie);
    expect(res.status).toBe(400);
  });
});

describe("what it is told about itself", () => {
  const source = readFileSync("src/lib/admin-context.ts", "utf-8");

  test("it is told to say it cannot see, rather than infer", () => {
    // A score of 82 is a fact. "She is struggling with her cofounder" is not,
    // and is exactly the sentence a helpful model would reach for.
    expect(source).toContain("Do not infer it from the score and present the inference as fact");
    expect(source).toContain("private by design");
  });

  test("it points at the Shared tab rather than summarising what it cannot read", () => {
    expect(source).toContain("Point people there rather than summarising something you cannot read");
  });
});

describe("where it lives", () => {
  const app = readFileSync("src/components/SprintBuddy.tsx", "utf-8");
  const admin = readFileSync("src/pages/admin.astro", "utf-8");

  test("in the dashboard, beside the cohort heatmap", () => {
    /*
     * /admin is where you go to change something. Asking who to talk to this
     * week is not administration — it is what you do before deciding anything,
     * and it belongs next to the heatmap where the question already lives.
     */
    expect(app).toContain("<Assistant />");
    expect(app.indexOf("Cohort heatmap")).toBeLessThan(app.indexOf("<span>Assistant</span>"));
  });

  test("and not on /admin any more", () => {
    expect(admin).not.toContain('data-tab="assistant"');
    expect(admin).not.toContain("asst-");
  });

  test("a mentor is not offered it at all", () => {
    // Absent rather than shown and refused: the briefing behind it is the whole
    // cohort's state, and a mentor's view of this app is narrower on purpose.
    expect(app).toContain("{canAssist && (");
    expect(app).toContain('view === "assistant" && canAssist');
    const appTsx = readFileSync("src/components/App.tsx", "utf-8");
    expect(appTsx).toContain('canAssist={user.role === "organizer"}');
  });

  test("the tab bar keeps its overflow handling", () => {
    // Nine tabs fit today; the fade measures rather than assumes, so it simply
    // does not appear. Worth keeping — the next tab added will need it.
    expect(admin).toContain("is-scrollable");
    expect(admin).toContain("bar.scrollWidth > bar.clientWidth + 1");
  });
});
