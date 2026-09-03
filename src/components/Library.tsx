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
 * The shelf used to be split into three stacked lists — yours, free, taken —
 * each with its own heading and its own way of writing where a book was. Three
 * lists is three places to look for one book, and the same fact ("Emily has
 * it, back Tuesday") was set as body text in one group and absent from the
 * next. This is one table instead, with status as a column rather than as a
 * position on the page, and filters above it for the times you do want only
 * one group. One row shape, one place a fact lives, one action per row.
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

/* ---------------- Row presentation ---------------- */

type Tone = "ok" | "mine" | "late" | "held" | "unknown";

/**
 * Where a book is, as one badge.
 *
 * The single most useful thing this page can say about a row, so it is a
 * column rather than a heading a reader has to scroll back up to. Overdue gets
 * its own tone instead of sharing "with you": a founder scanning the table
 * should not have to read a date to find out something is late.
 */
function statusOf(book: BookItem): { tone: Tone; label: string } {
  if (book.status === "unaccounted") return { tone: "unknown", label: "Unaccounted for" };
  if (book.available) return { tone: "ok", label: "On the shelf" };
  if (book.isMine) {
    return book.loanState === "overdue"
      ? { tone: "late", label: "Overdue" }
      : { tone: "mine", label: "With you" };
  }
  return { tone: "held", label: book.borrower?.name ?? "With someone" };
}

/**
 * Two letters off the spine.
 *
 * A shelf of prose titles is hard to scan; a block of colour with initials in
 * it gives the eye somewhere to land, the way the avatar column does in a list
 * of people. Deliberately drawn as a book rather than a circle — a round
 * avatar next to a title reads as an author's face.
 */
function initialsOf(title: string): string {
  const words = title.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase());
  return letters.join("") || "?";
}

/**
 * Sort order for the one table.
 *
 * The page asks exactly one thing of a founder — bring back what is late — so
 * that sorts first whatever filter is on, and the rest descends by how much it
 * concerns the reader. Alphabetical inside each band, because past that point
 * the only question is "is my book here", which is a lookup.
 */
function rankOf(book: BookItem): number {
  if (book.isMine) return book.loanState === "overdue" ? 0 : book.loanState === "dueSoon" ? 1 : 2;
  if (book.status === "unaccounted") return 5;
  return book.available ? 3 : 4;
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
  const { tone, label } = statusOf(book);
  const late = book.loanState === "overdue";
  const due = book.dueDate && !book.available ? dueLabel(book.dueDate) : null;
  const actionable = book.status === "active" && (book.available || book.isMine);

  return (
    <tr className={busy ? "is-busy" : undefined}>
      <td>
        <div className="li-book">
          <span className={`li-cover is-${tone}`} aria-hidden="true">
            {initialsOf(book.title)}
          </span>
          <span className="li-book-text">
            <span className="li-book-title">{book.title}</span>
            {book.author && <span className="li-book-sub">{book.author}</span>}
            {book.notes && <span className="li-book-note">{book.notes}</span>}
          </span>
        </div>
      </td>

      <td>
        <span className={`li-badge is-${tone}`}>{label}</span>
        {/* The due date rides along with the badge on a narrow screen, where
            its own column is hidden rather than squeezed. */}
        {due && <span className={`li-due-inline${late ? " is-late" : ""}`}>{due}</span>}
      </td>

      <td className="li-col-due">
        {due ? (
          <span className={`li-due${late ? " is-late" : ""}`}>{due}</span>
        ) : (
          <span className="li-dash" aria-hidden="true">
            —
          </span>
        )}
      </td>

      <td className="li-col-act">
        {actionable && (
          <button
            type="button"
            className={`li-act${book.isMine ? " is-return" : ""}`}
            disabled={busy}
            onClick={() => onAct(book.id, book.isMine ? "return" : "borrow")}
          >
            {busy ? "…" : book.isMine ? "Return" : "Borrow"}
          </button>
        )}
      </td>
    </tr>
  );
}

/* ---------------- Page ---------------- */

type FilterKey = "all" | "shelf" | "mine" | "out";

const FILTERS: { key: FilterKey; label: string; match: (b: BookItem) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "shelf", label: "On the shelf", match: (b) => b.available },
  { key: "mine", label: "With you", match: (b) => b.isMine },
  { key: "out", label: "With others", match: (b) => !b.isMine && !b.available },
];

