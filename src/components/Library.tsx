import React, { useCallback, useEffect, useMemo, useState } from "react";

/**
 * The office library.
 *
 * There are books on a shelf in the office and, until now, no record of who
 * took what. This is that record, and the whole design follows from one fact:
 * the app cannot see the shelf. It only knows what people tell it, so telling
 * it has to be one tap, and the page has to make the state obvious enough that
 * a wrong record is noticed.
 *
 * Modelled on Tasks.tsx throughout: a hook that fetches, failure expressed as
 * `data === null`, an optimistic action with a per-row busy state, and the
 * page's CSS as a string rendered from inside the component.
 */

export type LoanState = "out" | "dueSoon" | "overdue" | "returned";

export type BookItem = {
  id: string;
  title: string;
  author: string | null;
  notes: string | null;
  status: "active" | "archived" | "unaccounted";
  available: boolean;
  dueDate: string | null;
  loanState: LoanState | null;
  borrower: { name: string | null } | null;
  isMine: boolean;
};

export type MyLoan = {
  loanId: string;
  bookId: string;
  title: string;
  dueDate: string;
  loanState: LoanState;
};

type Payload = { books: BookItem[]; mine: MyLoan[] };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A due date in the words somebody would use out loud.
 *
 * Days rather than dates while it is close, because "2 days late" is a
 * prompt and "28 Aug" is a lookup. Parsed as UTC noon so the day name cannot
 * slip either side of midnight.
 */
export function dueLabel(iso: string, now: number = Date.now()): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const at = Date.UTC(y, m - 1, d, 12);
  const today = new Date(now);
  const todayAt = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  const days = Math.round((at - todayAt) / 86_400_000);

  if (days < 0) return `${Math.abs(days)}d late`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  const date = new Date(at);
  if (days < 7) return `due ${DAYS[date.getUTCDay()]}`;
  return `due ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export type LibraryState = {
  data: Payload | null;
  act: (bookId: string, action: "borrow" | "return") => Promise<void>;
  busyId: string | null;
  /** Books this founder is holding past their due date. Drives the nav badge. */
  overdueCount: number;
};

/**
 * Fetches the shelf and performs the one action a founder takes.
 *
 * Not optimistic, unlike ticking off a deadline, and that is deliberate. A
 * deadline toggle is private and always succeeds; borrowing is a claim on a
 * physical object that somebody else may have claimed a second earlier. Showing
 * "yours" and then taking it back would be worse than a moment of "…". The
 * request is the source of truth, and the row is busy until it answers.
 */
export function useLibrary(userEmail?: string): LibraryState {
  const [data, setData] = useState<Payload | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/library");
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

  const act = useCallback(
    async (bookId: string, action: "borrow" | "return") => {
      setBusyId(bookId);
      try {
        // No identity is sent. The server uses the session.
        await fetch("/api/library", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, id: bookId }),
        });
      } catch {
        // Swallowed on purpose: the reload below is what decides what is true,
        // and a failed borrow simply leaves the book on the shelf.
      } finally {
        await load();
        setBusyId(null);
      }
    },
    [load],
  );

  const overdueCount = useMemo(
    () => (data?.mine ?? []).filter((l) => l.loanState === "overdue").length,
    [data],
  );

  return { data: failed ? null : data, act, busyId, overdueCount };
}

function Row({
  book,
  onAct,
  busy,
}: {
  book: BookItem;
  onAct: (id: string, action: "borrow" | "return") => void;
  busy: boolean;
}) {
  const late = book.loanState === "overdue";
  const meta = book.dueDate ? dueLabel(book.dueDate) : null;

  return (
    <li>
      <div className="navitem li-row" style={busy ? { cursor: "wait", opacity: 0.5 } : undefined}>
        <div className="li-text">
          <span className="li-row-title">{book.title}</span>
          {book.author && <span className="li-row-sub">{book.author}</span>}
          {book.notes && <span className="li-row-sub">{book.notes}</span>}
        </div>

        <span className={`li-row-meta${late ? " is-late" : ""}`}>
          {book.status === "unaccounted"
            ? "unaccounted for"
            : book.available
              ? "on the shelf"
              : book.isMine
                ? meta
                : `${book.borrower?.name ?? "someone"}${meta ? `, ${meta}` : ""}`}
        </span>

        {book.status === "active" && (book.available || book.isMine) && (
          <button
            type="button"
            className="li-act"
            disabled={busy}
            onClick={() => onAct(book.id, book.isMine ? "return" : "borrow")}
          >
            {book.isMine ? "Return" : "Borrow"}
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * The shelf, in three groups.
 *
 * "Out with you" first, because the only thing this page asks of a founder is
 * that they bring something back. Then what they can take, then what they
 * cannot, with the name of whoever has it: in an office of twenty the way you
 * get a book is to go and ask, and hiding the name only routes that through an
 * organizer.
 */
export function LibraryPage({ state }: { state: LibraryState }) {
  const { data, act, busyId } = state;

  if (!data) {
    return (
      <div className="li-page">
        <style>{LIBRARY_CSS}</style>
        <h1 className="li-title">Library</h1>
        <p className="li-empty">This did not load. Refreshing usually sorts it.</p>
      </div>
    );
  }

  const books = data.books;
  const mine = books.filter((b) => b.isMine);
  const shelf = books.filter((b) => !b.isMine && b.available);
  const out = books.filter((b) => !b.isMine && !b.available);

  const groups: { key: string; label: string; rows: BookItem[]; urgent?: boolean }[] = [
    { key: "mine", label: "Out with you", rows: mine, urgent: mine.some((b) => b.loanState === "overdue") },
    { key: "shelf", label: "On the shelf", rows: shelf },
    { key: "out", label: "With someone else", rows: out },
  ];

  return (
    <div className="li-page">
      <style>{LIBRARY_CSS}</style>

      <header className="li-head">
        <h1 className="li-title">Library</h1>
        {mine.length > 0 && (
          <p className="li-count">
            <strong>{mine.length}</strong> {mine.length === 1 ? "book" : "books"} with you
          </p>
        )}
      </header>

      {books.length === 0 ? (
        <p className="li-empty">
          The shelf is empty here. Books appear once an organizer adds what is in the office.
        </p>
      ) : (
        groups.map((group) => {
          if (!group.rows.length) return null;
          return (
            <section key={group.key} className="li-group">
              <h2 className={`li-grouphead${group.urgent ? " is-urgent" : ""}`}>
                {group.label} <span>{group.rows.length}</span>
              </h2>
              <ul className="li-list">
                {group.rows.map((book) => (
                  <Row key={book.id} book={book} onAct={act} busy={busyId === book.id} />
                ))}
              </ul>
            </section>
          );
        })
      )}

      <p className="li-note">
        Borrowing is on trust. Four weeks, and the app will remind you once before it is due
        and once after.
      </p>
    </div>
  );
}

export const LIBRARY_CSS = `
.li-page { max-width: min(1280px, 100%); margin: 0 auto; padding: 40px 32px 80px; }

