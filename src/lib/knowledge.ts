import { listKnowledge } from "../db/index";
import { SPRINT_BUDDY_SYSTEM, STYLE_GUARDRAILS } from "./personas";

/**
 * Assembling what Sprint Buddy knows.
 *
 * The pack used to be a string literal, which meant adding something a mentor
 * said required a code change, a review and a deploy. It is now rows in
 * `knowledge_entries`, edited from /admin, assembled here.
 *
 * Assembled in full rather than retrieved. Retrieval solves "more knowledge
 * than fits", and this is a few thousand tokens against a million-token window;
 * with the prompt prefix cached it costs about a tenth of the input rate to
 * send all of it. Retrieval would add embeddings, chunking and a similarity
 * search, and each of those is a chance to fetch the wrong passage. Sending
 * everything cannot miss.
 *
 * The real limit is not cost or context, it is quality: a longer pack gives the
 * model more chances to reach for the wrong thing, and brevity is the hardest
 * part of this voice to hold. Grow it against the eval set, not by instinct.
 */

/** Beyond this, assembling everything stops being obviously the right call. */
export const KNOWLEDGE_BUDGET_CHARS = 60_000;

export type AssembledKnowledge = {
  text: string;
  entries: number;
  chars: number;
  truncated: boolean;
};

/** The one persona left. Kept as a constant so nothing spells it by hand. */
export const PERSONA = "sprint-buddy";

export function assembleKnowledge(persona: string = PERSONA): AssembledKnowledge {
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
    const source = row.source.trim();
    if (!topic && !body) continue;

    /*
     * The source is part of the prompt, not just an admin-table column.
     *
     * It used to be stored and then dropped here, which was invisible until an
     * A/B run measured a prompt with attributions against production behaviour
     * that had none. Sending it is now the point: Sprint Buddy is supposed to
     * say whose idea this is, and it cannot do that from a column it never
     * sees. Entries with no source still work — they simply get cited as
     * nobody's, which is honest.
     */
    const head = topic ? `${topic.toUpperCase()}. ` : "";
    const tail = source ? ` — ${source}` : "";
    const block = `${head}${body}${tail}`;

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
    text:
      "WHAT THE PROGRAMME'S MENTORS HAVE SAID — attribute these when you use them\n\n" +
      parts.join("\n\n"),
    entries: parts.length,
    chars,
    truncated,
  };
}

/**
 * The system prompt as it is actually sent.
 *
 * Voice, then whatever the operating team has put in the database, then the
 * style rules. There is deliberately no fallback pack: an empty knowledge base
 * means Sprint Buddy has nothing of the programme's to quote, and the prompt
 * already tells it to say so rather than improvise. A hardcoded stand-in would
 * hide exactly the state the operating team needs to notice.
 */
export function sprintBuddyPersona(): string {
  const assembled = assembleKnowledge(PERSONA);
  return [SPRINT_BUDDY_SYSTEM, assembled.text, STYLE_GUARDRAILS]
    .filter(Boolean)
    .join("\n\n");
}
