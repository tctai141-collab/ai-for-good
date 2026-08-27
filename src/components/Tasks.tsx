import React, { useCallback, useEffect, useMemo, useState } from "react";

/**
 * The founder's deadlines, in the sidebar.
 *
 * This first shipped as a card pinned above the conversation. That put a
 * worklist inside a reading surface: it competed with the thing the founder
 * came to do, and it scrolled away the moment they started typing — so it was
 * neither persistent nor out of the way.
 *
 * The sidebar is where the app already keeps "what is true about you right
 * now", next to today's check-in. But it is 264px wide inside its padding, and
 * its only scroll region is the thread list, so a straight move would have
 * squeezed both. What lives here is a status object, not a worklist: one line
 * per deadline, only what is actually due, capped at three until asked.
 *
 * The fetching lives in useDeadlines() rather than in the component because
 * two places need the same answer — this section, and the badge on the
 * expand-sidebar button that keeps overdue work visible when the sidebar is
 * closed, which is how every phone starts.
 */

export type DeadlineGroup = "overdue" | "thisWeek" | "upcoming" | "done";

export type DeadlineItem = {
  id: string;
  title: string;
  description: string | null;
  dueDate: string;
  sprintWeek: number | null;
  done: boolean;
  group: DeadlineGroup;
};

type Payload = {
  deadlines: DeadlineItem[];
  progress: { completed: number; total: number };
};

const C = {
  ink: "var(--ink)",
  sub: "var(--ink-sub)",
  faint: "var(--ink-faint)",
  line: "var(--line)",
  red: "var(--brand-red)",
  accent: "var(--brand-accent)",
};

/** Matches the sidebar's other section headings exactly. */
const heading: React.CSSProperties = {
  color: C.faint,
  fontSize: 9.5,
  letterSpacing: 2,
  textTransform: "uppercase",
  fontWeight: 800,
  margin: 0,
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parse(dueDate: string): Date | null {
  const [y, m, d] = dueDate.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

/** Whole days a deadline is past, for the "3d late" label. */
function daysLate(dueDate: string): number {
  const due = parse(dueDate);
  if (!due) return 0;
  const today = new Date();
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.round((now - due.getTime()) / 86_400_000));
}

/**
 * At this width the date has to earn its characters.
 *
 * Within the week a weekday is what a founder actually plans against — "Fri"
 * answers "how long have I got" without arithmetic. Further out the weekday
 * stops being useful and the calendar date takes over.
 */
export function statusLabel(item: DeadlineItem): string {
  if (item.done) return "Done";
  if (item.group === "overdue") {
    const late = daysLate(item.dueDate);
    return late <= 0 ? "Late" : `${late}d late`;
  }
  const date = parse(item.dueDate);
  if (!date) return item.dueDate;
  if (item.group === "thisWeek") return DAYS[date.getUTCDay()]!;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/**
 * One fetch, shared. Returns the founder's list plus the overdue count, which
 * the shell needs for the collapsed-sidebar badge.
 */
export function useDeadlines(userEmail?: string) {
  const [data, setData] = useState<Payload | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /* Ticking something off moves it to the "done" group, which would make the
     row vanish mid-click. Anything toggled in this session stays put so the
     founder can see it land — and untick it if they were wrong. */
  const [pinned, setPinned] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/deadlines");
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as Payload);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (userEmail) void load();
  }, [userEmail, load]);

  const toggle = useCallback(
    async (item: DeadlineItem) => {
      setBusyId(item.id);
      setPinned((prev) => new Set(prev).add(item.id));
      setData((prev) =>
        prev
          ? { ...prev, deadlines: prev.deadlines.map((d) => (d.id === item.id ? { ...d, done: !d.done } : d)) }
          : prev,
      );

      try {
        const res = await fetch("/api/deadlines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // No user identity is sent. The server uses the session, and there is
          // no parameter here that could say otherwise.
          body: JSON.stringify({ action: "toggle", id: item.id, done: !item.done }),
        });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        setFailed(true);
      } finally {
        await load();
        setBusyId(null);
      }
    },
    [load],
  );

  const overdueCount = useMemo(
    () => (data ? data.deadlines.filter((d) => d.group === "overdue").length : 0),
    [data],
  );

  return { data: failed ? null : data, toggle, busyId, pinned, overdueCount };
}

