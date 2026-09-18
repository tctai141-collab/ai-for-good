/**
 * Sending a message to the advisor, and reading the reply as it arrives.
 *
 * Lifted out of the chat component on 18 September 2026, after the cohort
 * reported that roughly every fifth message came back as "Could not reach the
 * server". Two faults were in here, and neither was visible from the
 * component:
 *
 * A POST that dies on a connection the browser had already parked is a
 * network error with no response at all, and browsers do not retry a POST on
 * their own. Nothing has reached the server in that case, so nothing has been
 * spent and nothing can be duplicated by asking once more — which is what this
 * now does, once, before giving up.
 *
 * And the stream was split on newlines one network read at a time, so an SSE
 * frame that straddled two reads was parsed as broken JSON and silently
 * dropped. On a long reply that is a missing word or a missing sentence, with
 * no error anywhere. The leftover of each read is now carried into the next.
 *
 * A stream that breaks mid-answer also no longer throws the answer away. What
 * arrived is kept and marked, because half a reply the founder can read beats
 * a full-width error where their reply used to be.
 */
import { advisorErrorMessage } from "./advisor-errors";

export const RETRY_DELAY_MS = 400;
export const STREAM_CUT_NOTE = "\n\n[The connection dropped before the answer finished.]";

export type Transport = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

/** A browser reports a request that never landed as a TypeError. */
function neverLanded(error: unknown): boolean {
  return error instanceof TypeError;
}

/** One SSE line to the text it carries, or "" for anything else. */
function tokenOf(line: string): string {
  if (!line.startsWith("data: ")) return "";
  const json = line.slice(6).trim();
  if (!json || json === "[DONE]") return "";
  try {
    const chunk = JSON.parse(json) as { choices?: { delta?: { content?: string } }[] };
    return chunk.choices?.[0]?.delta?.content || "";
  } catch {
    return "";
  }
}

/**
 * Returns the assistant's text. Throws an Error whose message is already
 * written for the founder reading it.
 */
export async function sendChat(
  payload: Record<string, unknown>,
  onChunk?: (full: string) => void,
  transport: Transport = {},
): Promise<string> {
  const call = transport.fetchImpl ?? fetch;
  const sleep = transport.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const send = () =>
    call("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

  let res: Response;
  try {
    res = await send();
  } catch (first) {
    if (!neverLanded(first)) throw first instanceof Error ? first : new Error(advisorErrorMessage(null));
    await sleep(RETRY_DELAY_MS);
    try {
      res = await send();
    } catch {
      throw new Error(advisorErrorMessage(null));
    }
  }

  // Carry the status through. Collapsing every failure into one message is
  // what made a 403 look like a dropped connection.
  if (!res.ok) throw new Error(advisorErrorMessage(res.status));

  if (!onChunk) {
    const data = (await res.json()) as { content?: string };
    return data.content || "";
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error(advisorErrorMessage(null));

  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";

  const take = (line: string) => {
    const token = tokenOf(line);
    if (!token) return;
    full += token;
    onChunk(full);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // The last piece may be half a frame. It waits for the next read.
      buffer = lines.pop() ?? "";
      for (const line of lines) take(line);
    }
    take(buffer);
  } catch {
    /* Nothing arrived, so this is the same as never having landed. Say so. */
    if (!full) throw new Error(advisorErrorMessage(null));
    full += STREAM_CUT_NOTE;
    onChunk(full);
  }

  return full;
}
