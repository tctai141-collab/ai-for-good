import { useEffect, useMemo, useRef, useState } from "react";

/**
 * The programme, as a timeline and as a calendar.
 *
 * Rebuilt from two supplied components. What survived and what did not:
 *
 *   The daily scheduler was the wrong shape entirely. It lays out one day in
 *   hourly rows from 6am to 8pm — fifteen empty slots per day, times ninety
 *   days, to show the four things that are actually on. A fifteen-week
 *   programme is sparse; an hour grid renders mostly nothing. The month grid
 *   and the list, from the second component, are the two views that fit, and
 *   they are the two built here.
 *
 *   Drag-to-reschedule is gone. In the original it moves an event to whatever
 *   cell it is dropped on, silently. A programme date is a thing twenty people
 *   have already put in their calendars; moving one is a decision made in a
 *   form with a save button, not a gesture that can happen by accident on a
 *   trackpad.
 *
 *   The colour/tag/category filter row is gone. Three dropdowns and a search
 *   box is the right furniture for a calendar with a thousand events in it.
 *   This one holds perhaps forty, all of them the cohort's, and every filter
 *   control would be a control that removes things from a schedule somebody
 *   opened in order to see all of.
 *
 * Kept: the month grid, the view switcher, Today, the detail panel, and the
 * shape of the list view grouped by date.
 *
 * Nothing here writes. Editing lives on /admin, and this is read-only for
 * everybody including the organizer who typed it in — the same view the cohort
 * sees, which is the point of being able to look at it.
 */

export type ProgrammeEvent = {
  id: string;
  title: string;
  kind: "session" | "milestone" | "checkpoint" | "social" | "trip";
  startsOn: string;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
};

/*
 * Identity by glyph and word, with colour doing only one job.
 *
 * Five hues would be five hues to learn, would fight a theme that deliberately
 * carries no status colours, and would leave anybody who cannot separate them
 * with no way to tell a milestone from a coffee. So the kinds are distinguished
 * by a mark and a label, which everybody can read, and the accent is spent on
 * the one distinction that changes what you do about it: the things you have to
 * turn up to and be ready for.
 */
export const KINDS: Record<ProgrammeEvent["kind"], { label: string; glyph: string; major: boolean }> = {
  session: { label: "Session", glyph: "●", major: false },
  milestone: { label: "Milestone", glyph: "◆", major: true },
  checkpoint: { label: "Checkpoint", glyph: "◇", major: true },
  social: { label: "Social", glyph: "○", major: false },
  trip: { label: "Trip", glyph: "▶", major: true },
};

