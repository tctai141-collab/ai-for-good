import { listKnowledge } from "../db/index";
import { MARTEN_CORE_BOTTOM, MARTEN_CORE_TOP, MARTEN_DEFAULT_KNOWLEDGE } from "./personas";

/**
 * Assembling an advisor's knowledge from the database.
 *
 * The pack used to be a string literal in personas.ts, which meant adding
 * something Mårten said required a code change, a review and a deploy. It is
 * now rows in `knowledge_entries`, edited from /admin, assembled here.
 *
 * Assembled in full rather than retrieved. Retrieval solves "more knowledge
 * than fits", and this is a few thousand tokens against a million-token window;
 * with the persona prefix cached it costs about a tenth of the input rate to
 * send all of it. Retrieval would add embeddings, chunking and a similarity
 * search, and each of those is a chance to fetch the wrong passage. Sending
 * everything cannot miss.
 *
 * The real limit is not cost or context, it is quality: a longer pack gives the
 * model more chances to reach for the wrong thing, and brevity is the hardest
 * part of this persona to hold. Grow it against the eval set, not by instinct.
 */

/** Beyond this, assembling everything stops being obviously the right call. */
export const KNOWLEDGE_BUDGET_CHARS = 60_000;

export type AssembledKnowledge = {
  text: string;
  entries: number;
  chars: number;
  truncated: boolean;
};

export function assembleKnowledge(persona: string): AssembledKnowledge {
  const rows = listKnowledge(persona);
  if (rows.length === 0) {
    return { text: "", entries: 0, chars: 0, truncated: false };
  }

  const parts: string[] = [];
  let chars = 0;
  let truncated = false;

  for (const row of rows) {
    const topic = row.topic.trim();
    const body = row.body.trim();
    if (!topic && !body) continue;

    const block = topic ? `${topic.toUpperCase()}. ${body}` : body;
    if (chars + block.length > KNOWLEDGE_BUDGET_CHARS) {
      // Stop rather than send a half sentence. Entries are ordered, so what
      // drops is what the operating team ranked lowest.
      truncated = true;
      break;
    }
    parts.push(block);
    chars += block.length;
  }

  if (parts.length === 0) {
    return { text: "", entries: 0, chars: 0, truncated };
  }

  return {
    text: `WHAT YOU KNOW — your actual positions, by topic\n\n${parts.join("\n\n")}`,
    entries: parts.length,
    chars,
    truncated,
  };
}

/**
 * The Mårten system prompt as it is actually sent.
 *
 * Core, then whatever the operating team has put in the database, then the
 * episodes and hard rules. Falls back to the shipped pack if the table has been
 * emptied — an advisor with no knowledge at all would still answer, just
 * blandly, and blandly is harder to notice than broken.
 */
export function martenPersona(): string {
  const assembled = assembleKnowledge("marten");
  const knowledge = assembled.text || MARTEN_DEFAULT_KNOWLEDGE;
  return [MARTEN_CORE_TOP, knowledge, MARTEN_CORE_BOTTOM].join("\n\n");
}
