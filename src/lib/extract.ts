import Anthropic from "@anthropic-ai/sdk";
import { AdvisorNotConfiguredError } from "./ai";

/**
 * Turning a mentor transcript into knowledge entries.
 *
 * The operating team records a lot of mentor sessions and none of it reached
 * Sprint Buddy, because the only way in was a code change. This is the way in:
 * paste a session, get candidate entries, keep the good ones.
 *
 * Three things make this harder than "summarise the transcript", and all three
 * are about what must NOT come out.
 *
 * No names. Sessions are closed rooms. A mentor who spent an afternoon with
 * twenty founders has not agreed to be quoted by name by software for the rest
 * of the programme. The session is recorded against the entry as `source` for
 * the operating team, and `assembleKnowledge()` never sends that to the model —
 * but the name has to stay out of the body too, or it reaches the cohort
 * anyway. An earlier run produced entries reading "Bastian bets on people
 * first", which is exactly the leak.
 *
 * No borrowed first person. Sprint Buddy states these as the programme's
 * positions, so a raw quote hands it a life it has not lived. "We walk in the
 * front door and demo it" has to become the position underneath it.
 *
 * No participants. Sessions contain founders asking about their own companies.
 * Their material must not travel to the next cohort, so anything traceable to
 * a participant is left out rather than anonymised — an anonymised story about
 * a real company is still that company's story.
 */

/** Long enough for a rich chunk, short enough that one call stays quick. */
export const MAX_TRANSCRIPT_CHARS = 24_000;
/** Below this there is nothing worth spending a call on. */
export const MIN_TRANSCRIPT_CHARS = 200;

export type Candidate = { topic: string; body: string };

const SYSTEM = `You read transcripts of mentor sessions from a startup programme and turn them into knowledge entries for the programme's AI coach.

The coach states these as the programme's own positions. It is openly software, it has never run a company, and it never names anyone. Write accordingly.

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

1. NO NAMES. Never write the speaker's name, their company's name, or any other person's name in the entry. Not as attribution, not as "X argues that", not in passing. "Bastian bets on people before markets" must become "Back the people before the market — the market is almost always underestimated anyway." If a claim cannot be stated without naming someone, drop it.

2. NO BORROWED FIRST PERSON. The coach has not lived any of this. "We walk in the front door and demo it" becomes "Walking into a prospect's office and demonstrating in person still beats a cold email." "I didn't feel pressure to find a cofounder" becomes "Not every company needs a cofounder; some are better started alone and staffed as the work demands." No "I", "we", "our" or "my" carried over from the speaker.

3. NO QUOTATION. Do not use quotation marks around the speaker's wording. State the position directly in plain prose. A memorable phrasing can survive as plain text if it is genuinely the clearest way to say it, but it must read as the programme's line, not as somebody being quoted.

4. Body: one to four sentences. Plain, direct, unsentimental. No bullet points, no headers, no framework language, no "it is important to".

5. Topic: two to five words, UPPERCASE, naming the subject, not the advice.

6. Invent nothing. Every claim must be traceable to the transcript. No numbers, dates or places that are not in it.

Return the strongest entries only. A short list of sharp entries beats a long list of soft ones — if the chunk yields two, return two. If it yields nothing worth the coach's mouth, return an empty list.`;

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
 * queue and not an import button. The speaker's name is passed in only so the
 * model knows whose material to leave un-named; it is not asked to record it.
 */
export async function extractKnowledge(transcript: string, speaker: string): Promise<Candidate[]> {
  const text = transcript.trim();
  if (text.length < MIN_TRANSCRIPT_CHARS) return [];

  const who = speaker.trim()
    ? `The speaker is ${speaker.trim()}. Do not write that name, or their company's name, anywhere in your output.`
    : "The speaker is not named. Do not invent a name for them.";

  const response = await getClient().messages.create({
    model: "claude-opus-5",
    max_tokens: 8_000,
    system: SYSTEM,
    messages: [
      { role: "user", content: `${who}\n\nTRANSCRIPT\n\n${text.slice(0, MAX_TRANSCRIPT_CHARS)}` },
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

/**
 * Words that appear in company names and also in ordinary sentences.
 *
 * Without this, a mentor from "Index Venture" makes every entry containing the
 * word "venture" light up, and an alarm that fires constantly is one the
 * operating team learns to click past within a day. The cost of the stoplist is
 * that a firm actually called "Partners" would slip through unflagged, which is
 * the right trade: the model is already told three times not to write names,
 * and this is the backstop, not the mechanism.
 */
const GENERIC_NAME_WORDS = new Set([
  "venture", "ventures", "capital", "partners", "group", "labs", "studio",
  "company", "holdings", "invest", "investments", "technologies", "software",
  "digital", "global", "the", "and", "oy", "ab", "inc", "ltd", "gmbh",
]);

/**
 * A last check that the speaker's name did not survive into an entry.
 *
 * The prompt forbids it three times over and mostly obeys, but "mostly" is the
 * wrong standard for something that reaches twenty founders. This flags rather
 * than edits, so the operating team decides. Matching is on whole words,
 * case-insensitively; tokens under three characters are skipped so a mentor
 * called "Ed" does not light up every entry containing "edge", and generic
 * corporate words are skipped so the flag keeps meaning something.
 *
 * Both halves of an entry are checked. A name is just as exposed in a topic as
 * in a body.
 */
export function nameLeaks(text: string, speaker: string): string[] {
  const tokens = speaker
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3 && !GENERIC_NAME_WORDS.has(token.toLowerCase()));
  if (tokens.length === 0) return [];

  const found = new Set<string>();
  for (const token of tokens) {
    const pattern = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "iu");
    if (pattern.test(text)) found.add(token);
  }
  return [...found];
}