export type DeadlinesState = ReturnType<typeof useDeadlines>;

function Row({
  item,
  onToggle,
  busy,
}: {
  item: DeadlineItem;
  onToggle: (item: DeadlineItem) => void;
  busy: boolean;
}) {
  const overdue = item.group === "overdue" && !item.done;

  /*
   * Built for the page, which is the only place this is used now.
   *
   * It was drawn for a 264px sidebar: 13px, one line, truncated with the rest
   * on hover. On a full-width page that reads as a spreadsheet of nothing —
   * a short title, then eight hundred pixels of dark, then a date the eye has
   * lost the thread of by the time it arrives. The description was stored and
   * never shown, which is the part somebody actually needs to know what the
   * deadline asks of them.
   *
   * So: real type, the description on its own line, and a measure. A checklist
   * does not get better by being stretched to the width of a monitor, and the
   * page around it is still full width.
   */
  return (
    <li style={{ listStyle: "none" }}>
      <label
        className="navitem dl-row"
        style={{ cursor: busy ? "wait" : "pointer", opacity: busy ? 0.5 : 1 }}
      >
        <input
          type="checkbox"
          className="deadline-check"
          checked={item.done}
          disabled={busy}
          onChange={() => onToggle(item)}
        />
        <span className="dl-text">
          <span
            className="dl-row-title"
            style={{
              color: item.done ? C.faint : C.ink,
              textDecoration: item.done ? "line-through" : "none",
              textDecorationColor: "rgba(255,255,255,0.35)",
            }}
          >
            {item.title}
          </span>
          {item.description && <span className="dl-row-desc">{item.description}</span>}
        </span>
        <span
          className="dl-row-meta"
          style={{
            fontWeight: overdue ? 800 : 600,
            color: overdue ? C.red : C.faint,
          }}
        >
          {statusLabel(item)}
        </span>
      </label>
    </li>
  );
}

/** How many rows show before "N more". Three keeps the thread list alive. */

/**
 * The one deadline worth a founder's attention right now, and how many others
 * are waiting behind it.
 *
 * Exists for the phone. Everything else in this file lives in the sidebar, and
 * the sidebar is collapsed to nothing below 700px, which hid both of the daily
 * actions on the device founders actually carry between sessions.
 */
export function nextUp(state: DeadlinesState): { item: DeadlineItem; label: string; more: number } | null {
  const items = state.data?.deadlines ?? [];
  const open = items.filter((d) => !d.done);
  if (!open.length) return null;
  const order = { overdue: 0, thisWeek: 1, upcoming: 2, done: 3 } as Record<string, number>;
  const sorted = [...open].sort(
    (a, b) => (order[a.group] ?? 9) - (order[b.group] ?? 9) || a.dueDate.localeCompare(b.dueDate),
  );
  const item = sorted[0];
  if (!item) return null;
  return { item, label: statusLabel(item), more: sorted.length - 1 };
}


/**
 * Deadlines as a page of their own.
 *
 * The sidebar block this replaces had to be a summary: three rows, a count, and
 * a "+4 more" that hid the rest. Deadlines are the one thing in the programme
 * with a date and a consequence, and reading them should not mean expanding a
 * strip in a navigation column.
 *
 * The rows, the toggle and the busy state are the same ones the sidebar used,
 * so ticking something off here behaves exactly as it did there. Only the
 * arrangement is new: everything visible at once, grouped by when it is due.
 */
