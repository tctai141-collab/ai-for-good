/**
 * Spotting a decision in what a founder has just written, and describing it
 * back in enough of their own words to be recognisable later.
 *
 * The summary used to be the first nine words, full stop. In the decision
 * journal that reads as a fragment — "Should I move the launch or" and then
 * nothing — and Saga reported the consequence on 18 September 2026: the whole
 * message is not visible, so she had to go and find it in the conversation to
 * know what the entry was about. Nine words is a title where a sentence was
 * needed.
 *
 * So: the founder's first sentence, capped. Long enough to carry the decision,
 * short enough that the journal is still a list rather than a transcript. The
 * conversation is linked beside it for everything the sentence leaves out.
 */

/** Roughly two lines on a phone. */
export const DECISION_SUMMARY_CHARS = 220;

export type Detected =
  | { present: false }
  | { present: true; summary: string; door: "reversible" | "one-way"; theme: string };

/** Cuts at a word, never mid-word, and only says "…" when something was cut. */
function trimToWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

export function decisionSummary(text: string): string {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";

  /* The first sentence, when there is one worth having. A short opener
     ("Hi." or "Quick one.") is a greeting rather than the decision, so the
     rest of the message carries it. The threshold is low on purpose: "Should
     I fire the contractor?" is twenty-nine characters and is the whole
     decision. */
  const MIN_SENTENCE_CHARS = 20;
  const end = clean.search(/[.!?](\s|$)/);
  const firstSentence = end > 0 ? clean.slice(0, end + 1) : clean;
  const chosen = firstSentence.length >= MIN_SENTENCE_CHARS ? firstSentence : clean;

  const trimmed = trimToWord(chosen, DECISION_SUMMARY_CHARS);
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function detectDecision(text: string, theme: string): Detected {
  const t = (text || "").toLowerCase();
  const looksLikeDecision = /should i|whether|torn|deciding|decide|do i|or wait|or not|\bvs\b|either/.test(t);
  if (!looksLikeDecision) return { present: false };
  const door = /fire|shut|quit|sell|sign|permanent|delay launch/.test(t) ? "one-way" : "reversible";
  return { present: true, summary: decisionSummary(text), door, theme };
}
