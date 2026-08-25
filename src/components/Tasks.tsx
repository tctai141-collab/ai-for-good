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
function statusLabel(item: DeadlineItem): string {
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

  return (
    <li style={{ listStyle: "none" }}>
      <label
        className="navitem"
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          alignItems: "center",
          gap: 9,
          // 38px with a full-width target. Denser than a nav row on purpose —
          // these are status, not navigation — but still comfortably tappable.
          minHeight: 38,
          padding: "8px 8px",
          borderRadius: 8,
          cursor: busy ? "wait" : "pointer",
          opacity: busy ? 0.5 : 1,
          background: "transparent",
        }}
      >
        <input
          type="checkbox"
          className="deadline-check"
          checked={item.done}
          disabled={busy}
          onChange={() => onToggle(item)}
        />
        <span
          // The full text is one hover away; truncation is the price of the
          // column, not a reason to wrap to three lines.
          title={item.description ? `${item.title} — ${item.description}` : item.title}
          style={{
            fontSize: 13,
            lineHeight: 1.3,
            color: item.done ? C.faint : C.ink,
            textDecoration: item.done ? "line-through" : "none",
            textDecorationColor: "rgba(255,255,255,0.35)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {item.title}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: overdue ? 800 : 600,
            color: overdue ? C.red : C.faint,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {statusLabel(item)}
        </span>
      </label>
    </li>
  );
}

/** How many rows show before "N more". Three keeps the thread list alive. */
const COLLAPSED_ROWS = 3;

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

export default function Tasks({ state }: { state: DeadlinesState }) {
  const { data, toggle, busyId, pinned } = state;
  const [expanded, setExpanded] = useState(false);

  if (!data || data.deadlines.length === 0) return null;

  const items = data.deadlines;
  const isLive = (d: DeadlineItem) =>
    d.group === "overdue" || d.group === "thisWeek" || pinned.has(d.id);

  const live = items.filter(isLive);
  const upcoming = items.filter((d) => d.group === "upcoming" && !pinned.has(d.id));
  const done = items.filter((d) => d.group === "done" && !pinned.has(d.id));

  const overdueCount = items.filter((d) => d.group === "overdue").length;
  const thisWeekCount = items.filter((d) => d.group === "thisWeek").length;

  /* The heading carries urgency so the rows don't have to shout it twice. */
  const title =
    overdueCount > 0 ? "Needs attention" : thisWeekCount > 0 ? "This week" : "Deadlines";

  const visible = expanded ? live : live.slice(0, COLLAPSED_ROWS);
  /* When nothing is live, the "Next:" line below already names the first
     upcoming deadline — counting it again here reads as one more than there
     is. */
  const namesNext = live.length === 0 && upcoming.length > 0;
  const hidden = expanded
    ? 0
    : live.length - visible.length + upcoming.length + done.length - (namesNext ? 1 : 0);

  /* Defaulted, not destructured straight off the payload. A 200 whose body
     happens to lack this key threw here, and with no boundary above it that
     took out the entire app — reproduced, black screen, no message. The
     boundary now catches it; this stops it happening at all. */
  const { completed, total } = data.progress ?? { completed: 0, total: 0 };

  return (
    <section aria-label="Your deadlines" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "0 8px 6px" }}>
        <p style={{ ...heading, color: overdueCount > 0 ? C.red : C.faint }}>{title}</p>
        {total > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: C.faint, fontVariantNumeric: "tabular-nums" }}>
            {completed}/{total}
          </span>
        )}
      </div>

      {/* Nothing due yet still says so in one line. An empty box in permanent
          navigation is worse than no box, but silently disappearing teaches
          founders the feature is unreliable. */}
      {live.length === 0 && !expanded ? (
        <p style={{ margin: 0, padding: "0 8px 4px", fontSize: 12.5, color: C.faint, lineHeight: 1.4 }}>
          {upcoming.length > 0 ? (
            <>
              Next: <span style={{ color: C.sub }}>{upcoming[0]!.title}</span> · {statusLabel(upcoming[0]!)}
            </>
          ) : (
            "All clear."
          )}
        </p>
      ) : (
        <ul
          style={{
            margin: 0,
            padding: 0,
            // Only the opened state scrolls, and only if it has to. The thread
            // list below keeps a floor so it can never be squeezed to nothing.
            ...(expanded ? { maxHeight: "38vh", overflowY: "auto" as const } : {}),
          }}
        >
          {visible.map((item) => (
            <Row key={item.id} item={item} onToggle={toggle} busy={busyId === item.id} />
          ))}
          {expanded &&
            upcoming.map((item) => (
              <Row key={item.id} item={item} onToggle={toggle} busy={busyId === item.id} />
            ))}
          {expanded &&
            done.map((item) => (
              <Row key={item.id} item={item} onToggle={toggle} busy={busyId === item.id} />
            ))}
        </ul>
      )}

      {(hidden > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="navitem"
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            background: "transparent",
            border: "none",
            color: C.faint,
            cursor: "pointer",
            fontSize: 11.5,
            fontWeight: 700,
            fontFamily: "inherit",
            padding: "8px 8px",
            minHeight: 34,
            borderRadius: 8,
          }}
        >
          {expanded ? "Show less" : `${hidden} more`}
        </button>
      )}
    </section>
  );
}
