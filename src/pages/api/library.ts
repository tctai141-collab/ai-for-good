import type { APIRoute } from "astro";
import {
  borrowBook,
  countBooks,
  createBook,
  deleteBook,
  getBook,
  getLoan,
  listShelf,
  loanHistory,
  loansForUser,
  openLoanForBook,
  recordAdminAction,
  returnLoan,
  setLoanDue,
  updateBook,
} from "../../db/index";
import { getSessionUser } from "../../lib/auth";
import { dueDateFor, loanStateFor } from "../../lib/library";
import { reportError } from "../../lib/errors";
import { adminWriteLimiter, cap, readJsonBody, tooMany } from "../../lib/limits";

/**
 * The office library: books on a shelf, and who has them.
 *
 * Built against the findings the audits produced rather than repeating them:
 *
 *   - ids are generated server-side, never accepted from a caller
 *   - a loan is always against the session's own email; there is no code path
 *     that reads a borrower out of a request body
 *   - every organizer-only action checks the role before doing anything
 *   - the shelf carries a borrower's name, and never anything they wrote
 */

const MAX_TITLE = 200;
const MAX_AUTHOR = 120;
const MAX_NOTES = 2_000;
/** An office shelf holds tens of books, not thousands. */
const MAX_BOOKS = 1_000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400) {
  return json({ error: message }, status);
}

/** ISO calendar date, and a real one: "2026-02-31" must not pass. */
function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  const roundTrips =
    date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
  return roundTrips ? value : null;
}

/**
 * Whether a failed insert was the one-open-loan-per-book rule.
 *
 * The partial unique index is deliberately the arbiter here, so this has to
 * tell its refusal apart from a real fault: the first is a race two people can
 * legitimately hit, the second is a 500.
 */
function isAlreadyBorrowed(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed/i.test(message) && /book_loans/i.test(message);
}

