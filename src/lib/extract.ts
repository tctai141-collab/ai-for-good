import Anthropic from "@anthropic-ai/sdk";
import { AdvisorNotConfiguredError } from "./ai";

/**
 * Turning a mentor transcript into knowledge entries.
 *
 * The operating team records a lot of mentor sessions and none of it reached
 * the advisor, because the only way in was a code change. This is the way in:
 * paste a transcript, get candidate entries, keep the good ones.
 *
 * Two things make this harder than "summarise the transcript".
 *
 * The first is voice. The entries land in a section headed "your actual
 * positions", so whatever comes out is spoken by Mårten afterwards. A raw quote
 * carries the speaker's first person with it — "I didn't have pressure to find
 * a cofounder" is Annu's life, and Mårten saying it contradicts his own, since
 * he had cofounders. So the extraction rewrites borrowed testimony into a
 * position anyone can hold, and keeps names only where they are third-person
 * fact ("Bastian invests in people before markets"), which Mårten can know
 * about someone without claiming to be them.
 *
 * The second is privacy. Sessions contain founders asking about their own
 * companies. Their material must not travel to the next cohort, so anything
 * traceable to a participant is left out rather than anonymised — an
 * anonymised story about a named company is still that company's story.
 */

/** Long enough for a rich chunk, short enough that one call stays quick. */
export const MAX_TRANSCRIPT_CHARS = 24_000;
/** Below this there is nothing worth spending a call on. */
export const MIN_TRANSCRIPT_CHARS = 200;

export type Candidate = { topic: string; body: string };

const SYSTEM = `You read transcripts of mentor sessions from a startup programme and turn them into knowledge entries for an AI advisor.

The advisor speaks as Mårten Mickos — Finnish, ex-CEO of MySQL and Eucalyptus, later SVP at HackerOne. Everything you write will be spoken by him, in his own voice, as his own view. Write accordingly.

EXTRACT a claim when it is:
- a position, principle, heuristic or rule of thumb about building companies
- specific enough to act on, and true beyond the speaker's own company
- something a founder in the programme could use next week

DO NOT EXTRACT:
- anything about a participant, their company, their product, their raise or their problem, even unnamed. A disguised story about a real founder is still that founder's story.
- company profile: the speaker's headcount, funding history, org chart, product roadmap, market position
- logistics, scheduling, introductions, small talk, thanks
- generic advice with no edge ("work hard", "talk to customers") unless the transcript gives it a concrete, non-obvious twist

FORM — this part matters most:
- Write each entry as a position Mårten holds, not as a report of what somebody said.
- Never carry over the speaker's first person. "We walk in the front door and demo it" becomes "Walking into a prospect's office and demonstrating in person still beats a cold email." "I didn't feel pressure to find a cofounder" becomes "Not every company needs a cofounder; some are better started alone and staffed as the work demands."
- A named person may appear only as third-person fact that Mårten could plausibly know: "Bastian at Index invests in people before markets" is fine. Never put words in a named person's mouth as a remembered conversation.
- A short quoted phrase is allowed when the wording is the point, but it must not be first-person testimony.
- Body: one to four sentences. Plain, direct, unsentimental. No bullet points, no headers, no framework language, no "it is important to".
- Topic: two to five words, UPPERCASE, naming the subject, not the advice.
- Invent nothing. Every claim must be traceable to the transcript. No numbers, dates, places or names that are not in it.

Return the strongest entries only. A short list of sharp entries beats a long list of soft ones — if the chunk yields two, return two. If it yields nothing worth an advisor's mouth, return an empty list.`;

const SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string" },
          body: { type: "string" },
        },
        required: ["topic", "body"],
        additionalProperties: false,
      },
    },
  },
  required: ["entries"],
  additionalProperties: false,
} as const;

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AdvisorNotConfiguredError();
  if (!cachedClient) {
    cachedClient = new Anthropic({
      apiKey,
      ...(process.env.ANTHROPIC_BASE_URL?.trim()
        ? { baseURL: process.env.ANTHROPIC_BASE_URL.trim() }
        : {}),
      // Nobody is watching a chat cursor here — an organizer is watching a
      // progress counter — so this can wait longer than the advisor does.
      maxRetries: 1,
      timeout: 120_000,
    });
  }
  return cachedClient;
}

/** Test seam, mirroring the advisor's. */
export function resetExtractClient(): void {
  cachedClient = null;
}

/**
 * Splits a transcript into chunks a single call can handle.
 *
 * Breaks on blank lines so a chunk boundary rarely lands mid-thought. A single
 * paragraph longer than the cap is hard-split rather than dropped.
 */
export function chunkTranscript(text: string, size = MAX_TRANSCRIPT_CHARS): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";

  const push = () => {
    const trimmed = current.trim();
    if (trimmed.length >= MIN_TRANSCRIPT_CHARS) chunks.push(trimmed);
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > size) {
      push();
      for (let i = 0; i < paragraph.length; i += size) {
        chunks.push(paragraph.slice(i, i + size));
      }
      continue;
    }
    if (current.length + paragraph.length + 2 > size) push();
    current += (current ? "\n\n" : "") + paragraph;
  }
  push();

  return chunks;
}

/**
 * One chunk in, candidate entries out. Writes nothing.
 *
 * Kept deliberately separate from saving. The operating team sees every entry
 * before it can reach a founder, which is the whole reason this is a review
 * queue and not an import button.
 */
export async function extractKnowledge(transcript: string, source: string): Promise<Candidate[]> {
  const text = transcript.trim();
  if (text.length < MIN_TRANSCRIPT_CHARS) return [];

  const response = await getClient().messages.create({
    model: "claude-opus-5",
    max_tokens: 8_000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `The speaker is: ${source || "an unnamed mentor"}.\n\nTRANSCRIPT\n\n${text.slice(0, MAX_TRANSCRIPT_CHARS)}`,
      },
    ],
    thinking: { type: "disabled" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
  });

  const raw = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  let parsed: { entries?: unknown };
  try {
    parsed = JSON.parse(raw) as { entries?: unknown };
  } catch {
    // A malformed response is worth nothing but must not take the panel down
    // mid-run; the operator sees a chunk that yielded nothing and continues.
    return [];
  }

  if (!Array.isArray(parsed.entries)) return [];

  return parsed.entries
    .map((entry) => entry as { topic?: unknown; body?: unknown })
    .map((entry) => ({
      topic: typeof entry.topic === "string" ? entry.topic.trim().toUpperCase().slice(0, 120) : "",
      body: typeof entry.body === "string" ? entry.body.trim().slice(0, 8_000) : "",
    }))
    .filter((entry) => entry.body.length > 20);
}
