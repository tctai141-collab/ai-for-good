import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createOrganizer, get, post, startServer, type Harness, type Session } from "./helpers/harness";

/**
 * The deadline date picker.
 *
 * It replaced `<input type="date" required>`, and that swap gave up two things
 * the browser used to provide for free. Both are guarded here, because both
 * fail silently:
 *
 *   Constraint validation. A hidden input is barred from it, so `required` on
 *   the hidden field that carries the value does nothing at all. Without the
 *   explicit check in the submit handler, an empty date reaches the server.
 *
 *   Correct-by-construction date maths. The picker builds its own ISO string,
 *   so it can produce the wrong day. Anything routed through Date#toISOString
 *   returns the previous day for every timezone west of UTC, which would land
 *   deadlines, and their reminder emails, a day early.
 *
 * The picker is vanilla JS inside the admin page's one inline script, so these
 * read the served HTML. That is the same approach the knowledge-ingest suite
 * takes, and for the same reason: no typecheck looks inside that block.
 */

let h: Harness;
let organizer: Session;
let inline: string;
let html: string;
/** Just the picker's own code, comments stripped. */
let picker: string;

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
  html = await (await get(h, "/admin", organizer.cookie)).text();
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  inline = scripts.find((block) => block.includes("initDatePicker"))!;

  /*
   * The picker is one region of a 600-line block, so the assertions below are
   * scoped to it. Comments come out too: the code carries a warning naming the
   * very call the test forbids, and a check that cannot tell a prohibition
   * from its violation is not a check.
   */
  picker = inline
    .slice(inline.indexOf("const DP_MONTHS"), inline.indexOf('document.getElementById("add-deadline")'))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
});

afterAll(() => h?.stop());

describe("the markup", () => {
  test("the submit handler's input keeps its id, so the form logic is untouched", () => {
    // The visible control changed; `document.getElementById("dl-due").value`
    // did not. That is the whole reason this swap is cheap.
    expect(html).toContain('<input id="dl-due" type="hidden"');
    expect(inline).toContain('dueDate: due.value');
  });

  test("the trigger is a button outside any label", () => {
    // A <label> wrapping a <button> swallows the click in some browsers, which
    // is why the field is a .field div rather than the <label> its siblings use.
    expect(html).toContain('class="field"');
    expect(html).toMatch(/<button[^>]*class="dp-trigger"/);
    expect(html).not.toMatch(/<label>[\s\S]{0,200}dp-trigger/);
  });

  test("the trigger says what it is and what state it is in", () => {
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-labelledby="dl-due-label dl-due-value"');
  });
});

describe("the script", () => {
  test("it parses", () => {
    // One syntax error in this block takes out people, deadlines, programme,
    // knowledge and now the date picker at once, silently.
    expect(inline).toBeTruthy();
    expect(() => new Function(inline)).not.toThrow();
  });

  test("no date in the picker is routed through toISOString", () => {
    /*
     * The bug this prevents: `new Date(2026, 8, 15).toISOString()` is
     * "2026-09-14T21:00:00.000Z" in Helsinki. Slice ten characters off that
     * and the deadline is the 14th. Every date in the picker is assembled from
     * local year/month/day components instead.
     *
     * Scoped to the picker on purpose. Elsewhere on this page toISOString is
     * the right call: the shared-thread `seenAt` stamp is an instant, not a
     * calendar date, and UTC is exactly what it should be stored in.
     */
    expect(picker).not.toContain("toISOString");
    expect(picker).toContain("function dpIso");
  });

  test("the ISO builder pads, so single-digit months and days stay valid", () => {
    // The server takes YYYY-MM-DD and nothing else: "2026-9-5" is rejected.
    // Just that one function: the rest of the picker touches `document`, which
    // does not exist here.
    const source = picker.match(/function dpIso\([\s\S]*?\n {6}}/)![0];
    const dpIso = new Function(`${source}; return dpIso;`)() as (y: number, m: number, d: number) => string;
    expect(dpIso(2026, 8, 15)).toBe("2026-09-15");
    expect(dpIso(2026, 0, 1)).toBe("2026-01-01");
    expect(dpIso(2026, 11, 31)).toBe("2026-12-31");
  });

  test("the guard for an empty date is present, because `required` cannot be", () => {
    expect(inline).toContain('if (!due.value) return say(message, "Pick a due date.", true);');
  });

  test("the week starts on Monday", () => {
    // Finland, and the sprint's own week starts Tuesday. A Sunday-first grid
    // would put every session day in the wrong column.
    expect(picker).toContain('const DP_WEEKDAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]');
    expect(picker).toContain("getDay() + 6) % 7");
  });

  test("escape and outside-click listeners are removed on close", () => {
    // Both are registered on `document` in the capture phase. Leaving them
    // attached means every later Escape anywhere on the page runs dead code.
    expect(picker).toContain('document.removeEventListener("mousedown", onOutside, true)');
    expect(picker).toContain('document.removeEventListener("keydown", onKeydown, true)');
  });
});

describe("what the server accepts", () => {
  test("the format the picker emits is the format the API requires", async () => {
    const res = await post(h, "/api/deadlines", {
      action: "create",
      title: "Lifeline pitch",
      dueDate: "2026-09-15",
      dueTime: "14:30",
    }, organizer.cookie);
    expect(res.status).toBe(200);

    const listed = await (await get(h, "/api/deadlines", organizer.cookie)).json();
    const rows = listed.deadlines ?? listed.items ?? [];
    expect(rows.some((d: { dueDate: string }) => d.dueDate === "2026-09-15")).toBe(true);
  });

  test("an unpadded date is rejected, which is what the padding protects against", async () => {
    const res = await post(h, "/api/deadlines", {
      action: "create", title: "Bad", dueDate: "2026-9-5",
    }, organizer.cookie);
    expect(res.status).toBe(400);
  });
});
