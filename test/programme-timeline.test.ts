import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  fromIsoDay, isoDay, longDate, sprintWeekOf, timeLabel, KINDS,
  type ProgrammeEvent,
} from "../src/components/ProgrammeTimeline";
/* From lib, not from the API route: importing the route would pull in
   db/index and resolve DB_PATH before the harness sets it, which silently
   points every later test file in this process at the wrong database. */
import { validDate, validTime } from "../src/lib/programme-dates";
import {
  createFounder, createMentor, createOrganizer, get, post, startServer,
  type Harness, type Session,
} from "./helpers/harness";

/**
 * The programme, as a timeline and a calendar.
 *
 * Two things are worth guarding here beyond the obvious CRUD: that a date is a
 * local calendar day rather than an instant, and that the sprint week shown
 * beside an event is the week's real span rather than something inferred from
 * the events in it.
 */

const source = readFileSync("src/components/ProgrammeTimeline.tsx", "utf-8");

const event = (over: Partial<ProgrammeEvent> = {}): ProgrammeEvent => ({
  id: "e1", title: "Kiilto brief", kind: "milestone",
  startsOn: "2026-09-10", startTime: "10:00", endTime: "12:00",
  location: "Startup Sauna", description: "", ...over,
});

describe("dates are calendar days, not instants", () => {
  test("isoDay is local, so it never rolls back a day", () => {
    /*
     * toISOString() would return the previous day for anybody east of UTC
     * before their local midday offset — Helsinki at 00:30 is 21:30 UTC the
     * day before. A programme date must be the date on the wall.
     */
    const midnight = new Date(2026, 8, 8, 0, 30);
    expect(isoDay(midnight)).toBe("2026-09-08");
    const lateEvening = new Date(2026, 8, 8, 23, 45);
    expect(isoDay(lateEvening)).toBe("2026-09-08");
  });

  test("fromIsoDay round-trips", () => {
    expect(isoDay(fromIsoDay("2026-09-08"))).toBe("2026-09-08");
    expect(fromIsoDay("2026-09-08").getDay()).toBe(2); // a Tuesday
  });

  test("no UTC conversion anywhere in the component", () => {
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(stripped).not.toContain("toISOString");
    expect(stripped).not.toContain("getTimezoneOffset");
  });
});

describe("sprint weeks", () => {
  const START = "2026-09-08";

  test("the start date is week 1, not week 0", () => {
    expect(sprintWeekOf("2026-09-08", START, 15)).toBe(1);
    expect(sprintWeekOf("2026-09-14", START, 15)).toBe(1);
    expect(sprintWeekOf("2026-09-15", START, 15)).toBe(2);
  });

  test("outside the programme is null, not clamped", () => {
    expect(sprintWeekOf("2026-09-07", START, 15)).toBeNull();
    expect(sprintWeekOf("2027-01-01", START, 15)).toBeNull();
  });

  test("no start date means no weeks rather than everything in week 1", () => {
    expect(sprintWeekOf("2026-09-08", null, 15)).toBeNull();
  });

  test("a clock change does not move a week boundary", () => {
    /*
     * Regression. The subtraction used local midnights, which are 23 or 25
     * hours apart across a DST change; one hour short of a whole number of
     * weeks floors to the week before. A cohort spanning the March change had
     * every session after it filed one week early, all the way to the end.
     *
     * Autumn hid it — an extra hour never crosses a boundary — so the F26
     * dates looked right and a spring cohort would not have.
     */
    const SPRING = "2026-02-02"; // clocks go forward on 29 March
    expect(sprintWeekOf("2026-03-29", SPRING, 15)).toBe(8);
    expect(sprintWeekOf("2026-03-30", SPRING, 15)).toBe(9);
    expect(sprintWeekOf("2026-04-06", SPRING, 15)).toBe(10);

    // And every boundary lands on the right day, either side of the change.
    for (let week = 1; week <= 15; week++) {
      const first = new Date(Date.UTC(2026, 1, 2) + (week - 1) * 7 * 86400000)
        .toISOString().slice(0, 10);
      expect(sprintWeekOf(first, SPRING, 15)).toBe(week);
    }
  });

  test("the heading takes the week's own span, not the events' span", () => {
    /*
     * Regression. The week heading used to be built from the first and last
     * event in the group, so a week 2 holding one Friday session was labelled
     * "Week 2 · 18 Sep – 19 Sep" — a statement that week 2 is two days long.
     */
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const block = stripped.slice(stripped.indexOf("if (startDate) {"), stripped.indexOf("return [...byKey.values()]"));
    expect(block).toContain("(week - 1) * 7");
    expect(block).not.toContain("group.events[0]");
  });
});

