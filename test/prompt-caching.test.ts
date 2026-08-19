import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createFounder, createOrganizer, post, startServer, type Harness, type Session } from "./helpers/harness";

/**
 * Prompt caching on the persona.
 *
 * The grounded Mårten prompt is around 3k tokens and was being re-billed in
 * full on every turn of every conversation. It is identical for every message
 * from every founder using that persona, so it belongs behind a cache
 * breakpoint.
 *
 * The failure mode this guards is silent and expensive: caching only works if
 * the cached prefix is byte-identical and comes first. Fold anything
 * per-request into it — the posture line, or the check-in framing, which
 * carries the current server time — and every request misses while still
 * looking completely normal. Nothing about the replies would tell you.
 */

let h: Harness;
let organizer: Session;
let founder: Session;

async function chat(body: Record<string, unknown>) {
  const res = await post(h, "/api/chat", {
    messages: [{ role: "user", content: "Where should I start?" }],
    ...body,
  }, founder.cookie);
  expect(res.status).toBe(200);
  return h.advisorCalls[h.advisorCalls.length - 1]!;
}

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
  founder = await createFounder(h, organizer, "founder@example.test", "Aino", "founder-password-11");
});

afterAll(() => h?.stop());

describe("the persona is cached", () => {
  test("it is the first block and carries a cache breakpoint", async () => {
    const call = await chat({ personality: "marten", posture: "thinking" });

    expect(call.systemBlocks.length).toBeGreaterThan(0);
    expect(call.systemBlocks[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(call.systemBlocks[0]!.text).toContain("Mårten Mickos");
  });

  test("the per-request half is a separate, uncached block", async () => {
    const call = await chat({ personality: "marten", posture: "panic" });

    // The posture must not be inside the cached prefix.
    expect(call.systemBlocks[0]!.text).not.toContain("PANIC");
    const tail = call.systemBlocks.slice(1).map((b) => b.text).join("\n");
    expect(tail).toContain("PANIC");
    expect(call.systemBlocks.slice(1).every((b) => b.cache_control === undefined)).toBe(true);
  });
});

describe("the cached prefix is stable", () => {
  test("byte-identical across postures", async () => {
    // If the prefix changed with posture, every switch would cost a fresh write.
    const thinking = await chat({ personality: "marten", posture: "thinking" });
    const venting = await chat({ personality: "marten", posture: "venting" });

    expect(venting.systemBlocks[0]!.text).toBe(thinking.systemBlocks[0]!.text);
  });

  test("byte-identical across founders", async () => {
    const second = await createFounder(h, organizer, "second@example.test", "Bo", "second-password-11");
    const first = await chat({ personality: "marten", posture: "thinking" });

    const res = await post(h, "/api/chat", {
      messages: [{ role: "user", content: "Same question." }],
      personality: "marten",
      posture: "thinking",
    }, second.cookie);
    expect(res.status).toBe(200);
    const other = h.advisorCalls[h.advisorCalls.length - 1]!;

    // One cache entry serves the whole cohort, not one per person.
    expect(other.systemBlocks[0]!.text).toBe(first.systemBlocks[0]!.text);
  });

  test("a check-in does not contaminate it with the current time", async () => {
    /*
     * The sharpest version of the bug. The check-in prompt embeds
     * serverTime, so concatenating it onto the persona would change the prefix
     * on literally every request and the cache would never once hit.
     */
    const plain = await chat({ personality: "marten", posture: "thinking" });
    const checkin = await chat({ personality: "marten", kind: "checkin", userEmail: founder.email });

    expect(checkin.systemBlocks[0]!.text).toBe(plain.systemBlocks[0]!.text);
    expect(checkin.systemBlocks[0]!.text).not.toContain("LAST_CHECKIN");
  });

  test("each persona gets its own prefix", async () => {
    const marten = await chat({ personality: "marten", posture: "thinking" });
    const house = await chat({ personality: "none", posture: "thinking" });

    expect(house.systemBlocks[0]!.text).not.toBe(marten.systemBlocks[0]!.text);
    expect(house.systemBlocks[0]!.text).not.toContain("Mårten Mickos");
  });
});