/* One measure for the whole page, for the reason the deadlines page has one:
   a title and its status three hundred pixels apart are two facts, not a row. */
.li-page { --li-measure: 900px; }

.li-head {
  max-width: var(--li-measure);
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 20px; flex-wrap: wrap; padding: 0 10px;
  /* Clears the docked mascot, which floats over exactly this band. */
  margin: 0 var(--mascot-gutter, 0px) 28px 0;
}
.li-title {
  margin: 0; font-size: 1.75rem; font-weight: 700;
  letter-spacing: -0.022em; color: var(--ink);
}
.li-count { margin: 0; font-size: 0.9375rem; color: var(--ink-sub, #8a8f98); }
.li-count strong { color: var(--ink); font-variant-numeric: tabular-nums; }

.li-empty, .li-note {
  margin: 0; max-width: 52ch;
  font-size: 0.9375rem; line-height: 1.55; color: var(--ink-sub, #8a8f98);
}
.li-note { margin-top: 32px; max-width: var(--li-measure); padding: 0 10px; font-size: 0.8125rem; }

.li-group { margin-bottom: 30px; max-width: var(--li-measure); }

.li-grouphead {
  display: flex; align-items: baseline; gap: 8px;
  margin: 0 0 8px; padding: 0 10px 8px;
  border-bottom: 1px solid var(--line);
  font-size: 0.8125rem; font-weight: 700;
  letter-spacing: 0.07em; text-transform: uppercase;
  color: var(--ink-sub, #8a8f98);
}
.li-grouphead.is-urgent { color: var(--brand-red, #e5484d); border-bottom-color: rgba(229,72,77,0.4); }
.li-grouphead span { font-weight: 600; opacity: 0.7; font-variant-numeric: tabular-nums; }

.li-list { margin: 0; padding: 0; list-style: none; }

.li-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 4px 14px;
  min-height: 44px;
  padding: 10px 10px;
  border-radius: 9px;
  background: transparent;
}
.li-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.li-row-title { font-size: 0.9375rem; line-height: 1.4; color: var(--ink); }
.li-row-sub { font-size: 0.8125rem; line-height: 1.5; color: var(--ink-sub, #8a8f98); }
.li-row-meta {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--ink-faint, #8a8f98);
}
.li-row-meta.is-late { color: var(--brand-red, #e5484d); }

/* The one action per row. Quiet until you are on it, because the page is a
   list to read far more often than a thing to click. */
.li-act {
  border: 1px solid var(--line-strong, rgba(255,255,255,0.10));
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  padding: 6px 14px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 120ms var(--ease-out-quart, ease), border-color 120ms var(--ease-out-quart, ease);
}
.li-act:hover:not(:disabled) {
  background: rgba(255,255,255,0.07);
  border-color: var(--line-visible, rgba(255,255,255,0.16));
}
.li-act:focus-visible { outline: 2px solid var(--brand-accent); outline-offset: 2px; }
.li-act:disabled { cursor: wait; opacity: 0.5; }

@media (max-width: 720px) {
  .li-page { padding: 24px 16px 64px; }
  .li-row { grid-template-columns: minmax(0, 1fr) auto; }
  .li-row-meta { grid-column: 1 / -1; }
}
`;
