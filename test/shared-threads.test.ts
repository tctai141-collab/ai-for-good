import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createFounder, createOrganizer, get, post, startServer, type Harness, type Session } from "./helpers/harness";

/**
 * Conversations a founder hands to the operating team.
 *
 * The toggle wrote its flag from the day it shipped and no screen ever read it
 * back, so founders were sharing into a void. These cover the read side, and
 * most of them are about the boundary rather than the feature: the flag is the
 * only thing standing between an organizer and twenty people's private
 * reflections, so it is worth more assertions than the happy path.
 */

let h: Harness;
let organizer: Session;
let alice: Session;
let bob: Session;

async function makeThread(session: Session, id: string, title: string, text: string) {
  const res = await post(h, "/api/persistence", {
    action: "save-thread",
    userEmail: session.email,
    thread: {
      id, title, theme: "team", state: "thinking", lastAt: "now",
      messages: [{ role: "user", content: text }, { role: "assistant", content: "Slow it down." }],
    },
  }, session.cookie);
  expect(res.status).toBe(200);
}

async function share(session: Session, threadId: string, shared: boolean) {
  const res = await post(h, "/api/persistence", {
    action: "set-thread-shared", userEmail: session.email, threadId, shared,
  }, session.cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as { shared: boolean };
}

async function sharedList(session: Session) {
  const res = await get(h, "/api/admin/shared", session.cookie);
  return { status: res.status, body: await res.json() as { threads?: { id: string; seenAt: string | null; messages: { content: string }[] }[] } };
}

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
  alice = await createFounder(h, organizer, "alice@example.test", "Alice", "alice-password-11");
  bob = await createFounder(h, organizer, "bob@example.test", "Bob", "bob-password-1122");
});

afterAll(() => h?.stop());

describe("who may read the shared list", () => {
  test("a founder cannot", async () => {
    expect((await sharedList(alice)).status).toBe(403);
  });

  test("an anonymous caller cannot", async () => {
    expect((await get(h, "/api/admin/shared")).status).toBe(401);
  });

  test("an organizer can", async () => {
    expect((await sharedList(organizer)).status).toBe(200);
  });
});

describe("what appears in it", () => {
  test("nothing, until a founder shares something", async () => {
    await makeThread(alice, "private-1", "Kept to myself", "Something I never handed over.");
    const { body } = await sharedList(organizer);
    expect(body.threads).toEqual([]);
  });

  test("an unshared conversation is not readable even once others are shared", async () => {
    await makeThread(alice, "shared-1", "Handed over", "You can read this one.");
    await share(alice, "shared-1", true);

    const { body } = await sharedList(organizer);
    const blob = JSON.stringify(body.threads);
    expect(blob).toContain("You can read this one.");
    // The line that matters. One shared thread must not drag the rest along.
    expect(blob).not.toContain("Something I never handed over.");
  });

  test("unsharing takes it straight back out", async () => {
    await share(alice, "shared-1", false);
    const { body } = await sharedList(organizer);
    expect(JSON.stringify(body.threads)).not.toContain("You can read this one.");
  });

  test("it carries the founder's name, so a transcript is attributable", async () => {
    await share(alice, "shared-1", true);
    const { body } = await sharedList(organizer);
    expect(JSON.stringify(body.threads)).toContain("Alice");
  });
});

describe("telling the founder it was read", () => {
  test("a freshly shared conversation is unseen", async () => {
    await makeThread(bob, "bob-shared", "Bob shares", "Bob's words.");
    await share(bob, "bob-shared", true);

    const { body } = await sharedList(organizer);
    expect(body.threads!.find((t) => t.id === "bob-shared")!.seenAt).toBeNull();
  });

  test("opening it stamps the time, once", async () => {
    const first = await post(h, "/api/admin/shared", { action: "seen", id: "bob-shared" }, organizer.cookie);
    expect(first.status).toBe(200);

    const { body } = await sharedList(organizer);
    const stamped = body.threads!.find((t) => t.id === "bob-shared")!.seenAt;
    expect(stamped).toBeTruthy();

    // Re-reading must not move it: the founder is told it landed, not watched.
    await post(h, "/api/admin/shared", { action: "seen", id: "bob-shared" }, organizer.cookie);
    const again = await sharedList(organizer);
    expect(again.body.threads!.find((t) => t.id === "bob-shared")!.seenAt).toBe(stamped);
  });

  test("unsharing and sharing again is a fresh act, not still seen", async () => {
    await share(bob, "bob-shared", false);
    await share(bob, "bob-shared", true);

    const { body } = await sharedList(organizer);
    expect(body.threads!.find((t) => t.id === "bob-shared")!.seenAt).toBeNull();
  });

  test("a private conversation cannot be stamped as read", async () => {
    // Otherwise a stray id would mark something the founder never handed over.
    const res = await post(h, "/api/admin/shared", { action: "seen", id: "private-1" }, organizer.cookie);
    expect(res.status).toBe(404);
  });

  test("a founder cannot stamp anything", async () => {
    const res = await post(h, "/api/admin/shared", { action: "seen", id: "bob-shared" }, alice.cookie);
    expect(res.status).toBe(403);
  });
});

describe("the founder's own view", () => {
  test("their thread carries the stamp back to them", async () => {
    await makeThread(alice, "seen-me", "Read this", "Please look at this one.");
    await share(alice, "seen-me", true);

    const before = await get(h, `/api/persistence?resource=threads&user=${encodeURIComponent(alice.email)}`, alice.cookie);
    const beforeBody = await before.json() as { threads: { id: string; shared_seen_at: string | null }[] };
    expect(beforeBody.threads.find((t) => t.id === "seen-me")!.shared_seen_at).toBeNull();

    await post(h, "/api/admin/shared", { action: "seen", id: "seen-me" }, organizer.cookie);

    const after = await get(h, `/api/persistence?resource=threads&user=${encodeURIComponent(alice.email)}`, alice.cookie);
    const afterBody = await after.json() as { threads: { id: string; shared_seen_at: string | null }[] };
    expect(afterBody.threads.find((t) => t.id === "seen-me")!.shared_seen_at).toBeTruthy();
  });

  test("one founder still cannot read another's threads", async () => {
    const res = await get(h, `/api/persistence?resource=threads&user=${encodeURIComponent(bob.email)}`, alice.cookie);
    expect(res.status).toBe(403);
  });
});