describe("how an event reads", () => {
  test("a time range, a single time, or all day", () => {
    expect(timeLabel(event())).toBe("10:00–12:00");
    expect(timeLabel(event({ endTime: "" }))).toBe("10:00");
    expect(timeLabel(event({ startTime: "", endTime: "" }))).toBe("All day");
  });

  test("the year appears only when it is not the current one", () => {
    expect(longDate("2026-09-08", 2026)).toBe("Tuesday 8 September");
    expect(longDate("2027-01-05", 2026)).toBe("Tuesday 5 January 2027");
  });

  test("kinds are told apart by mark and word, not by colour alone", () => {
    const labels = Object.values(KINDS).map((k) => k.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const kind of Object.values(KINDS)) expect(kind.glyph.length).toBeGreaterThan(0);
  });
});

describe("validation", () => {
  test("a date must be a real day", () => {
    expect(validDate("2026-09-08")).toBe(true);
    expect(validDate("2026-02-31")).toBe(false); // parses as 3 March if you let it
    expect(validDate("2026-9-8")).toBe(false);
    expect(validDate("")).toBe(false);
    expect(validDate(20260908)).toBe(false);
  });

  test("a time is 24-hour, or empty for all day", () => {
    expect(validTime("09:30")).toBe(true);
    expect(validTime("23:59")).toBe(true);
    expect(validTime("")).toBe(true);
    expect(validTime("24:00")).toBe(false);
    expect(validTime("9:30")).toBe(false);
  });
});