export const GET: APIRoute = async ({ cookies, request }) => {
  try {
    const session = getSessionUser(cookies);
    if (!session) return err("Not signed in.", 401);

    const url = new URL(request.url);
    const now = Date.now();

    /*
     * The organizer's view: every book including archived ones, each with its
     * whole loan history and the borrower's address so they can be chased.
     *
     * Organizers only, not canReadCohort. A mentor reads the cohort's progress;
     * running the office bookshelf is not that, and the admin page hides the
     * tab from them to match.
     */
    if (url.searchParams.get("view") === "status") {
      if (session.role !== "organizer") return err("Organizers only.", 403);

      const shelf = listShelf(true);
      return json({
        books: shelf.map((b) => ({
          id: b.id,
          title: b.title,
          author: b.author,
          notes: b.notes,
          status: b.status,
          available: b.loan_id === null && b.status === "active",
          loanId: b.loan_id,
          dueDate: b.due_date,
          borrowedAt: b.borrowed_at,
          borrower: b.loan_id
            ? { email: b.borrower_email, name: b.borrower_name }
            : null,
          loanState: b.due_date ? loanStateFor(b.due_date, null, now) : null,
          history: loanHistory(b.id).map((l) => ({
            name: l.name,
            borrowedAt: l.borrowed_at,
            dueDate: l.due_date,
            returnedAt: l.returned_at,
          })),
        })),
      });
    }

    // The shelf as a founder sees it. Archived books are not on it.
    const shelf = listShelf(false);
    const mine = loansForUser(session.email).filter((l) => l.returned_at === null);

    return json({
      books: shelf.map((b) => ({
        id: b.id,
        title: b.title,
        author: b.author,
        notes: b.notes,
        status: b.status,
        available: b.loan_id === null && b.status === "active",
        dueDate: b.due_date,
        loanState: b.due_date ? loanStateFor(b.due_date, null, now) : null,
        // The name, so a founder can go and ask. Never the address, and never
        // anything the person wrote.
        borrower: b.loan_id ? { name: b.borrower_name } : null,
        isMine: b.borrower_email === session.email,
      })),
      mine: mine.map((l) => ({
        loanId: l.id,
        bookId: l.book_id,
        title: l.title,
        dueDate: l.due_date,
        loanState: loanStateFor(l.due_date, null, now),
      })),
    });
  } catch (error) {
    reportError(error, { where: "library.GET" });
    return err("Could not load the library. Please try again.", 500);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  let body: {
    action?: string;
    id?: unknown;
    loanId?: unknown;
    title?: unknown;
    author?: unknown;
    notes?: unknown;
    status?: unknown;
    dueDate?: unknown;
  };

  try {
    const session = getSessionUser(cookies);
    if (!session) return err("Not signed in.", 401);

    const read = await readJsonBody<typeof body>(request);
    if (!read.ok) return read.response;
    body = read.value;

    /*
     * Role and pace in one gate, as on the deadlines route. Every
     * organizer-only action writes a row and they all go through this, so the
     * ceiling cannot be forgotten when a new action is added below.
     */
    const organizerOnly = () => {
      if (session.role !== "organizer") return err("Organizers only.", 403);
      const limited = adminWriteLimiter.check(session.email);
      return limited ? tooMany(limited.retryAfterSeconds) : null;
    };

    switch (body.action) {
      case "create": {
        const denied = organizerOnly();
        if (denied) return denied;

        const title = cap(body.title, MAX_TITLE).trim();
        if (!title) return err("A title is required.");
        if (countBooks() >= MAX_BOOKS) return err("The shelf is full.", 413);

        const created = createBook(
          {
            title,
            author: cap(body.author, MAX_AUTHOR).trim() || null,
            notes: cap(body.notes, MAX_NOTES).trim() || null,
          },
          session.email,
        );
        recordAdminAction(session.email, "book:create", null, `${created.id} ${title}`);
        return json({ ok: true, id: created.id });
      }

      case "update": {
        const denied = organizerOnly();
        if (denied) return denied;

        if (typeof body.id !== "string" || !body.id) return err("id required.");
        if (!getBook(body.id)) return err("No such book.", 404);

        const fields: Parameters<typeof updateBook>[1] = {};
        if (body.title !== undefined) {
          const title = cap(body.title, MAX_TITLE).trim();
          if (!title) return err("A title is required.");
          fields.title = title;
        }
        if (body.author !== undefined) fields.author = cap(body.author, MAX_AUTHOR).trim() || null;
        if (body.notes !== undefined) fields.notes = cap(body.notes, MAX_NOTES).trim() || null;
        if (body.status !== undefined) {
          if (body.status !== "active" && body.status !== "archived") {
            return err("Status must be active or archived.");
          }
          fields.status = body.status;
        }

        updateBook(body.id, fields);
        recordAdminAction(
          session.email, "book:update", null,
          `${body.id} ${JSON.stringify(fields).slice(0, 120)}`,
        );
        return json({ ok: true });
      }

      case "delete": {
        const denied = organizerOnly();
        if (denied) return denied;

        if (typeof body.id !== "string" || !body.id) return err("id required.");
        const existing = getBook(body.id);
        if (!existing) return err("No such book.", 404);

        deleteBook(body.id);
        /* Audited with the title: after the row is gone the id says nothing
           about what was removed. */
        recordAdminAction(session.email, "book:delete", null, `${body.id} ${existing.title}`);
        return json({ ok: true });
      }

      /*
       * Taking a book off the shelf. The one action founders take, and note
       * what is absent: any notion of *whose* loan this is. It is the
       * caller's.
       */
      case "borrow": {
        if (typeof body.id !== "string" || !body.id) return err("id required.");
        const book = getBook(body.id);
        if (!book) return err("No such book.", 404);
        if (book.status !== "active") return err("That book is not on the shelf.", 409);

        /*
         * An organizer may set the date when lending in person; everyone else
         * gets the standard loan. A founder passing dueDate is ignored rather
         * than refused, because it is not their field to set.
         */
        let dueDate = dueDateFor();
        if (session.role === "organizer" && body.dueDate !== undefined) {
          const chosen = validDate(body.dueDate);
          if (!chosen) return err("A valid due date (YYYY-MM-DD) is required.");
          dueDate = chosen;
        }

        try {
          const loan = borrowBook(book.id, session.email, dueDate);
          return json({ ok: true, loanId: loan.id, dueDate: loan.due_date });
        } catch (error) {
          // The unique index is the arbiter, not a check we did first.
          if (isAlreadyBorrowed(error)) {
            return err("Someone just took that one.", 409);
          }
          throw error;
        }
      }

      /*
       * Putting one back.
       *
       * A founder may close their own loan and nobody else's. An organizer may
       * close anyone's, for the book handed back across a desk rather than
       * through the app.
       */
      case "return": {
        if (typeof body.id !== "string" || !body.id) return err("id required.");

        const loan = typeof body.loanId === "string" && body.loanId
          ? getLoan(body.loanId)
          : openLoanForBook(body.id);

        if (!loan || loan.returned_at !== null) return err("That book is not out.", 404);
        if (loan.user_email !== session.email && session.role !== "organizer") {
          return err("That is not your loan.", 403);
        }

        if (!returnLoan(loan.id)) return err("That book is not out.", 404);
        if (session.role === "organizer" && loan.user_email !== session.email) {
          recordAdminAction(session.email, "book:return", loan.user_email, loan.book_id);
        }
        return json({ ok: true });
      }

      /* Moving a due date, which is also how a renewal is expressed. */
      case "set-due": {
        const denied = organizerOnly();
        if (denied) return denied;

        if (typeof body.loanId !== "string" || !body.loanId) return err("loanId required.");
        const dueDate = validDate(body.dueDate);
        if (!dueDate) return err("A valid due date (YYYY-MM-DD) is required.");

        if (!setLoanDue(body.loanId, dueDate)) return err("That loan is not open.", 404);
        recordAdminAction(session.email, "book:set-due", null, `${body.loanId} ${dueDate}`);
        return json({ ok: true });
      }

      default:
        return err(`Unknown action: ${String(body.action)}`);
    }
  } catch (error) {
    reportError(error, { where: "library.POST" });
    return err("That did not work. Nothing was changed.", 500);
  }
};