export function DeadlinesPage({ state }: { state: DeadlinesState }) {
  const { data, toggle, busyId } = state;

  if (!data) {
    return (
      <div className="dl-page">
        <style>{DEADLINES_CSS}</style>
        <h1 className="dl-title">Deadlines</h1>
        <p className="dl-empty">These did not load. Refreshing usually sorts it.</p>
      </div>
    );
  }

  const items = data.deadlines;
  const { completed, total } = data.progress ?? { completed: 0, total: 0 };

  /* Grouped by when, in the order somebody cares about them. Done last and
     quiet: it is a record, not a task. */
  const groups: { key: DeadlineGroup; label: string; urgent?: boolean }[] = [
    { key: "overdue", label: "Overdue", urgent: true },
    { key: "thisWeek", label: "This week" },
    { key: "upcoming", label: "Later" },
    { key: "done", label: "Done" },
  ];

  return (
    <div className="dl-page">
      <style>{DEADLINES_CSS}</style>

      <header className="dl-head">
        <h1 className="dl-title">Deadlines</h1>
        {total > 0 && (
          <p className="dl-count">
            <strong>{completed}</strong> of {total} done
          </p>
        )}
      </header>

      {items.length === 0 ? (
        <p className="dl-empty">
          Nothing set yet. Deadlines appear here as the team plans the sprint.
        </p>
      ) : (
        groups.map((group) => {
          const rows = items.filter((d) => d.group === group.key);
          if (!rows.length) return null;
          return (
            <section key={group.key} className={`dl-group${group.key === "done" ? " is-done" : ""}`}>
              <h2 className={`dl-grouphead${group.urgent ? " is-urgent" : ""}`}>
                {group.label} <span>{rows.length}</span>
              </h2>
              <ul className="dl-list">
                {rows.map((item) => (
                  <Row key={item.id} item={item} onToggle={toggle} busy={busyId === item.id} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

export const DEADLINES_CSS = `
.dl-page { max-width: min(1280px, 100%); margin: 0 auto; padding: 40px 32px 80px; }

/*
 * One measure for the whole page.
 *
 * The rows are capped because a title and its date three hundred pixels apart
 * are two facts rather than one line. Everything else has to be capped to the
 * same number, or the group rules and the "1 of 5 done" overshoot the rows
 * they belong to and the page loses its right edge.
 */
.dl-page { --dl-measure: 900px; }

.dl-head {
  max-width: var(--dl-measure);
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 20px; flex-wrap: wrap; padding: 0 10px;
  /* The docked mascot floats over this corner, and this row sits in exactly
     its band. As a margin rather than padding: once the measure binds, the
     count is already well clear and the gutter costs nothing; below that the
     row gives up the width instead of putting "1 of 5 done" under a face. */
  margin: 0 var(--mascot-gutter, 0px) 28px 0;
}
.dl-title {
  margin: 0; font-size: 1.75rem; font-weight: 700;
  letter-spacing: -0.022em; color: var(--ink);
}
.dl-count { margin: 0; font-size: 0.9375rem; color: var(--ink-sub, #8a8f98); }
.dl-count strong { color: var(--ink); font-variant-numeric: tabular-nums; }

.dl-empty {
  margin: 0; max-width: 46ch;
  font-size: 0.9375rem; line-height: 1.55; color: var(--ink-sub, #8a8f98);
}

.dl-group { margin-bottom: 30px; max-width: var(--dl-measure); }
.dl-group.is-done { opacity: 0.55; }
.dl-group.is-done:hover { opacity: 0.85; }

.dl-grouphead {
  display: flex; align-items: baseline; gap: 8px;
  margin: 0 0 8px; padding: 0 10px 8px;
  border-bottom: 1px solid var(--line);
  font-size: 0.8125rem; font-weight: 700;
  letter-spacing: 0.07em; text-transform: uppercase;
  color: var(--ink-sub, #8a8f98);
}
.dl-grouphead.is-urgent { color: var(--brand-red, #e5484d); border-bottom-color: rgba(229,72,77,0.4); }
.dl-grouphead span { font-weight: 600; opacity: 0.7; font-variant-numeric: tabular-nums; }

.dl-list { margin: 0; padding: 0; list-style: none; }

/* A measure. The page is full width; a checklist inside it is not, or the
   date ends up a screen away from the thing it belongs to. */
.dl-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 4px 14px;
  min-height: 44px;
  padding: 10px 10px;
  border-radius: 9px;
  background: transparent;
}
.dl-row .deadline-check { align-self: center; }
.dl-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dl-row-title { font-size: 0.9375rem; line-height: 1.4; }
.dl-row-desc {
  font-size: 0.8125rem; line-height: 1.5;
  color: var(--ink-sub, #8a8f98);
}
.dl-row-meta {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .dl-page { padding: 24px 16px 64px; }
}
`;
