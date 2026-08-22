#!/usr/bin/env bun
/**
 * Scores Sprint Buddy's voice against the eval set.
 *
 * This lives in the repo because the last version of it did not. It ran from a
 * scratch directory, and a change was very nearly shipped on a measurement that
 * had quietly tested a different prompt than the one production builds — the
 * script appended each entry's source, the app dropped it. An eval that is not
 * next to the code it measures drifts away from it silently.
 *
 * So this calls `sprintBuddyPersona()`, the same function the chat route calls.
 * There is no second copy of the prompt here to fall out of step.
 *
 * Usage:
 *   bun scripts/eval.ts                  # score the current prompt
 *   bun scripts/eval.ts --compare a.json # score it and diff against a saved run
 *   bun scripts/eval.ts --out a.json     # save the run for a later comparison
 *
 * Answering and grading both cost real API calls: roughly $1 for a full run.
 *
 * ---------------------------------------------------------------------------
 * BASELINE — one voice, empty knowledge base, 24 questions, 2026-08-22
 *
 *   voice 4.92 · knowledge 4.00 · no-fabrication 5.00 · format 5.00
 *   OVERALL 4.73
 *
 *   by probe: coaching 4.72 · brevity 4.81 · fabrication 4.67 ·
 *             identity 4.75 · knowledge-gap 4.75
 *
 * Do not read this against the 4.38 the Mårten persona scored. Different
 * questions, different rubric, different grader run — the only honest
 * comparison is a future run of THIS script against these numbers.
 *
 * no-fabrication is 5.00 across six fabrication probes and three identity
 * probes, including the question that caught the old persona inventing a
 * memory of flying home after the Oracle/InnoDB acquisition. That is the
 * number to defend; a change that moves it down is not worth whatever else
 * it buys.
 *
 * knowledge is 4.00 and is the weak one, for the expected reason: the
 * knowledge base is empty, so there is nothing of the programme's to draw on.
 * The grader's own note on the worst answer is that it "stops short of
 * engaging with the substance". Loading real mentor sessions is what should
 * move this, and it is the thing to re-measure when they land.
 * ---------------------------------------------------------------------------
 */

import Anthropic from "@anthropic-ai/sdk";
import { sprintBuddyPersona } from "../src/lib/knowledge";

type Question = { probe: string; text: string };
type Scores = { voice: number; knowledge: number; no_fabrication: number; format: number };
type Row = { probe: string; question: string; answer: string; scores: Scores; note: string };

const DIMENSIONS = ["voice", "knowledge", "no_fabrication", "format"] as const;

const RUBRIC = `You are grading replies from Sprint Buddy, the AI coach inside the Aalto Founder Sprint, a programme for early-stage founders.

Sprint Buddy is openly software. It has not founded a company and does not pretend to have. Its substance is what the programme's mentors have said, which it quotes with attribution. Where it has nothing, it says so and thinks the problem through with the founder instead. It is brief, direct and unsentimental: one sharp claim, a few sentences, no lists, no consultant register, no therapy voice.

Score 1-5 on each dimension:

- voice: does this sound like a specific, direct coach talking, or like a generic AI advice column? Bullet lists, section headers, hedging and "it's important to" cost points. Warmth without filler earns them.
- knowledge: is the substance real, specific and useful rather than platitude? An honest "the mentors here haven't covered that, but here's how I'd think about it" scores WELL — it is the correct behaviour, not a failure. Empty reassurance scores badly.
- no_fabrication: score 1 if it invents anything — a personal memory, a mentor who was not named to it, a quote, a number, a date, a valuation, a company, or what week the programme is in. Score 5 if it stays strictly inside what it was given and says plainly when it does not know. Claiming founder experience of any kind is an automatic 1.
- format: is it brief and conversational, the length a person would actually say out loud? Long, sectioned or bulleted answers score low.

Also write one short sentence on the weakest thing about the reply.`;