describe("the API", () => {
  let h: Harness;
  let organizer: Session;
  let mentor: Session;
  let founder: Session;

  beforeAll(async () => {
    h = await startServer();
    organizer = await createOrganizer(h, "org@example.test");
    mentor = await createMentor(h, "mentor@example.test", "Mentor");
    founder = await createFounder(h, organizer, "founder@example.test", "F", "founder-password-1");
  });
  afterAll(() => h?.stop());

  const save = (body: Record<string, unknown>, cookie: string) =>
    post(h, "/api/programme-events", body, cookie);

  test("everybody signed in can read it; nobody signed out can", async () => {
    for (const who of [organizer, mentor, founder]) {
      expect((await get(h, "/api/programme-events", who.cookie)).status).toBe(200);
    }
    expect((await get(h, "/api/programme-events", "")).status).toBe(401);
  });

  test("only organizers write", async () => {
    const body = { title: "Session", startsOn: "2026-09-08" };
    expect((await save(body, founder.cookie)).status).toBe(403);
    expect((await save(body, mentor.cookie)).status).toBe(403);
    expect((await save(body, organizer.cookie)).status).toBe(200);
  });

  test("what an organizer saves is what the cohort reads", async () => {
    const res = await save({
      title: "Kiilto brief", kind: "milestone", startsOn: "2026-09-10",
      startTime: "10:00", endTime: "12:00", location: "Startup Sauna",
    }, organizer.cookie);
    expect(res.status).toBe(200);

    const read = await get(h, "/api/programme-events", founder.cookie);
    const data = (await read.json()) as { events: ProgrammeEvent[] };
    const found = data.events.find((e) => e.title === "Kiilto brief");
    expect(found).toBeDefined();
    expect(found?.startTime).toBe("10:00");
    expect(found?.kind).toBe("milestone");
  });

  test("an end before its start is refused, not swapped", async () => {
    /* Swapping would put a session on twenty people's calendars that nobody
       scheduled. "14:00 to 09:00" is a typo and should say so. */
    const res = await save(
      { title: "Backwards", startsOn: "2026-09-11", startTime: "14:00", endTime: "09:00" },
      organizer.cookie,
    );
    expect(res.status).toBe(400);
  });

  test("an end time with no start has nothing to end", async () => {
    const res = await save(
      { title: "Dangling", startsOn: "2026-09-11", startTime: "", endTime: "12:00" },
      organizer.cookie,
    );
    expect(res.status).toBe(400);
  });

  test("a title and a real date are both required", async () => {
    expect((await save({ title: "  ", startsOn: "2026-09-11" }, organizer.cookie)).status).toBe(400);
    expect((await save({ title: "X", startsOn: "2026-02-31" }, organizer.cookie)).status).toBe(400);
  });

  test("an unknown kind falls back rather than reaching the database", async () => {
    // The column has a CHECK on it, so an unchecked value would be a 500.
    const res = await save(
      { title: "Odd", kind: "party", startsOn: "2026-09-12" },
      organizer.cookie,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { event: ProgrammeEvent }).event.kind).toBe("session");
  });

  test("removing takes it out of the cohort's list, and twice is a 404", async () => {
    const created = await save({ title: "Cancelled", startsOn: "2026-09-13" }, organizer.cookie);
    const { event: made } = (await created.json()) as { event: ProgrammeEvent };

    expect((await save({ action: "delete", id: made.id }, organizer.cookie)).status).toBe(200);

    const read = await get(h, "/api/programme-events", founder.cookie);
    const data = (await read.json()) as { events: ProgrammeEvent[] };
    expect(data.events.some((e) => e.id === made.id)).toBe(false);

    expect((await save({ action: "delete", id: made.id }, organizer.cookie)).status).toBe(404);
  });

  test("a founder cannot delete somebody else's programme", async () => {
    const created = await save({ title: "Keep", startsOn: "2026-09-14" }, organizer.cookie);
    const { event: made } = (await created.json()) as { event: ProgrammeEvent };
    expect((await save({ action: "delete", id: made.id }, founder.cookie)).status).toBe(403);

    const read = await get(h, "/api/programme-events", founder.cookie);
    const data = (await read.json()) as { events: ProgrammeEvent[] };
    expect(data.events.some((e) => e.id === made.id)).toBe(true);
  });

  test("the programme read carries the start date so weeks can be worked out", async () => {
    const res = await get(h, "/api/programme", founder.cookie);
    const data = (await res.json()) as Record<string, unknown>;
    expect("startDate" in data).toBe(true);
  });
});

describe("the sidebar and the page agree", () => {
  test("there is one schedule, and it is this page", () => {
    /*
     * The sidebar used to carry a "What's on" rail summarising the next few
     * sessions. Two views of one schedule is two things to keep in step — it
     * had already drifted once, saying "Nothing scheduled yet" beside a page
     * listing seven things — and Tai found the summary messy besides. The
     * Programme entry in the sidebar is one click from the whole thing.
     */
    const app = readFileSync("src/components/SprintBuddy.tsx", "utf-8");
    expect(app).not.toContain("ProgrammeRail");
    expect(app).not.toContain("What&rsquo;s on");
    expect(app).toContain("<ProgrammeTimeline />");
  });

  test("both personas can reach the programme", () => {
    const app = readFileSync("src/components/SprintBuddy.tsx", "utf-8");
    // Once in the founder footer, once beside the coach's cohort heatmap.
    expect(app.split("onClick={onProgramme}").length - 1).toBe(2);
  });

  test("the view is read-only — editing lives on /admin", () => {
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(stripped).not.toContain('method: "POST"');
  });
});
