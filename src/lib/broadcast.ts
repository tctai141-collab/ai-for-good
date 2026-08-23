/**
 * Cohort-wide announcements.
 *
 * An organizer types one message and everybody registered receives it, each in
 * their own email addressed to them by name. Three things about this are
 * deliberate.
 *
 * One email per person, never a shared `to:` list. A single message addressed
 * to twenty founders shows every founder the whole cohort's address book. That
 * is a privacy leak that cannot be walked back once sent, and it is the default
 * mistake this module exists to make impossible.
 *
 * Merge tags are validated, not best-effort. A typo like {{firstname}} would
 * otherwise reach the whole cohort as literal braces in the greeting, so an
 * unrecognised tag is a refusal to send rather than a cosmetic flaw.
 *
 * Sends are sequential and recorded one at a time. A blast is not a
 * transaction: if the fifteenth address bounces, the first fourteen have
 * genuinely been delivered and pretending otherwise helps nobody. Each result
 * is written as it happens so the record survives a crash mid-run.
 */
import {
  createBroadcast,
  finishBroadcast,
  recordBroadcastDelivery,
  type BroadcastRecipient,
} from "../db/index";
import { sendBroadcastEmail } from "./email";
import { reportError } from "./errors";

export const MAX_SUBJECT_CHARS = 200;
export const MAX_BODY_CHARS = 20_000;

/**
 * Beyond this the send outlives the HTTP request it is running in.
 *
 * The cohort is about twenty people, so this is headroom rather than a real
 * constraint. If it is ever hit, the fix is a background job, not a bigger
 * number: a request that takes four minutes will be cut off by the proxy
 * halfway through the alphabet.
 */
export const MAX_RECIPIENTS = 200;

/** Resend's default allowance is two requests a second. Stay under it. */
const GAP_MS = 550;

export const TAGS = ["name", "first_name", "email"] as const;
export type Tag = (typeof TAGS)[number];

/**
 * "Aino Virtanen" becomes "Aino".
 *
 * A greeting reading "Hi Aino Virtanen," is the tell that a message was
 * generated rather than written, which is the opposite of what a blast to your
 * own cohort should sound like. {{name}} is still there for the rare case where
 * the full name is what you want.
 */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim();
}

function values(recipient: BroadcastRecipient): Record<Tag, string> {
  return {
    name: recipient.name,
    first_name: firstName(recipient.name),
    email: recipient.email,
  };
}

/** Every {{tag}} in the text that is not one we know how to fill in. */
export function unknownTags(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
    const tag = match[1] ?? "";
    if (!(TAGS as readonly string[]).includes(tag)) found.add(tag);
  }
  return [...found];
}

/** Substitutes the tags. Whitespace inside the braces is tolerated. */
export function render(text: string, recipient: BroadcastRecipient): string {
  const table = values(recipient);
  return text.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (whole, tag: string) =>
    (TAGS as readonly string[]).includes(tag) ? table[tag as Tag] : whole,
  );
}

export type BroadcastResult = {
  id: string;
  sent: number;
  failed: number;
  failures: { email: string; detail: string }[];
};

/**
 * Sends to everyone in `recipients`, one at a time.
 *
 * The broadcast row is written before the first send rather than after the
 * last, so a process that dies halfway leaves evidence of a partial send. The
 * alternative — record at the end — loses the whole thing precisely when you
 * most need to know who already received it.
 */
export async function sendBroadcast(
  id: string,
  actorEmail: string,
  subject: string,
  body: string,
  audience: string,
  contentHash: string,
  recipients: BroadcastRecipient[],
  pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<BroadcastResult> {
  createBroadcast(id, actorEmail, subject, body, audience, contentHash);

  let sent = 0;
  let failed = 0;
  const failures: { email: string; detail: string }[] = [];

  for (const [index, recipient] of recipients.entries()) {
    try {
      await sendBroadcastEmail(
        recipient.email,
        render(subject, recipient),
        render(body, recipient),
      );
      recordBroadcastDelivery(id, recipient.email, "sent");
      sent += 1;
    } catch (error) {
      failed += 1;
      const detail = error instanceof Error ? error.message : "unknown error";
      failures.push({ email: recipient.email, detail });
      recordBroadcastDelivery(id, recipient.email, "failed", detail);
      // One bad address must not silence the rest of the cohort.
      reportError(error, {
        where: "broadcast",
        level: "warning",
        extra: { broadcast: id },
      });
    }
    if (index < recipients.length - 1) await pause(GAP_MS);
  }

  finishBroadcast(id, sent, failed);
  return { id, sent, failed, failures };
}
