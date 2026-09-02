import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFounder, createOrganizer, createMentor, get, post,
  startServer, twoFounders, type Harness, type Session,
} from "./helpers/harness";
import { dueDateFor, loanStateFor, LOAN_DAYS } from "../src/lib/library";

/**
 * The office library.
 *
 * Net-new attack surface on a codebase that has been through two audits, so it
 * is tested against the exact bug classes those found rather than trusting that
 * they were understood: an identity taken from a request body, an id chosen by
 * the caller, a role gate that is not there, and a cascade that leaves orphans.
 *
 * The one rule that is this feature's own is that a book is out with at most
 * one person. A partial unique index enforces it, and the test for it is the
 * one that would fail if somebody replaced that with a read-then-write check.
 */

let h: Harness;
let organizer: Session;
let alice: Session;
let bob: Session;

async function addBook(as: Session, fields: Record<string, unknown>) {
  const res = await post(h, "/api/library", { action: "create", ...fields }, as.cookie);
  return { status: res.status, body: await res.json() as { id: string; error?: string } };
}

async function shelf(as: Session) {
  const res = await get(h, "/api/library", as.cookie);
  return await res.json() as {
    books: {
      id: string; title: string; available: boolean; isMine: boolean;
      dueDate: string | null; borrower: { name: string | null } | null;
      status: string; loanState: string | null;
    }[];
    mine: { loanId: string; bookId: string; title: string; dueDate: string }[];
  };
}

beforeAll(async () => {
  h = await startServer();
  const users = await twoFounders(h);
  organizer = users.organizer;
  alice = users.alice;
  bob = users.bob;
});

afterAll(() => h?.stop());

describe("role gates", () => {
  test("a founder cannot add a book", async () => {
    const res = await post(h, "/api/library", {
      action: "create", title: "Founder added this",
    }, alice.cookie);
    expect(res.status).toBe(403);
  });

  test("a founder cannot edit, archive or delete one", async () => {
    const { body } = await addBook(organizer, { title: "Real book" });
    for (const fields of [{ title: "hijacked" }, { status: "archived" }]) {
      const res = await post(h, "/api/library", { action: "update", id: body.id, ...fields }, alice.cookie);
      expect(res.status).toBe(403);
    }
    const removed = await post(h, "/api/library", { action: "delete", id: body.id }, alice.cookie);
    expect(removed.status).toBe(403);
  });

  test("a founder cannot read the organizer view", async () => {
    const res = await get(h, "/api/library?view=status", alice.cookie);
    expect(res.status).toBe(403);
  });

  test("nor can a mentor, who reads the cohort but does not run the shelf", async () => {
    /* canReadCohort covers organizers and mentors, and this endpoint
       deliberately does not use it. A mentor reading founders' progress is the
       point of that helper; running the office bookshelf is not. */
    const mentor = await createMentor(h, "mentor-lib@example.test", "M");
    const res = await get(h, "/api/library?view=status", mentor.cookie);
    expect(res.status).toBe(403);
  });

  test("anonymous callers get nothing", async () => {
    expect((await get(h, "/api/library")).status).toBe(401);
    expect((await get(h, "/api/library?view=status")).status).toBe(401);
    expect((await post(h, "/api/library", { action: "create", title: "x" })).status).toBe(401);
    expect((await post(h, "/api/library", { action: "borrow", id: "x" })).status).toBe(401);
  });
});

