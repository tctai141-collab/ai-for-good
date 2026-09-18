import { describe, expect, test } from "bun:test";
import { RETRY_DELAY_MS, STREAM_CUT_NOTE, sendChat } from "../src/lib/chat-transport";

/**
 * The cohort reported, on 18 September 2026, that roughly every fifth message
 * came back as "Could not reach the server". These are the two faults that
 * were in the send path, and the third thing it now gets right.
 */

const frame = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

function streamOf(pieces: string[], breakAfter?: number): Response {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (breakAfter !== undefined && i === breakAfter) {
        controller.error(new TypeError("network error"));
        return;
      }
      if (i >= pieces.length) {
        controller.close();
        return;
      }
      controller.enqueue(new TextEncoder().encode(pieces[i]!));
      i += 1;
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("a request that never lands", () => {
  test("is sent once more, because nothing was spent the first time", async () => {
    const attempts: string[] = [];
    let slept = 0;
    const text = await sendChat(
      { messages: [] },
      undefined,
      {
        fetchImpl: (async () => {
          attempts.push("call");
          if (attempts.length === 1) throw new TypeError("Failed to fetch");
          return Response.json({ content: "Here is the answer." });
        }) as unknown as typeof fetch,
        sleep: async (ms) => { slept = ms; },
      },
    );

    expect(attempts).toHaveLength(2);
    expect(slept).toBe(RETRY_DELAY_MS);
    expect(text).toBe("Here is the answer.");
  });

  test("twice in a row is reported as a connection problem, not a server one", async () => {
    await expect(
      sendChat({ messages: [] }, undefined, {
        fetchImpl: (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch,
        sleep: async () => {},
      }),
    ).rejects.toThrow(/Could not reach the server/);
  });

  test("a refusal is not retried: the server answered, and said no", async () => {
    let calls = 0;
    await expect(
      sendChat({ messages: [] }, undefined, {
        fetchImpl: (async () => {
          calls += 1;
          return Response.json({ error: "no" }, { status: 403 });
        }) as unknown as typeof fetch,
        sleep: async () => {},
      }),
    ).rejects.toThrow(/refused that request/);
    expect(calls).toBe(1);
  });
});

describe("reading the stream", () => {
  test("a frame split across two reads is not lost", async () => {
    /* The whole frame, cut in the middle of the JSON. Split on newlines one
       read at a time, this half-line parsed as broken JSON and was dropped in
       silence, taking a word out of the middle of the reply. */
    const whole = frame("carry on") + frame(" regardless");
    const cut = Math.floor(whole.length / 3);
    const seen: string[] = [];

    const text = await sendChat({ messages: [] }, (full) => seen.push(full), {
      fetchImpl: (async () => streamOf([whole.slice(0, cut), whole.slice(cut)])) as unknown as typeof fetch,
    });

    expect(text).toBe("carry on regardless");
    expect(seen[seen.length - 1]).toBe("carry on regardless");
  });

  test("a stream that dies mid-answer keeps what arrived, and marks it", async () => {
    const text = await sendChat({ messages: [] }, () => {}, {
      fetchImpl: (async () => streamOf([frame("This much "), frame("arrived"), frame(" never did")], 2)) as unknown as typeof fetch,
    });

    expect(text).toBe("This much arrived" + STREAM_CUT_NOTE);
  });

  test("a stream that dies before a single token is a connection failure", async () => {
    await expect(
      sendChat({ messages: [] }, () => {}, {
        fetchImpl: (async () => streamOf([frame("never")], 0)) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/Could not reach the server/);
  });

  test("[DONE] and blank lines are not text", async () => {
    const text = await sendChat({ messages: [] }, () => {}, {
      fetchImpl: (async () => streamOf([frame("done"), "data: [DONE]\n\n", "\n"])) as unknown as typeof fetch,
    });
    expect(text).toBe("done");
  });
});