/**
 * The shelf, as one table.
 *
 * Filters rather than sections: the same rows, narrowed, so a book never
 * changes shape depending on who is holding it. Search is here because an
 * office shelf grows past the point where scanning is faster than typing three
 * letters, and it costs one input to avoid that.
 */
export function LibraryPage({ state }: { state: LibraryState }) {
  const { data, act, busyId } = state;
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");

  const books = data?.books ?? [];

  const counts = useMemo(() => {
    const out = {} as Record<FilterKey, number>;
    for (const f of FILTERS) out[f.key] = books.filter(f.match).length;
    return out;
  }, [books]);

  const overdue = useMemo(
    () => books.filter((b) => b.isMine && b.loanState === "overdue").length,
    [books],
  );

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const match = FILTERS.find((f) => f.key === filter)!.match;
    return books
      .filter(match)
      .filter(
        (b) =>
          !needle ||
          b.title.toLowerCase().includes(needle) ||
          (b.author ?? "").toLowerCase().includes(needle),
      )
      .sort((a, b) => rankOf(a) - rankOf(b) || a.title.localeCompare(b.title));
  }, [books, filter, query]);

  if (!data) {
    return (
      <div className="li-page">
        <style>{LIBRARY_CSS}</style>
        <h1 className="li-title">Library</h1>
        <p className="li-empty">This did not load. Refreshing usually sorts it.</p>
      </div>
    );
  }

  return (
    <div className="li-page">
      <style>{LIBRARY_CSS}</style>

      <header className="li-head">
        <div>
          <h1 className="li-title">Library</h1>
          <p className={`li-sub${overdue ? " is-late" : ""}`}>
            {overdue > 0
              ? `${overdue} ${overdue === 1 ? "book is" : "books are"} overdue — please bring ${overdue === 1 ? "it" : "them"} back.`
              : counts.mine > 0
                ? `${counts.mine} ${counts.mine === 1 ? "book" : "books"} with you, ${counts.shelf} on the shelf.`
                : `${counts.shelf} of ${books.length} on the shelf.`}
          </p>
        </div>
      </header>

      {books.length === 0 ? (
        <p className="li-empty">
          The shelf is empty here. Books appear once an organizer adds what is in the office.
        </p>
      ) : (
        <>
          <div className="li-toolbar">
            <div className="li-tabs" role="tablist" aria-label="Filter the shelf">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.key}
                  className={`li-tab${filter === f.key ? " is-on" : ""}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label} <span className="li-tab-n">{counts[f.key]}</span>
                </button>
              ))}
            </div>

            <input
              type="search"
              className="li-search"
              placeholder="Search title or author"
              aria-label="Search the shelf"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="li-panel">
            {rows.length === 0 ? (
              <p className="li-none">Nothing here. Try another filter, or clear the search.</p>
            ) : (
              <table className="li-table">
                <thead>
                  <tr>
                    <th scope="col">Book</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="li-col-due">
                      Due back
                    </th>
                    <th scope="col" className="li-col-act">
                      <span className="li-sr">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((book) => (
                    <Row key={book.id} book={book} onAct={act} busy={busyId === book.id} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
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
   a title and its status three hundred pixels apart are two facts, not a row.
   Narrower than the 900px this page used to run to, because that is exactly
   what went wrong: at full width a short title sat half a screen from its own
   status badge and the two stopped reading as one line. */
.li-page { --li-measure: 800px; }

.li-head {
  max-width: var(--li-measure);
  padding: 0 2px;
  /* Clears the docked mascot, which floats over exactly this band. */
  margin: 0 var(--mascot-gutter, 0px) 20px 0;
}
.li-title {
  margin: 0; font-size: 1.75rem; font-weight: 700;
  letter-spacing: -0.022em; color: var(--ink);
}
.li-sub { margin: 6px 0 0; font-size: 0.9375rem; color: var(--ink-faint, #8a8f98); }
.li-sub.is-late { color: var(--brand-red, #eb5757); }

.li-empty, .li-note {
  margin: 0; max-width: 52ch;
  font-size: 0.9375rem; line-height: 1.55; color: var(--ink-sub, #8a8f98);
}
.li-note { margin-top: 20px; max-width: var(--li-measure); padding: 0 2px; font-size: 0.8125rem; color: var(--ink-faint, #8a8f98); }

/* ── Toolbar: filters and search on one line ── */
.li-toolbar {
  max-width: var(--li-measure);
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; margin-bottom: 12px; padding: 0 2px;
}
.li-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.li-tab {
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid transparent; background: transparent;
  color: var(--ink-faint, #8a8f98);
  font: inherit; font-size: 0.8125rem; font-weight: 500;
  padding: 6px 11px; border-radius: 999px; cursor: pointer;
  transition: background 120ms var(--ease-out-quart, ease), color 120ms var(--ease-out-quart, ease);
}
.li-tab:hover { background: rgba(255,255,255,0.05); color: var(--ink-sub, #d0d6e0); }
.li-tab.is-on {
  background: rgba(255,255,255,0.07);
  border-color: var(--line-strong, rgba(255,255,255,0.10));
  color: var(--ink);
}
.li-tab:focus-visible { outline: 2px solid var(--brand-accent); outline-offset: 2px; }
.li-tab-n { font-variant-numeric: tabular-nums; font-size: 0.75rem; opacity: 0.65; }

.li-search {
  flex: 0 1 220px; min-width: 150px;
  border: 1px solid var(--line-strong, rgba(255,255,255,0.10));
  background: var(--surface-card, #0f1011);
  color: var(--ink); font: inherit; font-size: 0.8125rem;
  padding: 7px 12px; border-radius: 999px;
}
.li-search::placeholder { color: var(--ink-faint, #8a8f98); }
.li-search:focus { outline: none; border-color: var(--brand-accent); }

/* ── The panel the table sits in ── */
.li-panel {
  max-width: var(--li-measure);
  border: 1px solid var(--line-strong, rgba(255,255,255,0.10));
  border-radius: var(--radius-lg, 12px);
  background: var(--surface-card, #0f1011);
  overflow: hidden;
}
.li-none { margin: 0; padding: 28px 18px; font-size: 0.875rem; color: var(--ink-faint, #8a8f98); }

.li-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.li-table th {
  text-align: left; font-weight: 600;
  font-size: 0.6875rem; letter-spacing: 0.07em; text-transform: uppercase;
  color: var(--ink-faint, #8a8f98);
  padding: 11px 16px;
  background: rgba(255,255,255,0.02);
  border-bottom: 1px solid var(--line-strong, rgba(255,255,255,0.10));
  white-space: nowrap;
}
.li-table td { padding: 11px 16px; vertical-align: middle; border-bottom: 1px solid var(--line, rgba(255,255,255,0.06)); }
.li-table tbody tr:last-child td { border-bottom: 0; }
.li-table tbody tr { transition: background 120ms var(--ease-out-quart, ease); }
.li-table tbody tr:hover { background: rgba(255,255,255,0.025); }
.li-table tbody tr.is-busy { opacity: 0.45; cursor: wait; }

/* Fixed proportions rather than letting the book title absorb every spare
   pixel: the eye tracks title → status → due → button along a straight line,
   and it can only do that if the line is the same length on every row. */
.li-table th:nth-child(1), .li-table td:nth-child(1) { width: 46%; }
.li-table th:nth-child(2), .li-table td:nth-child(2) { width: 26%; }
.li-col-due { width: 1%; white-space: nowrap; }
.li-col-act { width: 1%; text-align: right; white-space: nowrap; }

/* ── The book cell ── */
.li-book { display: flex; align-items: center; gap: 12px; min-width: 0; }
.li-cover {
  flex: none;
  width: 30px; height: 38px;
  display: grid; place-items: center;
  border-radius: 3px 5px 5px 3px;
  /* The spine, so the tile reads as a book rather than a swatch. */
  border-left: 3px solid rgba(255,255,255,0.16);
  background: rgba(255,255,255,0.06);
  color: var(--ink-sub, #d0d6e0);
  font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.02em;
}
.li-cover.is-ok    { background: rgba(76,183,130,0.14);  border-left-color: rgba(76,183,130,0.55);  color: #9fdcbc; }
.li-cover.is-mine  { background: rgba(94,106,210,0.18);  border-left-color: rgba(94,106,210,0.65);  color: #b6bdf0; }
.li-cover.is-late  { background: rgba(235,87,87,0.16);   border-left-color: rgba(235,87,87,0.65);   color: #f4a5a5; }
.li-cover.is-unknown { background: rgba(242,201,76,0.14); border-left-color: rgba(242,201,76,0.55); color: #f0dc9b; }

.li-book-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.li-book-title {
  font-size: 0.875rem; font-weight: 500; line-height: 1.35; color: var(--ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.li-book-sub { font-size: 0.75rem; line-height: 1.4; color: var(--ink-faint, #8a8f98); }
.li-book-note {
  font-size: 0.75rem; line-height: 1.4; color: var(--ink-faint, #8a8f98); opacity: 0.75;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ── Status badge ── */
.li-badge {
  display: inline-flex; align-items: center;
  padding: 3px 9px; border-radius: 999px;
  border: 1px solid transparent;
  font-size: 0.75rem; font-weight: 600; line-height: 1.4;
  white-space: nowrap;
}
.li-badge.is-ok    { background: rgba(76,183,130,0.14); color: #7fd1a8; }
.li-badge.is-mine  { background: rgba(94,106,210,0.18); color: #a3abec; }
.li-badge.is-late  { background: rgba(235,87,87,0.16);  color: #f08a8a; }
.li-badge.is-unknown { background: rgba(242,201,76,0.14); color: #eccf6f; }
.li-badge.is-held  { background: transparent; border-color: var(--line-strong, rgba(255,255,255,0.10)); color: var(--ink-sub, #d0d6e0); }

/* ── Due back ── */
.li-due, .li-due-inline {
  font-size: 0.75rem; font-variant-numeric: tabular-nums;
  color: var(--ink-faint, #8a8f98); white-space: nowrap;
}
.li-due.is-late, .li-due-inline.is-late { color: var(--brand-red, #eb5757); font-weight: 600; }
.li-due-inline { display: none; margin-left: 8px; }
.li-dash { color: var(--ink-faint, #8a8f98); opacity: 0.35; }

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
/* Returning is the thing the page wants to happen, so it is the one button
   that is coloured. Borrowing stays quiet: there are many more of those. */
.li-act.is-return { border-color: rgba(94,106,210,0.45); background: rgba(94,106,210,0.16); }
.li-act.is-return:hover:not(:disabled) { background: rgba(94,106,210,0.26); border-color: rgba(94,106,210,0.6); }
.li-act:focus-visible { outline: 2px solid var(--brand-accent); outline-offset: 2px; }
.li-act:disabled { cursor: wait; opacity: 0.5; }

.li-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

@media (max-width: 720px) {
  .li-page { padding: 24px 16px 64px; }
  .li-toolbar { align-items: stretch; }
  .li-search { flex: 1 1 100%; }
  /* The due column folds into the status cell rather than being squeezed to
     three characters and a wrap. */
  .li-col-due { display: none; }
  .li-due-inline { display: inline; }
  /* Let the columns size to their contents again. The desktop proportions
     squeezed the status column to about 90px here. */
  .li-table th:nth-child(1), .li-table td:nth-child(1),
  .li-table th:nth-child(2), .li-table td:nth-child(2) { width: auto; }
  .li-table th, .li-table td { padding: 10px 12px; }
  .li-book-sub, .li-book-note { display: none; }
}

/* Below this there is no width for three columns: a title, a badge reading
   "Marcus Johnson" and a button do not fit across a phone, and the attempt
   clipped the badge against the panel it was overflowing. Each row becomes a
   block instead — title, then where it is, then the one thing you can do to
   it — which is the shape the organizer's table already folds into. The
   author line comes back, because a stacked row has the room for it. */
@media (max-width: 560px) {
  .li-table, .li-table tbody, .li-table tr, .li-table td { display: block; width: 100%; }
  .li-table thead { display: none; }
  /* Re-hidden: the blanket display:block above outranks the plain .li-col-due
     rule, which brought the folded-away due column back as a second copy of
     the date under the badge that already carries it. */
  .li-table td.li-col-due { display: none; }
  .li-table tr { padding: 14px; border-bottom: 1px solid var(--line, rgba(255,255,255,0.06)); }
  .li-table tbody tr:last-child { border-bottom: 0; }
  .li-table td { border: 0; padding: 0; }
  .li-table td:nth-child(2) { margin-top: 9px; }
  .li-col-act { margin-top: 11px; text-align: left; }
  .li-book-sub { display: block; }
}
`;
