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
    if (!topic && !body) continue;

    /*
     * `row.source` is deliberately not here.
     *
     * It records which session an entry came from, which is what lets the
     * operating team archive a whole mentor in one click and trace an entry
     * back. It is not credit, and it must not reach a founder: those sessions
     * were closed rooms and nobody in them agreed to be quoted by name for the
     * rest of the programme. What the sessions produce becomes the programme's
     * position. `test/knowledge.test.ts` guards this — a source is saved and
     * the prompt is checked for any trace of the name.
     */
    const block = topic ? `${topic.toUpperCase()}. ${body}` : body;

    if (chars + block.length > KNOWLEDGE_BUDGET_CHARS) {
      /*
       * Skip this one and keep going, rather than stopping here.
       *
       * The old version broke out of the loop, and the comment claimed what
       * dropped was "what the operating team ranked lowest". It was not. Rows
       * come back ordered by `position`, and an import appends after
       * everything already there, so what actually dropped was whatever was
       * loaded most recently — the seventh mentor added in October, entirely,
       * for no reason but arriving last. Loading six sessions hit this: 14
       * entries vanished and all 14 belonged to the last one in.
       *
       * Continuing means a long entry near the ceiling is skipped while
       * shorter later ones still fit, so the loss is spread across the pack
       * instead of amputating its tail. Neither is a substitute for the
       * operating team noticing — `truncated` is reported in /admin for that.
       */
      truncated = true;
      continue;
    }
    parts.push(block);
    chars += block.length;
  }

  if (parts.length === 0) {
    return { text: "", entries: 0, chars: 0, truncated };
  }

  return {
    text: "WHAT THIS PROGRAMME TEACHES\n\n" + parts.join("\n\n"),
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
