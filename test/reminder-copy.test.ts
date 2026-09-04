import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * Reminder emails say what is due and stop.
 *
 * Each kind used to carry a sentence explaining why that particular email had
 * arrived — "far enough out to do something about", "a heads-up rather than a
 * nag" — and every deadline reminder closed by suggesting a check-in. A
 * founder gets up to four of these per deadline, and the subject line and the
 * date already carry everything they opened it for.
 *
 * Asked for directly, and the check-in line had a second problem: it is an
 * unrelated errand attached to a reminder about something else, and the
 * check-in is held closed until the cohort has been shown it, so the sentence
 * pointed at a screen that would not open.
 *
 * Comments stripped before the assertions that forbid a string, because the
 * source explains what it removed by quoting it.
 */

const email = readFileSync("src/lib/email.ts", "utf-8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/** One template, from its function signature to the end of its send(). */
function template(fn: string): string {
  const at = email.indexOf(`export function ${fn}(`);
  expect(`${fn} exists`).toBe(at >= 0 ? `${fn} exists` : `${fn} missing`);
  return email.slice(at, email.indexOf("\n}", at));
}

const deadline = template("sendDeadlineReminder");
const book = template("sendBookReminder");

describe("a deadline reminder", () => {
  test("does not mention the check-in", () => {
    /*
     * The one that was asked for by name. It is a second errand riding along
     * on a reminder about something else, and while the check-in is held
     * closed it points at a screen that will not open.
     */
    expect(deadline).not.toMatch(/check-in/i);
    expect(deadline).not.toContain("takes two minutes");
  });

  test("has no sentence explaining why it arrived", () => {
    // The subject says which deadline and the body says when. Everything else
    // was the email talking about itself.
    expect(deadline).not.toContain("Far enough out");
    expect(deadline).not.toContain("heads-up rather than a nag");
    expect(deadline).not.toContain("Last call on this one");
    expect(deadline).not.toContain("slipped past its date");
    expect(deadline).not.toContain("close enough to plan around");
    /* The whole mechanism, not just today's five strings: a per-kind map of
       prose is how they came back last time. */
    expect(deadline).not.toContain("const opener");
  });

  test("still says what is due, when, and how to stop the emails", () => {
    // Trimming is not the same as removing the point of the message.
    expect(deadline).toContain("${deadline.title}");
    expect(deadline).toContain("${when}");
    expect(deadline).toContain("${deadline.description}");
    expect(deadline).toContain("${appUrl}");
    expect(deadline).toMatch(/reminders stop/);
  });

  test("the subject still names the deadline and the distance to it", () => {
    // Trimming the body puts more weight on the subject, not less.
    for (const line of ["Overdue: ", "Last call: ", "Two days: ", "Three days: ", "Due tomorrow: "]) {
      expect(`${line} present`).toBe(deadline.includes(line) ? `${line} present` : `${line} MISSING`);
    }
  });
});

describe("a book reminder", () => {
  test("has no opener either", () => {
    expect(book).not.toContain("const opener");
    expect(book).not.toContain("No rush today");
    expect(book).not.toContain("Somebody else is probably waiting");
  });

  test("keeps the two lines that are things to do", () => {
    /*
     * Where the book goes, and that the date can be moved. Somebody who cannot
     * bring it back this week needs to know the second one exists — that is an
     * instruction, not the email describing its own tone.
     */
    expect(book).toContain("office shelf");
    expect(book).toContain("tell an organizer and they will move the date");
    expect(book).toContain("${appUrl}");
  });
});
