import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * The admin page builds most of its lists by concatenating HTML strings and
 * assigning innerHTML, which is fine exactly as long as every interpolated
 * value goes through esc(). One did not.
 *
 * The programme list interpolated `w.phase` and `w.title` raw. Both are
 * organizer-written free text, so one organizer could store script that ran in
 * another organizer's session — on the page that holds every destructive
 * control in the product. Verified in a browser before and after: a phase of
 * `<img src=x onerror=...>` created an element and fired; it now renders as
 * literal text.
 *
 * This guards the general rule rather than that one line, because the next
 * list added to this file is the one that will forget.
 */

const admin = readFileSync("src/pages/admin.astro", "utf-8");

/** The inline script, comments stripped. */
const script = admin
  .slice(admin.indexOf("<script is:inline>"))
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("values interpolated into innerHTML", () => {
  test("the programme heading is escaped", () => {
    expect(script).toContain('const heading = esc(');
  });

  test("no innerHTML assignment interpolates a bare record field", () => {
    /*
     * Catches the shape that went wrong: `+ w.something +` or `+ e.something +`
     * inside a string being built for innerHTML, with no esc() around it.
     * Numeric fields are the legitimate exception — a count or a position
     * cannot carry markup — so they are named rather than pattern-matched,
     * which keeps the check honest when a new string field appears.
     */
    const NUMERIC = new Set(["position", "week", "id", "length"]);
    const offenders: string[] = [];

    for (const block of script.matchAll(/innerHTML\s*=\s*([\s\S]*?);\n/g)) {
      for (const ref of block[1]!.matchAll(/\+\s*([a-z]\w*)\.(\w+)\s*\+/gi)) {
        const field = ref[2]!;
        if (NUMERIC.has(field)) continue;
        offenders.push(`${ref[1]}.${field}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("esc() escapes what an injection needs", () => {
    // The helper itself, since everything above depends on it.
    const body = script.slice(script.indexOf("function esc("), script.indexOf("function esc(") + 400);
    // Each character it must neutralise, by the entity it produces.
    for (const entity of ["&amp;", "&lt;", "&gt;", "&quot;", "&#39;"]) {
      expect(body).toContain(entity);
    }
  });
});
