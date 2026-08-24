import Anthropic from "@anthropic-ai/sdk";
import {
  WORKING_GENIUS_ITEMS,
  typeById,
  type WorkingGeniusAnswer,
  type WorkingGeniusId,
  type WorkingGeniusResponses,
} from "./workingGenius";
import { reportError } from "./errors";

/**
 * Reading the free text a founder wrote on the assessment.
 *
 * This runs exactly once, at submission, and what it decides is stored beside
 * the raw text. It is deliberately not part of scoring: `scoreWorkingGenius` is
 * a pure function over stored data, so re-reading a row a year from now returns
 * the same profile it returned on the day. A classifier inside the scorer would
 * mean a founder's result could move between two loads of the same page, and
 * there would be no record of what it decided or why.
 *
 * Storing the classification separately also makes it correctable. If the
 * reading is wrong, the row can be edited without re-running anything, and the
 * founder's own words are still there to check it against.
 *
 * If the model is unreachable, every answer with text abstains. That is the
 * safe direction: an abstention is reported in the result as reduced
 * confidence, where a guess would be presented as a finding.
 */

/** What the classifier decided about one free-text answer. */
export type TextReading = {
  itemId: string;
  resolved: WorkingGeniusId | "neither";
  /** One line, in the model's words, for the audit trail. */
  why: string;
};

const MODEL = "claude-sonnet-5";

function buildPrompt(entries: Array<{ itemId: string; clicked: string; text: string }>): string {
  const items = entries.map((e) => {
    const item = WORKING_GENIUS_ITEMS.find((i) => i.id === e.itemId);
    if (!item) return null;
    const [a, b] = item.options;
    return [
      `ITEM ${item.id}`,
      `Situation: ${item.prompt}`,
      `Option ${a.id}: ${a.label}`,
      `Option ${b.id}: ${b.label}`,
      `They clicked: ${e.clicked}`,
      `They wrote: ${e.text}`,
    ].join("\n");
  });

  return [
    "You are reading what a founder wrote on a working-style assessment.",
    "",
    "Each item offers two behaviours. The founder could click one, or answer",
    '"neither" and describe what they actually do. Some also added context to a',
    "choice they did make.",
    "",
    "For each item below, decide which of the two named options the described",
    'behaviour actually matches, or "neither" if it genuinely matches neither.',
    "",
    "How to read them:",
    "",
    "- The text outranks the click. A click is a nearest fit against two options",
    "  someone else wrote; the text is unprompted and specific. If they",
    "  contradict each other, go with the text.",
    "- Watch for conditionals. \"Depends\", \"usually X but when Y\", \"only if\". A",
    "  conditional is not a failure to answer, it marks where their energy",
    "  actually shifts. If the condition is common in their working life, resolve",
    "  to the behaviour it produces most of the time. If the two halves are",
    '  genuinely balanced, answer "neither".',
    "- Watch for the gap between what someone says they would like and what they",
    '  describe doing. "I would love to lead but I end up doing it solo" resolves',
    "  to the behaviour, not the wish.",
    '- Do not force a fit. "Neither" is a real answer and is handled properly',
    "  downstream. Guessing is worse than abstaining, because a guess is",
    "  presented to the founder as a finding.",
    "",
    "Reply with JSON only, no prose, in this shape:",
    '{"readings":[{"itemId":"wi-a","resolved":"wonder","why":"one short sentence"}]}',
    "",
    'resolved must be one of the two option ids named in that item, or "neither".',
    "",
    "---",
    "",
    items.filter(Boolean).join("\n\n"),
  ].join("\n");
}

/**
 * Resolves every free-text answer in a response set.
 *
 * Returns the responses with `resolved` filled in. Answers without text are
 * returned untouched.
 */