describe("a loan is always the caller's own", () => {
  test("borrowing ignores any identity in the body", async () => {
    const { body } = await addBook(organizer, { title: "Zero to One" });

    // Bob borrows it, trying every shape of "do this as Alice" the old
    // endpoints would have accepted.
    const res = await post(h, "/api/library", {
      action: "borrow",
      id: body.id,
      userEmail: alice.email,
      user_email: alice.email,
      user: alice.email,
    }, bob.cookie);
    expect(res.status).toBe(200);

    // Only Bob's loan exists.
    const db = h.db();
    try {
      const rows = db
        .query("SELECT user_email FROM book_loans WHERE book_id = $id")
        .all({ $id: body.id }) as { user_email: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]!.user_email).toBe(bob.email);
    } finally {
      db.close();
    }

    // And Alice is not holding it.
    const mine = await shelf(alice);
    expect(mine.mine.some((l) => l.bookId === body.id)).toBe(false);
    expect(mine.books.find((b) => b.id === body.id)!.isMine).toBe(false);
  });

  test("a founder cannot return somebody else's book", async () => {
    const { body } = await addBook(organizer, { title: "Bob's for now" });
    await post(h, "/api/library", { action: "borrow", id: body.id }, bob.cookie);

    const res = await post(h, "/api/library", { action: "return", id: body.id }, alice.cookie);
    expect(res.status).toBe(403);

    // Still out with Bob.
    const db = h.db();
    try {
      const open = db
        .query("SELECT user_email FROM book_loans WHERE book_id = $id AND returned_at IS NULL")
        .get({ $id: body.id }) as { user_email: string } | null;
      expect(open?.user_email).toBe(bob.email);
    } finally {
      db.close();
    }
  });

  test("an organizer can, for the book handed back in person", async () => {
    const { body } = await addBook(organizer, { title: "Handed over a desk" });
    await post(h, "/api/library", { action: "borrow", id: body.id }, bob.cookie);

    const res = await post(h, "/api/library", { action: "return", id: body.id }, organizer.cookie);
    expect(res.status).toBe(200);

    const list = await shelf(alice);
    expect(list.books.find((b) => b.id === body.id)!.available).toBe(true);
  });
});

