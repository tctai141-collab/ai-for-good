import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFounder, createOrganizer, get, post, startServer,
  type Harness, type Session,
} from "./helpers/harness";

/**
 * Editing a deadline, which the API always allowed and the page never offered.
 *
 * Archive and Delete were the only two things you could do to a deadline once
 * it existed, so a typo in a title or a date set a day out meant deleting it
 * and typing the whole thing again — and Delete takes every founder's
 * completion with it. The update action has supported title, description,
 * date, time, sprint week and status the whole time.
 *
 * The interesting part is not the button. update treats an absent key as
 * "leave this alone", so a form that cannot see a field has no safe way to
 * send it: omit it and clearing becomes impossible, send it empty and editing
 * a title silently wipes something else. The staff list did not return
 * description or dueTime, so the first version of this feature would have
 * erased both the moment anybody fixed a title. That is what these tests are
 * mostly about.
 */

let h: Harness;
let organizer: Session;
let founder: Session;

type StatusRow = {
  id: string; title: string; description: string | null;
  dueDate: string; dueTime: string | null; sprintWeek: number | null;
  status: string; doneCount: number;
};

const statusList = async () =>
  ((await (await get(h, "/api/deadlines?view=status", organizer.cookie)).json()) as { deadlines: StatusRow[] }).deadlines;

async function makeDeadline(fields: Record<string, unknown>) {
  const res = await post(h, "/api/deadlines", { action: "create", ...fields }, organizer.cookie);
  expect(res.ok).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "olivia@example.test", "Olivia Organizer");
  founder = await createFounder(h, organizer, "frida@example.test", "Frida Founder", "frida-password-11");
});

afterAll(() => h?.stop());

describe("the list an organizer edits from carries everything the form needs", () => {
  test("description and time come back, not just title and date", async () => {
    /*
     * The whole feature rests on this. Without these two the editor opens with
     * them blank, and saving writes the blanks back.
     */
    await makeDeadline({
      title: "Lifeline pitch", description: "Five minutes, no slides",
      dueDate: "2026-09-11", dueTime: "15:00", sprintWeek: 1,
    });
    const [row] = await statusList();
    expect(row!.description).toBe("Five minutes, no slides");
    expect(row!.dueTime).toBe("15:00");
  });

  test("it stays staff-only", async () => {
    // Adding fields to a view is the moment to check who can read it.
    expect((await get(h, "/api/deadlines?view=status", founder.cookie)).status).toBe(403);
    expect((await get(h, "/api/deadlines?view=status")).status).toBe(401);
  });

  test("nothing a founder wrote was added to it", async () => {
    /*
     * Both new fields are organizer copy about the deadline, and the founder's
     * own list already returned them — so this widens nothing. The completion
     * matrix still carries names and counts and no founder text.
     */
    const [row] = await statusList();
    expect(Object.keys(row!).sort()).toEqual(
      ["behind", "description", "doneCount", "dueDate", "dueTime", "id", "sprintWeek", "status", "title"],
    );
  });
});

describe("editing one", () => {
  test("a field left alone survives the edit", async () => {
    /*
     * The reported shape of this bug elsewhere: fix the title, lose the
     * description. Sending every field is only safe because the form can see
     * every field.
     */
    const id = await makeDeadline({
      title: "Typo in this titel", description: "keep me",
      dueDate: "2026-09-25", dueTime: "16:30", sprintWeek: 3,
    });
    const res = await post(h, "/api/deadlines", {
      action: "update", id,
      title: "Typo in this title", description: "keep me",
      dueDate: "2026-09-25", dueTime: "16:30", sprintWeek: 3,
    }, organizer.cookie);
    expect(res.ok).toBe(true);

    const row = (await statusList()).find((d) => d.id === id)!;
    expect(row.title).toBe("Typo in this title");
    expect(row.description).toBe("keep me");
    expect(row.dueTime).toBe("16:30");
    expect(row.sprintWeek).toBe(3);
  });

  test("a field can also be cleared", async () => {
    // The other half: "" has to mean empty, not "no opinion".
    const id = await makeDeadline({
      title: "Clear me", description: "goes away", dueDate: "2026-10-02", dueTime: "09:00",
    });
    await post(h, "/api/deadlines", {
      action: "update", id, title: "Clear me", description: "", dueDate: "2026-10-02", dueTime: null,
    }, organizer.cookie);

    const row = (await statusList()).find((d) => d.id === id)!;
    expect(row.description).toBeNull();
    expect(row.dueTime).toBeNull();
  });

  test("completions are not disturbed by an edit", async () => {
    /*
     * The reason Delete-and-retype was the wrong workaround: it takes every
     * founder's tick with it. Editing must not.
     */
    const id = await makeDeadline({ title: "Ticked", dueDate: "2026-09-30" });
    await post(h, "/api/deadlines", { action: "toggle", id, done: true }, founder.cookie);
    expect((await statusList()).find((d) => d.id === id)!.doneCount).toBe(1);

    await post(h, "/api/deadlines", {
      action: "update", id, title: "Ticked, renamed", dueDate: "2026-09-30",
    }, organizer.cookie);
    expect((await statusList()).find((d) => d.id === id)!.doneCount).toBe(1);
  });

  test("a founder cannot edit one", async () => {
    const id = await makeDeadline({ title: "Theirs to read", dueDate: "2026-10-09" });
    const res = await post(h, "/api/deadlines", { action: "update", id, title: "Mine now" }, founder.cookie);
    expect(res.status).toBe(403);
    expect((await statusList()).find((d) => d.id === id)!.title).toBe("Theirs to read");
  });
});

describe("the page offers it", () => {
  const script = readFileSync("src/pages/admin.astro", "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const source = readFileSync("src/pages/admin.astro", "utf-8");

  test("every row has an Edit, alongside Archive and Delete", () => {
    expect(script).toContain("data-edit-deadline");
    expect(script).toContain('edit.textContent = editingDeadlineId === d.id ? "Editing" : "Edit"');
  });

  test("the form has somewhere to go and a way back", () => {
    expect(source).toContain('id="dl-form-home"');
    expect(source).toContain('id="dl-cancel"');
    expect(source).toContain('id="dl-id"');
  });

  test("the form is homed before the list is emptied", () => {
    /*
     * `deadlineList.textContent = ""` drops the subtree, and the live form is
     * inside it while a row is open. Same hazard as the other two lists, and
     * the same silent cost: whatever was typed.
     */
    const render = script.slice(script.indexOf("function renderDeadlines()"));
    const homed = render.indexOf("homeDeadlineForm()");
    const cleared = render.indexOf("deadlineList.textContent");
    expect(homed).toBeGreaterThanOrEqual(0);
    expect(homed).toBeLessThan(cleared);
  });

  test("the redraw is synchronous, so the row can be held still", () => {
    /*
     * renderKeepingStill measures the DOM either side of the render. Handing
     * it the async loader would measure before the new rows existed, so the
     * list keeps its last payload and redraws from that.
     */
    expect(script).toContain("let deadlineData = null");
    expect(script).toContain("renderKeepingStill('[data-edit-deadline=\"'");
  });

  test("submitting sends update when a row opened the form, create otherwise", () => {
    const submit = script.slice(script.indexOf('getElementById("add-deadline").addEventListener'));
    expect(submit).toContain("const editing = !!dlId.value");
    expect(submit).toContain('action: editing ? "update" : "create"');
  });

  test("deleting the row being edited brings the form home first", () => {
    // Otherwise the redraw removes the slot the form is standing in.
    expect(script).toContain("if (editingDeadlineId === d.id) resetDeadlineForm()");
  });
});