export async function resolveFreeText(
  responses: WorkingGeniusResponses,
  apiKey: string | undefined,
): Promise<{ responses: WorkingGeniusResponses; readings: TextReading[] }> {
  const entries: Array<{ itemId: string; clicked: string; text: string }> = [];
  for (const [itemId, raw] of Object.entries(responses)) {
    if (typeof raw === "string" || !raw) continue;
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (!text) continue;
    entries.push({ itemId, clicked: String(raw.choice), text });
  }
  if (entries.length === 0) return { responses, readings: [] };

  if (!apiKey) {
    /* No key configured. Everything with text abstains, which the result then
       reports as reduced confidence rather than inventing a reading. */
    return { responses, readings: [] };
  }

  try {
    const client = new Anthropic({ apiKey });
    const reply = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      messages: [{ role: "user", content: buildPrompt(entries) }],
    });

    const text = reply.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();

    /* The model was told to return bare JSON; a fenced block is the common way
       that goes wrong and is cheap to survive. */
    const json = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(json) as { readings?: unknown };
    if (!Array.isArray(parsed.readings)) return { responses, readings: [] };

    const byId = new Map(WORKING_GENIUS_ITEMS.map((i) => [i.id, i]));
    const readings: TextReading[] = [];
    const next: WorkingGeniusResponses = { ...responses };

    for (const raw of parsed.readings) {
      if (typeof raw !== "object" || raw === null) continue;
      const r = raw as { itemId?: unknown; resolved?: unknown; why?: unknown };
      if (typeof r.itemId !== "string" || typeof r.resolved !== "string") continue;

      const item = byId.get(r.itemId);
      if (!item) continue;
      /* Only a type this item actually offers, or "neither". A model naming a
         type that was never on screen for that item would put a win into a
         contest that never happened. */
      const allowed = r.resolved === "neither" || item.options.some((o) => o.id === r.resolved);
      if (!allowed) continue;

      const current = next[r.itemId];
      if (typeof current === "string" || !current) continue;
      next[r.itemId] = {
        ...current,
        resolved: r.resolved as WorkingGeniusId | "neither",
      } satisfies WorkingGeniusAnswer;
      readings.push({
        itemId: r.itemId,
        resolved: r.resolved as WorkingGeniusId | "neither",
        why: typeof r.why === "string" ? r.why.slice(0, 300) : "",
      });
    }

    return { responses: next, readings };
  } catch (error) {
    reportError(error, { where: "workingGeniusText.resolveFreeText" });
    /* Unreachable model, malformed reply, anything: abstain. The founder still
       gets a profile, and the result says which parts were soft. */
    return { responses, readings: [] };
  }
}

/**
 * The narrative pass over everything the founder wrote.
 *
 * Separate from classification on purpose: classification has to be tight and
 * checkable, this is allowed to be discursive. It produces the "In your own
 * words" section of the report.
 */
export function buildNarrativePrompt(
  responses: WorkingGeniusResponses,
  ranking: WorkingGeniusId[],
): string {
  const written: string[] = [];
  for (const item of WORKING_GENIUS_ITEMS) {
    const raw = responses[item.id];
    if (typeof raw === "string" || !raw) continue;
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (!text) continue;
    written.push(`Q: ${item.prompt}\nThey clicked: ${String(raw.choice)}\nThey wrote: ${text}`);
  }
  if (written.length === 0) return "";

  const order = ranking.map((id) => typeById(id).label).join(" > ");

  return [
    "A founder has finished a working-style assessment. Their ranking came out:",
    order,
    "",
    "Alongside the forced choices they wrote the following in their own words.",
    "Write a short reading of it for them, in second person, three paragraphs at",
    "most. It goes in a report they will bring to a session.",
    "",
    "What to do with it:",
    "",
    "- Quote their own words back where it supports a point. It makes the",
    "  reading feel earned rather than generated.",
    "- Name conditionals plainly. Where their energy shifts is often more useful",
    "  than any single answer.",
    "- If they described a gap between what they would like to do and what they",
    "  actually do, name that tension. It is real and worth seeing, not a",
    "  contradiction to resolve for them.",
    "- Never discard an answer for not fitting the two options. A pattern that",
    "  does not map cleanly is a result. If what they describe fits no neat",
    "  profile, say so and describe what it is instead of reaching for the",
    "  nearest match.",
    "",
    "Do not congratulate them, do not summarise the six types back at them, and",
    "do not recommend anything to read or buy. Plain, direct, unsentimental.",
    "",
    "---",
    "",
    written.join("\n\n"),
  ].join("\n");
}