describe("ids are server-generated", () => {
  test("a client-supplied id is not honoured", async () => {
    const { body } = await addBook(organizer, { title: "Attempted id", id: "attacker-chosen-id" });
    expect(body.id).not.toBe("attacker-chosen-id");
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe("one copy, one borrower", () => {
  test("a second borrow is refused rather than queued behind the first", async () => {
    const { body } = await addBook(organizer, { title: "The only copy" });

    const first = await post(h, "/api/library", { action: "borrow", id: body.id }, alice.cookie);
    expect(first.status).toBe(200);

    const second = await post(h, "/api/library", { action: "borrow", id: body.id }, bob.cookie);
    expect(second.status).toBe(409);

    // And no second row was written. This is the assertion that fails if the
    // unique index is ever replaced with a check in the handler.
    const db = h.db();
    try {
      const open = db
        .query("SELECT COUNT(*) AS n FROM book_loans WHERE book_id = $id AND returned_at IS NULL")
        .get({ $id: body.id }) as { n: number };
      expect(open.n).toBe(1);
    } finally {
      db.close();
    }
  });

  test("two simultaneous taps produce one loan, not two", async () => {
    /* The race the index exists for. Fired together rather than in sequence,
       because a read-then-write handler passes the sequential version. */
    const { body } = await addBook(organizer, { title: "Contended copy" });

    const [a, b] = await Promise.all([
      post(h, "/api/library", { action: "borrow", id: body.id }, alice.cookie),
      post(h, "/api/library", { action: "borrow", id: body.id }, bob.cookie),
    ]);

    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([200, 409]);

    const db = h.db();
    try {
      const open = db
        .query("SELECT COUNT(*) AS n FROM book_loans WHERE book_id = $id AND returned_at IS NULL")
        .get({ $id: body.id }) as { n: number };
      expect(open.n).toBe(1);
    } finally {
      db.close();
    }
  });

  test("returning it puts it back within reach of the next person", async () => {
    const { body } = await addBook(organizer, { title: "Passed along" });
    await post(h, "/api/library", { action: "borrow", id: body.id }, alice.cookie);
    expect((await post(h, "/api/library", { action: "borrow", id: body.id }, bob.cookie)).status).toBe(409);

    expect((await post(h, "/api/library", { action: "return", id: body.id }, alice.cookie)).status).toBe(200);
    expect((await post(h, "/api/library", { action: "borrow", id: body.id }, bob.cookie)).status).toBe(200);

    // The first loan is kept, with its return date. That history is the
    // "and when did they bring it back" half of the whole feature.
    const db = h.db();
    try {
      const rows = db
        .query("SELECT user_email, returned_at FROM book_loans WHERE book_id = $id ORDER BY borrowed_at")
        .all({ $id: body.id }) as { user_email: string; returned_at: string | null }[];
      expect(rows).toHaveLength(2);
      expect(rows[0]!.returned_at).not.toBeNull();
      expect(rows[1]!.returned_at).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe("what a founder is shown", () => {
  test("the borrower's name, and never their address", async () => {
    const { body } = await addBook(organizer, { title: "Shared reading" });
    await post(h, "/api/library", { action: "borrow", id: body.id }, bob.cookie);

    const res = await get(h, "/api/library", alice.cookie);
    const raw = await res.text();

    // Alice can see who to go and ask...
    const list = JSON.parse(raw) as Awaited<ReturnType<typeof shelf>>;
    const book = list.books.find((b) => b.id === body.id)!;
    expect(book.available).toBe(false);
    expect(book.borrower?.name).toBe("Bob");

    // ...and nothing she could use to contact or impersonate him.
    expect(raw).not.toContain(bob.email);
  });

  test("archived books leave the founder shelf but stay in the organizer view", async () => {
    const { body } = await addBook(organizer, { title: "Off the shelf" });
    await post(h, "/api/library", { action: "update", id: body.id, status: "archived" }, organizer.cookie);

    const list = await shelf(alice);
    expect(list.books.some((b) => b.id === body.id)).toBe(false);

    const status = await (await get(h, "/api/library?view=status", organizer.cookie)).json() as
      { books: { id: string }[] };
    expect(status.books.some((b) => b.id === body.id)).toBe(true);
  });

  test("an archived book cannot be borrowed", async () => {
    const { body } = await addBook(organizer, { title: "Withdrawn" });
    await post(h, "/api/library", { action: "update", id: body.id, status: "archived" }, organizer.cookie);
    const res = await post(h, "/api/library", { action: "borrow", id: body.id }, alice.cookie);
    expect(res.status).toBe(409);
  });

  test("the shelf carries no founder prose", async () => {
    /* The organizer view joins books to people. It must never reach further
       than that, into what those people wrote. */
    const secret = "Should I fire my cofounder before the Kiilto demo";
    await post(h, "/api/persistence", {
      action: "save-checkin", userEmail: alice.email,
      checkin: { id: "c-lib-secret", theme: "checkin", prompt: secret, mood: 90 },
    }, alice.cookie);

    const raw = await (await get(h, "/api/library?view=status", organizer.cookie)).text();
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain("mood");
  });
});

describe("due dates", () => {
  test("a loan runs four weeks by default", async () => {
    const { body } = await addBook(organizer, { title: "Four weeks" });
    const res = await post(h, "/api/library", { action: "borrow", id: body.id }, alice.cookie);
    const { dueDate } = await res.json() as { dueDate: string };
    expect(dueDate).toBe(dueDateFor(new Date()));
  });

  test("a founder cannot choose their own due date", async () => {
    // Ignored rather than refused: it is not their field to set.
    const { body } = await addBook(organizer, { title: "Not your call" });
    const res = await post(h, "/api/library", {
      action: "borrow", id: body.id, dueDate: "2027-12-31",
    }, alice.cookie);
    const { dueDate } = await res.json() as { dueDate: string };
    expect(dueDate).not.toBe("2027-12-31");
    expect(dueDate).toBe(dueDateFor(new Date()));
  });

  test("an organizer can move one, which is how a renewal works", async () => {
    const { body } = await addBook(organizer, { title: "Extended" });
    await post(h, "/api/library", { action: "borrow", id: body.id }, alice.cookie);
    const mine = await shelf(alice);
    const loanId = mine.mine.find((l) => l.bookId === body.id)!.loanId;

    const res = await post(h, "/api/library", {
      action: "set-due", loanId, dueDate: "2026-12-01",
    }, organizer.cookie);
    expect(res.status).toBe(200);

    const after = await shelf(alice);
    expect(after.mine.find((l) => l.bookId === body.id)!.dueDate).toBe("2026-12-01");
  });

  test("a founder cannot move their own due date", async () => {
    const { body } = await addBook(organizer, { title: "No self-service extension" });
    await post(h, "/api/library", { action: "borrow", id: body.id }, alice.cookie);
    const mine = await shelf(alice);
    const loanId = mine.mine.find((l) => l.bookId === body.id)!.loanId;

    const res = await post(h, "/api/library", {
      action: "set-due", loanId, dueDate: "2027-12-01",
    }, alice.cookie);
    expect(res.status).toBe(403);
  });

  test("an impossible date is refused", async () => {
    const { body } = await addBook(organizer, { title: "Bad date" });
    await post(h, "/api/library", { action: "borrow", id: body.id }, alice.cookie);
    const mine = await shelf(alice);
    const loanId = mine.mine.find((l) => l.bookId === body.id)!.loanId;

    for (const dueDate of ["2026-02-31", "not-a-date", "26-01-01", 20260101, null]) {
      const res = await post(h, "/api/library", { action: "set-due", loanId, dueDate }, organizer.cookie);
      expect(`${String(dueDate)} -> ${res.status}`).toBe(`${String(dueDate)} -> 400`);
    }
  });
});

describe("input validation", () => {
  test("a book needs a title", async () => {
    for (const title of ["", "   ", 42, null, undefined, { toString: () => "x" }]) {
      const res = await post(h, "/api/library", { action: "create", title }, organizer.cookie);
      expect(`${String(title)} -> ${res.status}`).toBe(`${String(title)} -> 400`);
    }
  });

  test("an oversized body is refused before it reaches the table", async () => {
    const res = await post(h, "/api/library", {
      action: "create", title: "x", notes: "A".repeat(2_000_000),
    }, organizer.cookie);
    expect(res.status).toBe(413);
  });

  test("a long title is truncated to the cap rather than stored whole", async () => {
    const { body } = await addBook(organizer, { title: "T".repeat(500) });
    const db = h.db();
    try {
      const row = db.query("SELECT title FROM books WHERE id = $id").get({ $id: body.id }) as { title: string };
      expect(row.title.length).toBe(200);
    } finally {
      db.close();
    }
  });

  test("an unknown action is a 400, not a 500", async () => {
    const res = await post(h, "/api/library", { action: "incinerate" }, organizer.cookie);
    expect(res.status).toBe(400);
  });

  test("borrowing something that does not exist is a 404", async () => {
    const res = await post(h, "/api/library", { action: "borrow", id: "no-such-book" }, alice.cookie);
    expect(res.status).toBe(404);
  });
});

describe("deleting a book", () => {
  test("takes its loans and reminders with it, leaving no orphans", async () => {
    const { body } = await addBook(organizer, { title: "To delete" });
    await post(h, "/api/library", { action: "borrow", id: body.id }, alice.cookie);

    const db = h.db();
    try {
      const loan = db
        .query("SELECT id FROM book_loans WHERE book_id = $id")
        .get({ $id: body.id }) as { id: string };
      db.run("INSERT INTO book_reminders (loan_id, kind) VALUES ($id, 'due-3d')", { $id: loan.id });
    } finally {
      db.close();
    }

    expect((await post(h, "/api/library", { action: "delete", id: body.id }, organizer.cookie)).status).toBe(200);

    const after = h.db();
    try {
      expect((after.query("SELECT COUNT(*) n FROM book_loans WHERE book_id = $id").get({ $id: body.id }) as { n: number }).n).toBe(0);
      const orphans = after
        .query("SELECT COUNT(*) n FROM book_reminders WHERE loan_id NOT IN (SELECT id FROM book_loans)")
        .get() as { n: number };
      expect(orphans.n).toBe(0);
    } finally {
      after.close();
    }
  });

  test("the audit records the title, since the id says nothing once it is gone", async () => {
    const { body } = await addBook(organizer, { title: "Audited removal of a book" });
    await post(h, "/api/library", { action: "delete", id: body.id }, organizer.cookie);

    const db = h.db();
    try {
      const row = db
        .query("SELECT detail FROM admin_audit WHERE action = 'book:delete' ORDER BY rowid DESC LIMIT 1")
        .get() as { detail: string } | null;
      expect(row?.detail).toContain("Audited removal of a book");
    } finally {
      db.close();
    }
  });
});

describe("erasing a founder keeps the shelf honest", () => {
  test("a book still out with them is marked unaccounted, not made available", async () => {
    /*
     * The case that is easy to get wrong. A loan names a person, so erasure has
     * to delete it. But the book is still in their bag, and deleting the loan
     * alone makes the shelf claim it is available: an organizer would go
     * looking for a book nobody has and nobody can find.
     */
    const leaving = await createFounder(h, organizer, "leaving@example.test", "Leaving", "leaving-password-1");
    const { body } = await addBook(organizer, { title: "Left the building" });
    await post(h, "/api/library", { action: "borrow", id: body.id }, leaving.cookie);

    const removed = await post(h, "/api/admin/users", {
      action: "remove", email: leaving.email,
    }, organizer.cookie);
    expect(removed.status).toBe(200);

    const db = h.db();
    try {
      // Nothing personal is left.
      const loans = db
        .query("SELECT COUNT(*) n FROM book_loans WHERE user_email = $e")
        .get({ $e: leaving.email }) as { n: number };
      expect(loans.n).toBe(0);

      // But the shelf still records that the book left.
      const book = db.query("SELECT status FROM books WHERE id = $id").get({ $id: body.id }) as { status: string };
      expect(book.status).toBe("unaccounted");
    } finally {
      db.close();
    }

    // And it is not offered to the next founder as if it were on the shelf.
    const list = await shelf(alice);
    const row = list.books.find((b) => b.id === body.id);
    expect(row?.available).toBe(false);
    expect((await post(h, "/api/library", { action: "borrow", id: body.id }, alice.cookie)).status).toBe(409);
  });

  test("a book they had already returned is left alone", async () => {
    const passing = await createFounder(h, organizer, "passing@example.test", "Passing", "passing-password-1");
    const { body } = await addBook(organizer, { title: "Returned before leaving" });
    await post(h, "/api/library", { action: "borrow", id: body.id }, passing.cookie);
    await post(h, "/api/library", { action: "return", id: body.id }, passing.cookie);

    await post(h, "/api/admin/users", { action: "remove", email: passing.email }, organizer.cookie);

    const db = h.db();
    try {
      const book = db.query("SELECT status FROM books WHERE id = $id").get({ $id: body.id }) as { status: string };
      expect(book.status).toBe("active");
    } finally {
      db.close();
    }
  });
});

describe("the founder's own data export", () => {
  test("a borrowed book appears in it", async () => {
    const { body } = await addBook(organizer, { title: "Exported reading" });
    await post(h, "/api/library", { action: "borrow", id: body.id }, alice.cookie);

    const raw = await (await get(h, "/api/account", alice.cookie)).text();
    expect(raw).toContain("booksBorrowed");
    expect(raw).toContain("Exported reading");
  });
});

describe("when a loan is late", () => {
  // Fixed instants: this is arithmetic, not a clock.
  const noonHelsinki = Date.parse("2026-09-15T09:00:00Z");

  test("end of day Helsinki, exactly as a deadline is", () => {
    expect(loanStateFor("2026-09-15", null, noonHelsinki)).toBe("dueSoon");
    // 22:00 Helsinki on the day it is due is still not late.
    expect(loanStateFor("2026-09-15", null, Date.parse("2026-09-15T19:00:00Z"))).toBe("dueSoon");
    // Just after local midnight, it is.
    expect(loanStateFor("2026-09-15", null, Date.parse("2026-09-15T21:30:00Z"))).toBe("overdue");
  });

  test("and across the October clock change, where a hand-rolled offset drifts", () => {
    // 25 October 2026 is the day Finland goes back to UTC+2.
    expect(loanStateFor("2026-10-25", null, Date.parse("2026-10-25T21:00:00Z"))).toBe("dueSoon");
    expect(loanStateFor("2026-10-25", null, Date.parse("2026-10-25T22:30:00Z"))).toBe("overdue");
  });

  test("a returned book is never chased, however late it came back", () => {
    expect(loanStateFor("2026-09-01", "2026-09-20T10:00:00Z", noonHelsinki)).toBe("returned");
  });

  test("far off is neither due soon nor late", () => {
    expect(loanStateFor("2026-12-01", null, noonHelsinki)).toBe("out");
  });

  test("the loan period is four weeks", () => {
    expect(LOAN_DAYS).toBe(28);
    expect(dueDateFor(new Date("2026-09-15T12:00:00Z"))).toBe("2026-10-13");
  });
});