/** Local YYYY-MM-DD. Never toISOString, which is UTC and rolls the day over. */
export function isoDay(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** A YYYY-MM-DD read as a local calendar day, not an instant. */
export function fromIsoDay(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/**
 * Which sprint week a date falls in, or null outside the programme.
 *
 * Mirrors the server's weekForDate rather than calling it: this runs in the
 * browser on a date the browser already has, and a round trip per event to
 * learn arithmetic would be absurd.
 */
export function sprintWeekOf(day: string, startDate: string | null, totalWeeks: number): number | null {
  if (!startDate) return null;
  const week = Math.floor((utcMidnight(day) - utcMidnight(startDate)) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return week < 1 || week > totalWeeks ? null : week;
}

/**
 * A date as a UTC instant, for arithmetic only.
 *
 * The subtraction has to be DST-free. Local midnights are 23 or 25 hours apart
 * across a clock change, and one hour short of a whole number of weeks floors
 * to the week before: a spring cohort spanning the March change put every
 * session after it one week early, all the way to the end of the programme.
 * Autumn hides the bug — an extra hour never crosses a boundary — so the F26
 * dates would have looked right and a spring cohort would not have.
 *
 * Display still uses fromIsoDay: a weekday name wants the local calendar day.
 */
function utcMidnight(value: string): number {
  const [y, m, d] = value.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Tuesday 8 September". The year only when it is not the one we are in. */
export function longDate(day: string, thisYear: number): string {
  const date = fromIsoDay(day);
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][date.getDay()];
  const base = `${weekday} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === thisYear ? base : `${base} ${date.getFullYear()}`;
}

/** "13:00–15:00", "13:00", or "All day". */
export function timeLabel(event: ProgrammeEvent): string {
  if (!event.startTime) return "All day";
  return event.endTime ? `${event.startTime}–${event.endTime}` : event.startTime;
}

export default function ProgrammeTimeline({ today = isoDay(new Date()) }: { today?: string }) {
  const [events, setEvents] = useState<ProgrammeEvent[] | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [totalWeeks, setTotalWeeks] = useState(15);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<"timeline" | "calendar">("timeline");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      fetch("/api/programme-events").then((r) => (r.ok ? r.json() : Promise.reject(new Error("events")))),
      fetch("/api/programme").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([eventData, weekData]) => {
        if (!live) return;
        setEvents((eventData.events as ProgrammeEvent[]) ?? []);
        if (weekData) {
          setStartDate((weekData.startDate as string | null) ?? null);
          setTotalWeeks((weekData.totalWeeks as number) ?? 15);
        }
      })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  if (failed) {
    return (
      <div className="pt-wrap">
        <style>{PROGRAMME_CSS}</style>
        <p className="pt-empty">The programme did not load. Refreshing usually sorts it.</p>
      </div>
    );
  }

  return (
    <div className="pt-wrap">
      <style>{PROGRAMME_CSS}</style>

      <header className="pt-head">
        <div>
          <h1 className="pt-title">Programme</h1>
          <p className="pt-sub">
            {events === null
              ? " "
              : events.length === 0
                ? "Nothing scheduled yet."
                : `${events.length} thing${events.length === 1 ? "" : "s"} in the sprint.`}
          </p>
        </div>

        {/* Two views of one list, so the switch is a switch and not navigation. */}
        <div className="pt-modes" role="tablist" aria-label="How to show the programme">
          {(["timeline", "calendar"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              className={`pt-mode${mode === value ? " is-on" : ""}`}
              onClick={() => setMode(value)}
            >
              {value === "timeline" ? "Timeline" : "Calendar"}
            </button>
          ))}
        </div>
      </header>

      {events === null ? (
        <p className="pt-empty">Loading…</p>
      ) : events.length === 0 ? (
        <p className="pt-empty">
          Nothing scheduled yet. Sessions, milestones and checkpoints appear here as the team plans the sprint.
        </p>
      ) : mode === "timeline" ? (
        <Timeline
          events={events} today={today} startDate={startDate} totalWeeks={totalWeeks}
          openId={openId} setOpenId={setOpenId}
        />
      ) : (
        <CalendarMonth
          events={events} today={today} startDate={startDate} totalWeeks={totalWeeks}
          openId={openId} setOpenId={setOpenId}
        />
      )}
    </div>
  );
}

type ViewProps = {
  events: ProgrammeEvent[];
  today: string;
  startDate: string | null;
  totalWeeks: number;
  openId: string | null;
  setOpenId: (id: string | null) => void;
};

function Timeline({ events, today, startDate, totalWeeks, openId, setOpenId }: ViewProps) {
  /*
   * Grouped by sprint week when there is a start date, by month when there is
   * not. A programme is lived in weeks — "week 4" is how everybody in the room
   * refers to it — but a cohort whose dates are not set yet has no week 4, and
   * filing everything under one heading would be a lie rather than a fallback.
   */
  const groups = useMemo(() => {
    const byKey = new Map<string, { label: string; sub: string; events: ProgrammeEvent[]; isNow: boolean }>();
    const nowWeek = sprintWeekOf(today, startDate, totalWeeks);

    for (const event of events) {
      const week = sprintWeekOf(event.startsOn, startDate, totalWeeks);
      const date = fromIsoDay(event.startsOn);
      const key = week !== null ? `w${week}` : `m${date.getFullYear()}-${date.getMonth()}`;
      let group = byKey.get(key);
      if (!group) {
        group = week !== null
          ? { label: `Week ${week}`, sub: "", events: [], isNow: week === nowWeek }
          : { label: `${MONTHS[date.getMonth()]} ${date.getFullYear()}`, sub: "", events: [], isNow: false };
        byKey.set(key, group);
      }
      group.events.push(event);
    }

    /*
     * The week heading carries the week's own dates, because "Week 7" alone
     * tells a founder nothing about whether it has happened yet.
     *
     * These are the week's real boundaries, not the span of the events in it.
     * Deriving them from the events read plausibly and was wrong: a week 2
     * holding one Friday session was labelled "Week 2 · 18 Sep – 19 Sep", which
     * states that week 2 is two days long.
     */
    if (startDate) {
      for (const [key, group] of byKey) {
        if (!key.startsWith("w")) continue;
        const week = Number(key.slice(1));
        const start = fromIsoDay(startDate);
        start.setDate(start.getDate() + (week - 1) * 7);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        group.sub = `${shortDate(isoDay(start))} – ${shortDate(isoDay(end))}`;
      }
    }

    return [...byKey.values()];
  }, [events, today, startDate, totalWeeks]);

  /* Scrolled to on mount, so opening the programme mid-sprint lands on what is
     next rather than on the induction session eight weeks ago. */
  const nextRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    nextRef.current?.scrollIntoView({ block: "center" });
  }, []);

  const firstUpcoming = events.find((event) => event.startsOn >= today)?.id ?? null;

  return (
    <div className="pt-timeline">
      {groups.map((group) => (
        <section key={group.label} className="pt-group">
          <div className={`pt-grouphead${group.isNow ? " is-now" : ""}`}>
            <h2>{group.label}</h2>
            {group.sub && <span>{group.sub}</span>}
            {group.isNow && <span className="pt-nowtag">This week</span>}
          </div>

          <div className="pt-rail">
            {group.events.map((event) => {
              const past = event.startsOn < today;
              const isToday = event.startsOn === today;
              const kind = KINDS[event.kind];
              return (
                <div
                  key={event.id}
                  ref={event.id === firstUpcoming ? nextRef : undefined}
                  className={`pt-item${past ? " is-past" : ""}${isToday ? " is-today" : ""}`}
                >
                  <span className={`pt-dot${kind.major ? " is-major" : ""}`} aria-hidden="true">{kind.glyph}</span>
                  <div className="pt-when">
                    <span className="pt-day">{longDate(event.startsOn, fromIsoDay(today).getFullYear())}</span>
                    <span className="pt-time">{timeLabel(event)}</span>
                  </div>
                  <EventBody event={event} open={openId === event.id} onToggle={() => setOpenId(openId === event.id ? null : event.id)} />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function EventBody({ event, open, onToggle }: { event: ProgrammeEvent; open: boolean; onToggle: () => void }) {
  const kind = KINDS[event.kind];
  const hasMore = Boolean(event.description);
  return (
    <div className="pt-body">
      <div className="pt-bodyhead">
        <h3 className="pt-eventtitle">{event.title}</h3>
        <span className={`pt-kind${kind.major ? " is-major" : ""}`}>{kind.label}</span>
      </div>
      {event.location && <p className="pt-loc">{event.location}</p>}
      {hasMore && (
        <>
          <button type="button" className="pt-more" aria-expanded={open} onClick={onToggle}>
            {open ? "Less" : "More"}
          </button>
          {open && <p className="pt-desc">{event.description}</p>}
        </>
      )}
    </div>
  );
}

function shortDate(day: string): string {
  const date = fromIsoDay(day);
  return `${date.getDate()} ${MONTHS[date.getMonth()]?.slice(0, 3)}`;
}

function CalendarMonth({ events, today, openId, setOpenId }: ViewProps) {
  /* Opens on the month the next event is in, not on the current month, so a
     cohort looking in August at a sprint starting in September sees the sprint
     rather than an empty grid. */
  const [cursor, setCursor] = useState(() => {
    const next = events.find((event) => event.startsOn >= today) ?? events[0];
    const date = fromIsoDay(next ? next.startsOn : today);
    return { year: date.getFullYear(), month: date.getMonth() };
  });

  const byDay = useMemo(() => {
    const map = new Map<string, ProgrammeEvent[]>();
    for (const event of events) {
      const list = map.get(event.startsOn);
      if (list) list.push(event);
      else map.set(event.startsOn, [event]);
    }
    return map;
  }, [events]);

  /* Weeks start on Monday. A European programme whose weeks run Mon–Sun would
     otherwise be drawn split across two rows. */
  const cells = useMemo(() => {
    const lead = (new Date(cursor.year, cursor.month, 1).getDay() + 6) % 7;
    const days = new Date(cursor.year, cursor.month + 1, 0).getDate();
    /* As many rows as the month needs. A fixed six rows keeps the grid a
       constant height, which is tidier, but most months then end with an
       entirely greyed-out week that reads as a rendering fault. */
    const rows = Math.ceil((lead + days) / 7);
    return Array.from({ length: rows * 7 }, (_, i) => new Date(cursor.year, cursor.month, 1 - lead + i));
  }, [cursor]);

  const move = (delta: number) => setCursor((prev) => {
    const date = new Date(prev.year, prev.month + delta, 1);
    return { year: date.getFullYear(), month: date.getMonth() };
  });

  const open = openId ? events.find((event) => event.id === openId) ?? null : null;

  return (
    <div className="pt-cal">
      <div className="pt-calhead">
        <button type="button" className="pt-nav" onClick={() => move(-1)} aria-label="Previous month">&#8249;</button>
        <h2>{MONTHS[cursor.month]} {cursor.year}</h2>
        <button type="button" className="pt-nav" onClick={() => move(1)} aria-label="Next month">&#8250;</button>
        <button
          type="button"
          className="pt-today"
          onClick={() => {
            const date = fromIsoDay(today);
            setCursor({ year: date.getFullYear(), month: date.getMonth() });
          }}
        >
          Today
        </button>
      </div>

      <div className="pt-grid" role="grid">
        {DAYS_SHORT.map((day) => (
          <div key={day} className="pt-dayname" role="columnheader"><span>{day}</span></div>
        ))}
        {cells.map((date) => {
          const day = isoDay(date);
          const outside = date.getMonth() !== cursor.month;
          const dayEvents = byDay.get(day) ?? [];
          return (
            <div key={day} className={`pt-cell${outside ? " is-outside" : ""}${day === today ? " is-today" : ""}`} role="gridcell">
              <span className="pt-cellnum">{date.getDate()}</span>
              {dayEvents.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className={`pt-chip${KINDS[event.kind].major ? " is-major" : ""}`}
                  onClick={() => setOpenId(openId === event.id ? null : event.id)}
                  aria-expanded={openId === event.id}
                  /* Carries the title for a screen reader, and for the phone
                     layout below where the chip is a bar with no text in it. */
                  aria-label={`${event.title}, ${longDate(event.startsOn, fromIsoDay(today).getFullYear())}`}
                >
                  {/* Stacked, not inline. Side by side, the time took half of a
                      95px cell and every title truncated to "Orient…". */}
                  {event.startTime && <span className="pt-chiptime">{event.startTime}</span>}
                  <span className="pt-chiptitle">{event.title}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* Detail below the grid rather than in a floating card: a hover card on
          a calendar is unreachable on a phone, which is where a founder checks
          what is on next. */}
      {open && (
        <div className="pt-detail">
          <div className="pt-bodyhead">
            <h3 className="pt-eventtitle">{open.title}</h3>
            <span className={`pt-kind${KINDS[open.kind].major ? " is-major" : ""}`}>{KINDS[open.kind].label}</span>
            <button type="button" className="pt-close" onClick={() => setOpenId(null)} aria-label="Close">&times;</button>
          </div>
          <p className="pt-detailwhen">
            {longDate(open.startsOn, fromIsoDay(today).getFullYear())} · {timeLabel(open)}
            {open.location ? ` · ${open.location}` : ""}
          </p>
          {open.description && <p className="pt-desc">{open.description}</p>}
        </div>
      )}
    </div>
  );
}

export const PROGRAMME_CSS = `
/* The page uses the window it is given. A fixed column left a third of a
   laptop screen empty beside a calendar that is better the wider it is; the
   things inside that should not run long keep their own measure in ch. */
.pt-wrap { max-width: min(1280px, 100%); margin: 0 auto; padding: 40px 32px 80px; }

.pt-head {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 20px; flex-wrap: wrap; margin-bottom: 28px;
}
.pt-title {
  margin: 0; font-size: 1.75rem; font-weight: 700;
  letter-spacing: -0.022em; color: var(--ink);
}
.pt-sub { margin: 4px 0 0; font-size: 0.875rem; color: var(--ink-sub, #8a8f98); min-height: 1.2em; }

.pt-modes {
  display: inline-flex; gap: 2px; padding: 3px;
  border: 1px solid var(--line); border-radius: 10px;
  background: rgba(255,255,255,0.02);
}
.pt-mode {
  padding: 6px 14px; border: 0; border-radius: 7px;
  background: transparent; color: var(--ink-sub, #8a8f98);
  font: 600 0.8125rem/1 inherit; cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}
.pt-mode:hover { color: var(--ink); }
.pt-mode.is-on { background: rgba(255,255,255,0.09); color: var(--ink); }
.pt-mode:focus-visible { outline: 2px solid var(--brand-accent); outline-offset: 1px; }

.pt-empty {
  margin: 0; padding: 28px 0; max-width: 46ch;
  font-size: 0.9375rem; line-height: 1.55; color: var(--ink-sub, #8a8f98);
}

/* ── Timeline ── */
.pt-group { margin-bottom: 34px; }
.pt-grouphead {
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  padding-bottom: 10px; margin-bottom: 4px;
  border-bottom: 1px solid var(--line);
}
.pt-grouphead h2 {
  margin: 0; font-size: 0.8125rem; font-weight: 700;
  letter-spacing: 0.07em; text-transform: uppercase; color: var(--ink);
}
.pt-grouphead span { font-size: 0.8125rem; color: var(--ink-sub, #8a8f98); }
.pt-nowtag {
  margin-left: auto; padding: 2px 8px; border-radius: 999px;
  background: var(--brand-accent); color: #fff;
  font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.04em;
}
.pt-grouphead.is-now { border-bottom-color: var(--brand-accent); }

/* The rail is one continuous line down the column of marks, so a week reads as
   a run of time rather than a stack of cards. */
.pt-rail { position: relative; padding-left: 26px; }
.pt-rail::before {
  content: ""; position: absolute; left: 5px; top: 14px; bottom: 14px;
  width: 1px; background: var(--line);
}

.pt-item {
  position: relative; display: grid;
  grid-template-columns: 220px 1fr; gap: 4px 28px;
  padding: 14px 0;
}
.pt-item + .pt-item { border-top: 1px solid rgba(255,255,255,0.05); }
.pt-item.is-past { opacity: 0.5; }
.pt-item.is-past:hover { opacity: 0.8; }

.pt-dot {
  position: absolute; left: -26px; top: 17px;
  width: 11px; text-align: center; line-height: 1;
  font-size: 0.5rem; color: var(--ink-sub, #8a8f98);
  background: var(--surface, #0e0f12);
  padding: 3px 0;
}
.pt-dot.is-major { color: var(--brand-accent); font-size: 0.625rem; }
.pt-item.is-today .pt-dot { color: var(--brand-accent); }

.pt-when { display: flex; flex-direction: column; gap: 2px; }
.pt-day { font-size: 0.875rem; font-weight: 600; color: var(--ink); }
.pt-item.is-today .pt-day::after {
  content: "Today"; margin-left: 8px; padding: 1px 6px;
  border-radius: 999px; background: var(--brand-accent); color: #fff;
  font-size: 0.625rem; font-weight: 700; letter-spacing: 0.03em;
}
.pt-time { font-size: 0.8125rem; color: var(--ink-sub, #8a8f98); font-variant-numeric: tabular-nums; }

.pt-body { min-width: 0; }
.pt-bodyhead { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.pt-eventtitle {
  margin: 0; font-size: 0.9375rem; font-weight: 600;
  letter-spacing: -0.01em; color: var(--ink); text-wrap: balance;
}
.pt-kind {
  padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--line-strong, rgba(255,255,255,0.14));
  color: var(--ink-sub, #8a8f98);
  font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.03em;
  white-space: nowrap;
}
.pt-kind.is-major { border-color: rgba(94,106,210,0.5); color: #a5adf0; }
.pt-loc { margin: 5px 0 0; font-size: 0.8125rem; color: var(--ink-sub, #8a8f98); }
.pt-desc {
  margin: 8px 0 0; max-width: 62ch;
  font-size: 0.875rem; line-height: 1.55; color: var(--ink-sub, #8a8f98);
  white-space: pre-wrap;
}
.pt-more {
  margin-top: 6px; padding: 0; border: 0; background: none;
  color: var(--brand-accent); font: 600 0.8125rem inherit; cursor: pointer;
}
.pt-more:hover { text-decoration: underline; }
.pt-more:focus-visible { outline: 2px solid var(--brand-accent); outline-offset: 2px; border-radius: 3px; }

/* ── Calendar ── */
.pt-calhead { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.pt-calhead h2 {
  margin: 0; min-width: 11ch; font-size: 1rem; font-weight: 600;
  letter-spacing: -0.015em; color: var(--ink);
}
.pt-nav, .pt-today {
  height: 30px; padding: 0 10px;
  border: 1px solid var(--line-strong, rgba(255,255,255,0.14));
  border-radius: 8px; background: transparent;
  color: var(--ink-sub, #8a8f98); font: 600 0.8125rem/1 inherit; cursor: pointer;
}
.pt-nav { width: 30px; padding: 0; font-size: 1rem; }
.pt-today { margin-left: 4px; }
.pt-nav:hover, .pt-today:hover { color: var(--ink); background: rgba(255,255,255,0.06); }
.pt-nav:focus-visible, .pt-today:focus-visible { outline: 2px solid var(--brand-accent); outline-offset: 1px; }

.pt-grid {
  display: grid; grid-template-columns: repeat(7, minmax(0, 1fr));
  border: 1px solid var(--line); border-radius: 12px; overflow: hidden;
}
.pt-dayname {
  padding: 8px 6px; text-align: center;
  background: rgba(255,255,255,0.03);
  border-bottom: 1px solid var(--line);
  font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--ink-sub, #8a8f98);
}
.pt-cell {
  min-height: 92px; padding: 5px;
  border-right: 1px solid var(--line); border-bottom: 1px solid var(--line);
  display: flex; flex-direction: column; gap: 3px;
}
.pt-cell:nth-child(7n + 7) { border-right: 0; }
.pt-cell:nth-last-child(-n + 7) { border-bottom: 0; }
.pt-cell.is-outside { background: rgba(0,0,0,0.16); }
.pt-cell.is-outside .pt-cellnum { opacity: 0.35; }
.pt-cellnum {
  display: block; font-size: 0.75rem; font-weight: 600;
  color: var(--ink-sub, #8a8f98); padding: 1px 3px;
  font-variant-numeric: tabular-nums;
}
.pt-cell.is-today .pt-cellnum {
  align-self: flex-start; border-radius: 999px;
  background: var(--brand-accent); color: #fff; padding: 1px 7px;
}

.pt-chip {
  display: flex; flex-direction: column; gap: 1px;
  width: 100%; padding: 3px 5px; border: 0; border-radius: 5px;
  background: rgba(255,255,255,0.07); color: var(--ink);
  font: 500 0.6875rem/1.3 inherit; text-align: left; cursor: pointer;
}
.pt-chip:hover { background: rgba(255,255,255,0.13); }
.pt-chip:focus-visible { outline: 2px solid var(--brand-accent); outline-offset: 1px; }
.pt-chip.is-major { background: rgba(94,106,210,0.28); }
.pt-chip.is-major:hover { background: rgba(94,106,210,0.42); }
.pt-chiptime { opacity: 0.7; font-size: 0.625rem; font-variant-numeric: tabular-nums; }
/* Two lines before it gives up, which fits almost every title in this
   programme; one line truncated nearly all of them. */
.pt-chiptitle {
  overflow: hidden; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}

.pt-detail {
  margin-top: 16px; padding: 16px 18px;
  border: 1px solid var(--line-strong, rgba(255,255,255,0.14));
  border-radius: 12px; background: rgba(255,255,255,0.03);
}
.pt-detailwhen { margin: 6px 0 0; font-size: 0.8125rem; color: var(--ink-sub, #8a8f98); }
.pt-close {
  margin-left: auto; width: 26px; height: 26px;
  border: 0; border-radius: 6px; background: transparent;
  color: var(--ink-sub, #8a8f98); font-size: 1.05rem; line-height: 1; cursor: pointer;
}
.pt-close:hover { background: rgba(255,255,255,0.08); color: var(--ink); }

@media (max-width: 720px) {
  .pt-wrap { padding: 24px 16px 64px; }
  /* The date column stops being a column: at this width 190px of it leaves the
     title about twelve characters, and every event wraps to four lines. */
  .pt-item { grid-template-columns: 1fr; gap: 4px; }
  .pt-when { flex-direction: row; align-items: baseline; gap: 8px; }
  .pt-cell { min-height: 58px; padding: 3px; }

  /*
   * On a phone the chip stops being text and becomes a mark.
   *
   * Seven columns across 390px is about 50px a cell. Two clamped lines of
   * 11px text in that space truncated three of five titles mid-word, which
   * tells a reader less than a bar does while looking like a bug. The bar
   * says "something is on, tap it"; the detail panel underneath says what.
   * The title is still on the button for a screen reader.
   */
  .pt-chiptime, .pt-chiptitle { display: none; }
  .pt-chip { min-height: 7px; border-radius: 3px; padding: 0; }
  .pt-chip::after {
    content: ""; display: block; height: 7px; border-radius: 3px;
    background: currentColor; opacity: 0.55;
  }
  .pt-chip.is-major::after { opacity: 1; }
  .pt-dayname { font-size: 0.625rem; padding: 6px 2px; }
}
`;
