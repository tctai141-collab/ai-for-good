import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * Source files must be text, byte for byte.
 *
 * Two files carried a literal NUL: the broadcast route, where it separates
 * subject from body in a content hash, and the backup test, where it stands in
 * for a real SQLite header. Both are legitimate values written the wrong way.
 * Written raw rather than as \u0000, the byte makes the whole file "binary" to
 * every tool that decides by sniffing — grep skips it silently in a recursive
 * search, and a code review reads "no matches" as "not there". The broadcast
 * route was invisible that way: four functions it alone uses looked dead.
 *
 * The escape compiles to the same character, so nothing about the hash or the
 * test payload changes. This keeps it that way.
 */
const FILES = [...new Bun.Glob("{src,test,scripts}/**/*.{ts,tsx,astro,css,json,md}").scanSync(".")];

describe("every source file", () => {
  test("is searchable text, with no raw control bytes in it", () => {
    expect(FILES.length).toBeGreaterThan(50);
    const offenders = FILES.filter((path) => readFileSync(path).includes(0x00));
    expect(offenders).toEqual([]);
  });

  test("the broadcast hash still separates subject from body", () => {
    /* The separator is what stops "ab" + "c" hashing the same as "a" + "bc",
       which would let an edit slip past the test-send gate. */
    const source = readFileSync("src/pages/api/admin/broadcast.ts", "utf-8");
    expect(source).toContain('.update("\\u0000")');
  });
});