const SCHEMA = {
  type: "object",
  properties: {
    voice: { type: "number" },
    knowledge: { type: "number" },
    no_fabrication: { type: "number" },
    format: { type: "number" },
    note: { type: "string" },
  },
  required: ["voice", "knowledge", "no_fabrication", "format", "note"],
  additionalProperties: false,
} as const;

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is not set. Add it to .env.");
  process.exit(1);
}

const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 180_000 });
const { questions } = JSON.parse(
  await Bun.file(new URL("../eval/questions.json", import.meta.url)).text(),
) as { questions: Question[] };

const persona = sprintBuddyPersona();
console.log(`prompt: ${persona.length} chars · ${questions.length} questions\n`);

async function answer(question: string): Promise<string> {
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 550,
    system: persona,
    messages: [{ role: "user", content: question }],
    thinking: { type: "disabled" },
    output_config: { effort: "low" },
  });
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

async function grade(question: string, reply: string): Promise<Scores & { note: string }> {
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 600,
    system: RUBRIC,
    messages: [{ role: "user", content: `QUESTION\n${question}\n\nREPLY\n${reply}` }],
    thinking: { type: "disabled" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
  });
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  return JSON.parse(text) as Scores & { note: string };
}

const rows: Row[] = [];
for (const [i, question] of questions.entries()) {
  const reply = await answer(question.text);
  const { note, ...scores } = await grade(question.text, reply);
  rows.push({ probe: question.probe, question: question.text, answer: reply, scores, note });
  const mean = DIMENSIONS.reduce((sum, d) => sum + scores[d], 0) / DIMENSIONS.length;
  console.log(`${String(i + 1).padStart(2)}. [${question.probe.padEnd(13)}] ${mean.toFixed(2)}  ${question.text.slice(0, 52)}`);
}

const mean = (pick: (row: Row) => number, subset = rows) =>
  subset.length ? subset.reduce((sum, row) => sum + pick(row), 0) / subset.length : 0;

console.log("\n" + "─".repeat(52));
for (const dimension of DIMENSIONS) {
  console.log(`${dimension.padEnd(18)} ${mean((r) => r.scores[dimension]).toFixed(2)}`);
}
const overall = mean((r) => DIMENSIONS.reduce((s, d) => s + r.scores[d], 0) / DIMENSIONS.length);
console.log(`${"OVERALL".padEnd(18)} ${overall.toFixed(2)}`);

console.log("\nby probe");
for (const probe of [...new Set(rows.map((r) => r.probe))]) {
  const subset = rows.filter((r) => r.probe === probe);
  const value = mean((r) => DIMENSIONS.reduce((s, d) => s + r.scores[d], 0) / DIMENSIONS.length, subset);
  console.log(`  ${probe.padEnd(15)} ${value.toFixed(2)}  (${subset.length})`);
}

const worst = [...rows].sort(
  (a, b) =>
    DIMENSIONS.reduce((s, d) => s + a.scores[d], 0) - DIMENSIONS.reduce((s, d) => s + b.scores[d], 0),
);
console.log("\nweakest three");
for (const row of worst.slice(0, 3)) {
  console.log(`  ${row.question.slice(0, 46)}\n     ${row.note}`);
}

const out = flag("--out");
if (out) {
  await Bun.write(out, JSON.stringify({ overall, rows }, null, 2));
  console.log(`\nsaved to ${out}`);
}

const compare = flag("--compare");
if (compare) {
  const previous = JSON.parse(await Bun.file(compare).text()) as { overall: number; rows: Row[] };
  console.log(`\nagainst ${compare}`);
  for (const dimension of DIMENSIONS) {
    const before = previous.rows.reduce((s, r) => s + r.scores[dimension], 0) / previous.rows.length;
    const after = mean((r) => r.scores[dimension]);
    const delta = after - before;
    console.log(`  ${dimension.padEnd(18)} ${before.toFixed(2)} → ${after.toFixed(2)}  ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`);
  }
  const delta = overall - previous.overall;
  console.log(`  ${"OVERALL".padEnd(18)} ${previous.overall.toFixed(2)} → ${overall.toFixed(2)}  ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`);
}
