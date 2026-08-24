import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PAIRINGS, pairingFor, pairingTypes } from "../src/lib/workingGeniusPairs";
import { WIDGET_ORDER, typeById, type WorkingGeniusId } from "../src/lib/workingGenius";

/**
 * The pairings and the printable report.
 *
 * The originality rules are the load-bearing part here. The six-type model is
 * used internally with approval; the commercial instrument built on it is a
 * licensed product this project does not hold a licence for. So the structural
 * vocabulary is kept and everything else is written fresh, and the checks below
 * are what stop that drifting.
 */

const report = readFileSync("src/pages/report.astro", "utf-8");
const pairs = readFileSync("src/lib/workingGeniusPairs.ts", "utf-8");

describe("the fifteen pairings", () => {
  test("there are exactly fifteen, one per pair, none repeated", () => {
    expect(PAIRINGS).toHaveLength(15);
    const keys = PAIRINGS.map((p) =>
      [...p.pair].sort((a, b) => WIDGET_ORDER.indexOf(a) - WIDGET_ORDER.indexOf(b)).join("+"),
    );
    expect(new Set(keys).size).toBe(15);
  });

  test("every combination of two different types is covered", () => {
    for (const a of WIDGET_ORDER) {
      for (const b of WIDGET_ORDER) {
        if (a === b) continue;
        // Order-insensitive: a founder's top two arrive in ranking order, not
        // WIDGET order, and looking up the wrong way round must not throw.
        expect(() => pairingFor(a, b)).not.toThrow();
        expect(pairingFor(a, b)).toBe(pairingFor(b, a));
      }
    }
  });

  test("no pairing is a type against itself", () => {
    for (const p of PAIRINGS) expect(p.pair[0]).not.toBe(p.pair[1]);
  });

  test("every name is distinct and ours", () => {
    const names = PAIRINGS.map((p) => p.name);
    expect(new Set(names).size).toBe(15);
    for (const n of names) {
      expect(n.length).toBeGreaterThan(3);
      // A pairing name that is just the two type names is not a name.
      for (const t of WIDGET_ORDER) expect(n.toLowerCase()).not.toContain(t);
    }
  });

  test("every pairing says what it needs and what grinds it down", () => {
    /*
     * Not decoration. A pairing page that only flatters is a horoscope; the
     * failure mode is the half a founder can act on.
     */
    for (const p of PAIRINGS) {
      expect([p.name, p.inPractice.length > 200]).toEqual([p.name, true]);
      expect([p.name, p.thrives.length > 80]).toEqual([p.name, true]);
      expect([p.name, p.frustrates.length > 80]).toEqual([p.name, true]);
    }
  });

  test("the copy is second person and unsentimental", () => {
    for (const p of PAIRINGS) {
      expect([p.name, /\byou\b|\byour\b/i.test(p.inPractice)]).toEqual([p.name, true]);
    }
  });

  test("no religious framing anywhere", () => {
    /*
     * Published versions describe these as God-given talents. This is a
     * university programme; they are natural, observed, characteristic.
     */
    const text = PAIRINGS.map((p) => `${p.inPractice} ${p.thrives} ${p.frustrates}`).join(" ").toLowerCase();
    for (const word of ["god", "god-given", "gift from", "blessed", "divine", "creator"]) {
      expect([word, text.includes(word)]).toEqual([word, false]);
    }
  });

  test("no em dashes", () => {
    const text = PAIRINGS.map((p) => `${p.name}${p.inPractice}${p.thrives}${p.frustrates}`).join("");
    expect(text.includes("—")).toBe(false);
  });

  test("pairingTypes names both types in full", () => {
    const p = pairingFor("wonder", "tenacity");
    expect(pairingTypes(p)).toBe(`${typeById("wonder" as WorkingGeniusId).label} and ${typeById("tenacity" as WorkingGeniusId).label}`);
  });
});

describe("the report's constraints", () => {
  test("it ends when the results end", () => {
    /*
     * No upsell of any kind: no book, no podcast, no certification, no "free
     * resources", no "want to go deeper". This is the constraint most likely to
     * be softened later by someone adding one helpful link.
     */
    /*
     * Word boundaries, not substrings. The first version of this test banned
     * the string "buy" and failed on "That buys a reliability check", which is
     * the check flagging its own explanation rather than a violation.
     */
    const body = report.toLowerCase();
    for (const phrase of [
      "learn more", "read more", "find out more", "want to go deeper",
      "buy", "purchase", "certification", "certified", "podcast",
      "free resources", "sign up", "newsletter", "webinar", "coaching package",
    ]) {
      const hit = new RegExp(`\\b${phrase.replace(/ /g, "\\s+")}\\b`).test(body);
      expect([phrase, hit]).toEqual([phrase, false]);
    }
  });

  test("no third-party product, company or copyright line", () => {
    const body = report.toLowerCase();
    for (const name of ["table group", "tablegroup", "working genius®", "©", "copyright", "all rights reserved"]) {
      expect([name, body.includes(name)]).toEqual([name, false]);
    }
    /* No outbound anything. Matched as a real domain or URL rather than as the
       string ".com", which also appears inside "competency" and
       ".completedAt" and failed this test for no reason. */
    expect(body).not.toMatch(/https?:\/\//);
    expect(body).not.toMatch(/\b[a-z0-9-]{2,}\.(com|org|net|io|co)\b/);
  });

  test("no religious framing", () => {
    const body = report.toLowerCase();
    for (const word of ["god-given", "god given", "divine", "blessed"]) {
      expect([word, body.includes(word)]).toEqual([word, false]);
    }
  });

  test("it prints as a light document", () => {
    /*
     * The app is dark-themed. Printing dark-on-dark gives an unreadable page or
     * an emptied cartridge, so the report is designed light rather than
     * inverted at print time.
     */
    expect(report).toContain("@page");
    expect(report).toContain("background: #fff");
    expect(report).toContain("--ink: #14161a");
  });

  test("a heading is never orphaned from its body", () => {
    expect(report).toContain("break-after: avoid-page");
    expect(report).toContain("break-inside: avoid");
  });

  test("the toolbar does not print", () => {
    expect(report).toMatch(/@media print \{ \.toolbar \{ display: none; \} \}/);
  });

  test("nothing is generated server-side or stored", () => {
    // The reason this is a print route: a stored PDF would be a second copy of
    // a private result outside every guarantee the privacy suite makes.
    expect(report).toContain("window.print()");
    expect(report).not.toContain("puppeteer");
    expect(report).not.toContain("playwright");
  });

  test("the founder is named, never addressed by email", () => {
    expect(report).toContain("session.name?.trim()");
    expect(report).not.toContain("session.email}");
  });

  test("the footer carries the date and the instrument version", () => {
    expect(report).toContain("result.completedAt");
    expect(report).toContain("result.version");
  });

  test("the internal attribution stays, and stays out of the PDF's claims", () => {
    /*
     * Deliberate, and separate from the no-upsell rule above. "Used internally
     * with approval" and "used unattributed" are different choices, and the
     * workflow doc treats crediting the model as a locked decision. The line
     * names the model and states plainly that this is not the official
     * instrument.
     */
    expect(report).toContain("The 6 Types of Working Genius");
    expect(report).toContain("not the official");
  });
});
