import React, { useCallback, useEffect, useState } from "react";

/**
 * The founder's deadline card.
 *
 * Sits at the top of the chat view rather than behind its own tab: a to-do list
 * you have to go looking for is a to-do list nobody looks at, and the whole
 * point of the benchmark work was that visible shared deadlines are what drive
 * completion.
 *
 * A deliberate sibling of FounderOS.tsx, not an addition to it. That file is
 * already 1,700 lines and both audits flagged it.
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
  blue: "var(--brand-blue)",
  yellow: "var(--brand-yellow)",
};

const kicker: React.CSSProperties = {
  color: C.faint,
  fontSize: 11,
  letterSpacing: 1.4,
  textTransform: "uppercase",
  fontWeight: 700,
  margin: 0,
};

/** "Fri 11 Sep" — short, and never ambiguous about day of week. */
function formatDue(dueDate: string): string {
  const [y, m, d] = dueDate.split("-").map(Number);
  if (!y || !m || !d) return dueDate;
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()];
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()];
  return `${day} ${d} ${month}`;
}

/** How overdue, in whole days, for the "2 days late" label. */
function daysLate(dueDate: string): number {
  const [y, m, d] = dueDate.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const due = Date.UTC(y, m - 1, d);
  const today = new Date();
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.round((now - due) / 86_400_000));
}

function Progress({ completed, total }: { completed: number; total: number }) {
  // Nothing due yet reads as "nothing due yet", not as zero progress.
  if (total === 0) {
    return <span style={{ color: C.faint, fontSize: 12.5 }}>Nothing due yet</span>;
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
      <span style={{ display: "inline-flex", gap: 3 }} aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            style={{
              width: 7,
              height: 7,
              borderRadius: 9,
              background: i < completed ? C.blue : "transparent",
              border: `1px solid ${i < completed ? C.blue : C.line}`,
            }}
          />
        ))}
      </span>
      <span style={{ color: C.sub, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
        {completed} of {total}
      </span>
    </span>
  );
}

function Row({
  item,
  onToggle,
  busy,
}: {
  item: DeadlineItem;
  onToggle: (item: DeadlineItem) => void;
  busy: boolean;
}) {
  const late = item.group === "overdue" ? daysLate(item.dueDate) : 0;

  return (
    <li style={{ listStyle: "none" }}>
      <label
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          alignItems: "center",
          gap: 12,
          padding: "10px 4px",
          minHeight: 44,
          cursor: busy ? "wait" : "pointer",
          opacity: busy ? 0.55 : 1,
          borderBottom: `1px solid ${C.line}`,
        }}
      >
        <input
          type="checkbox"
          checked={item.done}
          disabled={busy}
          onChange={() => onToggle(item)}
          style={{ width: 20, height: 20, accentColor: C.blue, cursor: "inherit" }}
        />
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: "block",
              color: item.done ? C.faint : C.ink,
              textDecoration: item.done ? "line-through" : "none",
              fontSize: 14.5,
              lineHeight: 1.35,
            }}
          >
            {item.title}
          </span>
          {item.description && !item.done && (
            <span style={{ display: "block", color: C.faint, fontSize: 12.5, marginTop: 2 }}>
              {item.description}
            </span>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
          {item.sprintWeek != null && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: 0.6,
                color: C.faint,
                border: `1px solid ${C.line}`,
                borderRadius: 4,
                padding: "1px 5px",
              }}
            >
              W{item.sprintWeek}
            </span>
          )}
          <span
            style={{
              fontSize: 12,
              color: item.group === "overdue" ? C.red : C.faint,
              fontWeight: item.group === "overdue" ? 700 : 400,
            }}
          >
            {item.group === "overdue"
              ? late === 0
                ? "Overdue"
                : `${late}d late`
              : formatDue(item.dueDate)}
          </span>
        </span>
      </label>
    </li>
  );
}

export default function Tasks({ userEmail }: { userEmail?: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

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
      if (!data) return;
      setBusyId(item.id);

      // Optimistic, then replaced by whatever the server actually stored.
      setData({
        ...data,
        deadlines: data.deadlines.map((d) => (d.id === item.id ? { ...d, done: !d.done } : d)),
      });

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
    [data, load],
  );

  if (!userEmail || failed || !data || data.deadlines.length === 0) return null;

  const overdue = data.deadlines.filter((d) => d.group === "overdue");
  const thisWeek = data.deadlines.filter((d) => d.group === "thisWeek");
  const upcoming = data.deadlines.filter((d) => d.group === "upcoming");
  const done = data.deadlines.filter((d) => d.group === "done");

  // Collapsed shows only what needs doing now; the rest is one click away.
  const visible = expanded
    ? [
        { label: "Overdue", items: overdue },
        { label: "This week", items: thisWeek },
        { label: "Upcoming", items: upcoming },
        { label: "Done", items: done },
      ]
    : [
        { label: "Overdue", items: overdue },
        { label: "This week", items: thisWeek },
      ];

  const hiddenCount = expanded ? 0 : upcoming.length + done.length;

  return (
    <section
      aria-label="Your deadlines"
      style={{
        border: `1px solid ${C.line}`,
        borderRadius: 10,
        padding: "14px 16px 6px",
        margin: "0 0 22px",
        background: "rgba(255,255,255,0.025)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 6,
        }}
      >
        <p style={kicker}>
          {overdue.length > 0 ? "Needs attention" : thisWeek.length > 0 ? "This week" : "Deadlines"}
        </p>
        <Progress completed={data.progress.completed} total={data.progress.total} />
      </div>

      {visible.map(({ label, items }) =>
        items.length === 0 ? null : (
          <div key={label}>
            {(expanded || (label === "Overdue" && overdue.length > 0 && thisWeek.length > 0)) && (
              <p style={{ ...kicker, fontSize: 10, marginTop: 12, marginBottom: 2, color: label === "Overdue" ? C.red : C.faint }}>
                {label}
              </p>
            )}
            <ul style={{ margin: 0, padding: 0 }}>
              {items.map((item) => (
                <Row key={item.id} item={item} onToggle={toggle} busy={busyId === item.id} />
              ))}
            </ul>
          </div>
        ),
      )}

      {overdue.length === 0 && thisWeek.length === 0 && !expanded && (
        <p style={{ margin: "8px 0 12px", color: C.faint, fontSize: 13.5, fontFamily: "var(--font-serif)", fontStyle: "italic" }}>
          Nothing due this week.
        </p>
      )}

      {(hiddenCount > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: "none",
            border: "none",
            color: C.faint,
            cursor: "pointer",
            fontSize: 12,
            padding: "10px 4px",
            minHeight: 44,
            fontFamily: "inherit",
          }}
        >
          {expanded ? "Show less" : `Show all (${hiddenCount} more)`}
        </button>
      )}
    </section>
  );
}
