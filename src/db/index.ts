import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { initSchema } from "./schema";

const DB_PATH = process.env.DB_PATH || (process.env.NODE_ENV === "production" ? "/app/data/sprint-buddy.db" : "./data/sprint-buddy.db");

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;

  const dir = DB_PATH.substring(0, DB_PATH.lastIndexOf("/"));
  if (dir && !dir.startsWith(".")) {
    try { mkdirSync(dir, { recursive: true }); } catch {}
  }

  _db = new Database(DB_PATH);
  initSchema(_db);
  return _db;
}

export type ThreadRow = {
  id: string;
  user_email: string;
  title: string;
  theme: string;
  state: string;
  last_at: string;
  personality: string;
  /** 1 when the founder has opted this conversation in to coach visibility. */
  shared_with_coach?: number;
  shared_seen_at?: string | null;
  /** Present on `SELECT *`; the shared list orders by it. */
  updated_at?: string;
};

export type MessageRow = {
  id: number;
  thread_id: string;
  role: "user" | "assistant";
  content: string;
};

export type DecisionRow = {
  id: string;
  user_email: string;
  thread_id: string | null;
  summary: string;
  door: "reversible" | "one-way";
  status: "open" | "closed";
  theme: string;
  outcome: string | null;
  at: string;
};

export type CheckinRow = {
  id: string;
  user_email: string;
  ref_decision_id: string | null;
  theme: string | null;
  prompt: string;
  mood: number | null;
  created_at?: string;
};

export type WorkingGeniusRow = {
  user_email: string;
  primary_type: string;
  counts_json: string;
  completed_at: string;
  /**
   * The full scored result: ranking, bands, per-item responses, consistency.
   * Null on rows written by the six-item quiz this replaced, which only ever
   * knew a primary type.
   */
  result_json?: string | null;
  /**
   * When the founder agreed organizers may see their profile, or null.
   *
   * Null means no, including on every row written before the consent card
   * existed: those were taken under a card promising the result was theirs
   * alone, and nothing retroactive turns that into agreement.
   */
  shared_at?: string | null;
  /** What they agreed to. Only "profile" exists; recorded so it can change. */
  shared_scope?: string | null;
  instrument_version?: string | null;
  consistency?: number | null;
};

/**
 * Raised when a caller tries to write a record that belongs to someone else.
 *
 * Every record id below is chosen by the client, so identity ("you are who you
 * say you are") is not the same question as ownership ("this row is yours").
 * Checking only the first is what allowed one founder to overwrite another's
 * conversation. The check lives here rather than in the API layer so it cannot
 * be bypassed by a future caller that forgets it.
 */
export class NotOwnerError extends Error {
  constructor(kind: string) {
    super(`not the owner of this ${kind}`);
    this.name = "NotOwnerError";
  }
}

export type OwnedRecord = "thread" | "decision" | "checkin";

/** The owner of an existing record, or null when the id is not yet taken. */
export function ownerOf(kind: OwnedRecord, id: string): string | null {
  const db = getDb();
  // Literal SQL per branch — no identifier interpolation.
  const sql =
    kind === "thread"
      ? "SELECT user_email FROM threads WHERE id = $id"
      : kind === "decision"
        ? "SELECT user_email FROM decisions WHERE id = $id"
        : "SELECT user_email FROM checkins WHERE id = $id";
  const row = db.query(sql).get({ $id: id }) as { user_email: string } | null;
  return row?.user_email ?? null;
}

/**
 * Throws unless `email` may write to `id`. An id nobody holds yet is claimable;
 * an id somebody else holds is refused rather than silently ignored, so the
 * caller can return 403 instead of reporting a success that did nothing.
 */
function assertOwner(kind: OwnedRecord, id: string, email: string): void {
  const existing = ownerOf(kind, id);
  if (existing !== null && existing !== email) throw new NotOwnerError(kind);
}

export function upsertThread(thread: ThreadRow, messages: { role: "user" | "assistant"; content: string }[]) {
  const db = getDb();

  // Before anything else: this thread must be unclaimed or already ours.
  // Without this, the DELETE FROM messages below would wipe another founder's
  // conversation even when the INSERT itself was correctly scoped.
  assertOwner("thread", thread.id, thread.user_email);

  const insert = db.prepare(`
    INSERT INTO threads (id, user_email, title, theme, state, last_at, personality, updated_at)
    VALUES ($id, $user_email, $title, $theme, $state, $last_at, $personality, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      title = $title, theme = $theme, state = $state, last_at = $last_at,
      personality = $personality, updated_at = datetime('now')
    WHERE threads.user_email = $user_email
  `);

  const deleteMsgs = db.prepare("DELETE FROM messages WHERE thread_id = $thread_id");
  const insertMsg = db.prepare(
    "INSERT INTO messages (thread_id, role, content) VALUES ($thread_id, $role, $content)",
  );

  db.transaction(() => {
    insert.run({
      $id: thread.id,
      $user_email: thread.user_email,
      $title: thread.title,
      $theme: thread.theme,
      $state: thread.state,
      $last_at: thread.last_at,
      $personality: thread.personality,
    });

    deleteMsgs.run({ $thread_id: thread.id });
    for (const m of messages) {
      insertMsg.run({ $thread_id: thread.id, $role: m.role, $content: m.content });
    }
  })();
}

export function getThreads(userEmail: string) {
  const db = getDb();
  const threads = db
    .query("SELECT * FROM threads WHERE user_email = $email ORDER BY updated_at DESC")
    .all({ $email: userEmail }) as ThreadRow[];

  const getMsgs = db.prepare(
    "SELECT id, thread_id, role, content FROM messages WHERE thread_id = $tid ORDER BY id ASC",
  );

  return threads.map((t) => {
    const msgs = getMsgs.all({ $tid: t.id }) as MessageRow[];
    /*
     * shared_state stays behind.
     *
     * It is where the operating team filed a conversation on their own list,
     * and it is not the founder's business that somebody archived what they
     * handed over. shared_seen_at does travel — being told it was read is the
     * point of sharing — but "the team took this off their list" is a
     * different sentence, and not one this app should put in front of anybody.
     */
    const { shared_state: _teamFiling, ...row } = t as ThreadRow & { shared_state?: string };
    return { ...row, messages: msgs.map((m) => ({ role: m.role, content: m.content })) };
  });
}

export function getDecisions(userEmail: string) {
  const db = getDb();
  return db
    .query("SELECT * FROM decisions WHERE user_email = $email ORDER BY created_at DESC")
    .all({ $email: userEmail }) as DecisionRow[];
}

export function upsertDecision(d: Omit<DecisionRow, "at"> & { at?: string }) {
  const db = getDb();
  assertOwner("decision", d.id, d.user_email);

  // A decision may only point at a thread the same person owns. Otherwise one
  // founder could hang their decision off another's conversation.
  const threadId =
    d.thread_id && ownerOf("thread", d.thread_id) === d.user_email ? d.thread_id : null;

  db.run(
    `INSERT INTO decisions (id, user_email, thread_id, summary, door, status, theme, outcome, at, updated_at)
     VALUES ($id, $user_email, $thread_id, $summary, $door, $status, $theme, $outcome, $at, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       status = $status, outcome = $outcome, updated_at = datetime('now'),
       thread_id = COALESCE($thread_id, thread_id)
     WHERE decisions.user_email = $user_email`,
    {
      $id: d.id,
      $user_email: d.user_email,
      $thread_id: threadId,
      $summary: d.summary,
      $door: d.door,
      $status: d.status,
      $theme: d.theme,
      $outcome: d.outcome ?? null,
      $at: d.at ?? "today",
    },
  );
}

export function getCheckins(userEmail: string) {
  const db = getDb();
  return db
    .query("SELECT * FROM checkins WHERE user_email = $email ORDER BY created_at DESC")
    .all({ $email: userEmail }) as CheckinRow[];
}

export function getLastCheckin(userEmail: string): CheckinRow | null {
  const db = getDb();
  const row = db
    .query("SELECT * FROM checkins WHERE user_email = $email ORDER BY created_at DESC LIMIT 1")
    .get({ $email: userEmail }) as CheckinRow | null;
  return row;
}

export function upsertCheckin(c: CheckinRow) {
  const db = getDb();
  assertOwner("checkin", c.id, c.user_email);

  // Same rule as decisions: only reference a decision you own.
  const refDecisionId =
    c.ref_decision_id && ownerOf("decision", c.ref_decision_id) === c.user_email
      ? c.ref_decision_id
      : null;

  db.run(
    `INSERT INTO checkins (id, user_email, ref_decision_id, theme, prompt, mood)
     VALUES ($id, $user_email, $ref_decision_id, $theme, $prompt, $mood)
     ON CONFLICT(id) DO UPDATE SET
       mood = COALESCE($mood, mood)
     WHERE checkins.user_email = $user_email`,
    {
      $id: c.id,
      $user_email: c.user_email,
      $ref_decision_id: refDecisionId,
      $theme: c.theme ?? null,
      $prompt: c.prompt,
      $mood: c.mood ?? null,
    },
  );
}

/** Scoped by owner: deleting somebody else's check-in affects zero rows. */
export function deleteCheckin(id: string, userEmail: string) {
  const db = getDb();
  assertOwner("checkin", id, userEmail);
  db.run("DELETE FROM checkins WHERE id = $id AND user_email = $email", {
    $id: id,
    $email: userEmail,
  });
}

/**
 * Deletes one conversation and everything hanging off it.
 *
 * Scoped to the caller in two ways on purpose. assertOwner throws if the id
 * belongs to somebody else, and the DELETE still carries `AND user_email`, so a
 * gap between the check and the write cannot delete another founder's thread.
 * This is the bug class the audit found — a delete that trusted the id alone.
 *
 * Messages cascade. Decisions do not: their thread_id is ON DELETE SET NULL, so
 * a decision outlives the conversation that prompted it, which is the policy
 * the schema migration settled on. Returns whether a row actually went, so the
 * client is told the truth rather than an optimistic success.
 */
export function deleteThread(id: string, userEmail: string): boolean {
  const db = getDb();

  // One lookup answers both questions: does it exist, and is it theirs. The
  // driver's run() reports no row count, so "did anything go" has to be
  // established before the write rather than read back from it.
  const owner = ownerOf("thread", id);
  if (owner === null) return false;
  if (owner !== userEmail) throw new NotOwnerError("thread");

  /*
   * Decisions captured from this conversation go with it.
   *
   * The foreign key is ON DELETE SET NULL, which kept the decision and merely
   * unlinked it — so a founder who deleted a conversation about a cofounder
   * problem still had a sentence about that cofounder problem in the database,
   * with no thread left to explain where it came from. Tai's call is that
   * delete means delete: everything the conversation produced goes with it.
   *
   * Done explicitly rather than by changing the key to CASCADE, because SQLite
   * cannot alter a foreign key and rebuilding the table to express something
   * one statement says plainly is a poor trade. Both statements run inside a
   * transaction so a crash between them cannot leave the decisions orphaned
   * against a thread that no longer exists.
   */
  db.transaction(() => {
    db.run("DELETE FROM decisions WHERE thread_id = $id AND user_email = $email", {
      $id: id,
      $email: userEmail,
    });
    db.run("DELETE FROM threads WHERE id = $id AND user_email = $email", {
      $id: id,
      $email: userEmail,
    });
  })();

  return true;
}

/**
 * How much a founder is about to destroy, so the warning can say it.
 *
 * "This cannot be undone" is only a fair warning if it names what "this" is.
 * Counted before the delete, from the same ownership rules, so the numbers the
 * dialog shows are the numbers that actually go.
 */
export function threadDeletionImpact(id: string, userEmail: string): { messages: number; decisions: number } {
  const db = getDb();
  const messages = db
    .query("SELECT COUNT(*) AS n FROM messages WHERE thread_id = $id")
    .get({ $id: id }) as { n: number };
  const decisions = db
    .query("SELECT COUNT(*) AS n FROM decisions WHERE thread_id = $id AND user_email = $email")
    .get({ $id: id, $email: userEmail }) as { n: number };
  return { messages: messages.n, decisions: decisions.n };
}

export function getVisits(userEmail: string): number {
  const db = getDb();
  const row = db
    .query("SELECT count FROM visits WHERE user_email = $email")
    .get({ $email: userEmail }) as { count: number } | null;
  return row?.count ?? 0;
}

export function getWorkingGenius(userEmail: string): WorkingGeniusRow | null {
  const db = getDb();
  const row = db
    .query(
      `SELECT user_email, primary_type, counts_json, completed_at,
              result_json, instrument_version, consistency,
              shared_at, shared_scope
         FROM working_genius WHERE user_email = $email`,
    )
    .get({ $email: userEmail }) as WorkingGeniusRow | null;
  return row;
}

export function upsertWorkingGenius(row: WorkingGeniusRow) {
  const db = getDb();
  db.run(
    `INSERT INTO working_genius (
       user_email, primary_type, counts_json, completed_at,
       result_json, instrument_version, consistency, updated_at,
       shared_at, shared_scope
     )
     VALUES (
       $user_email, $primary_type, $counts_json, $completed_at,
       $result_json, $instrument_version, $consistency, datetime('now'),
       $shared_at, $shared_scope
     )
     ON CONFLICT(user_email) DO UPDATE SET
       primary_type = $primary_type,
       counts_json = $counts_json,
       completed_at = $completed_at,
       result_json = $result_json,
       instrument_version = $instrument_version,
       consistency = $consistency,
       updated_at = datetime('now'),
       shared_at = $shared_at,
       shared_scope = $shared_scope`,
    {
      $user_email: row.user_email,
      $primary_type: row.primary_type,
      $counts_json: row.counts_json,
      $completed_at: row.completed_at,
      $result_json: row.result_json ?? null,
      $instrument_version: row.instrument_version ?? null,
      $consistency: row.consistency ?? null,
      $shared_at: row.shared_at ?? null,
      $shared_scope: row.shared_scope ?? null,
    },
  );
}

/**
 * Every founder who agreed to be on the cohort map, with their profile.
 *
 * Deliberately selects the columns rather than the row: result_json carries all
 * thirty individual answers and whatever the founder typed in their own words,
 * and no organizer view is allowed near it. What comes back is the ranking and
 * the bands, which is what was consented to.
 */
export function listSharedWorkingGenius(): Array<{
  user_email: string;
  name: string;
  primary_type: string;
  counts_json: string;
  completed_at: string;
  shared_at: string;
}> {
  const db = getDb();
  return db
    .query(
      `SELECT w.user_email, u.name, w.primary_type, w.counts_json,
              w.completed_at, w.shared_at
         FROM working_genius w
         JOIN users u ON u.email = w.user_email
        WHERE w.shared_at IS NOT NULL
        ORDER BY u.name COLLATE NOCASE`,
    )
    .all() as Array<{
      user_email: string; name: string; primary_type: string;
      counts_json: string; completed_at: string; shared_at: string;
    }>;
}

export function incrementVisits(userEmail: string): number {
  const db = getDb();
  const row = db
    .query(
      `INSERT INTO visits (user_email, count) VALUES ($email, 1)
       ON CONFLICT(user_email) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .get({ $email: userEmail }) as { count: number };
  return row.count;
}

export function ensureUser(email: string, name: string, role: Role) {
  const db = getDb();
  db.run(
    `INSERT OR IGNORE INTO users (email, name, role) VALUES ($email, $name, $role)`,
    { $email: email, $name: name, $role: role },
  );
}

// ---------------------------------------------------------------------------
// Accounts, sessions and invites
//
// Added when the ten hardcoded demo logins were replaced with real cohort
// accounts. `password_hash` is never returned to any caller.
// ---------------------------------------------------------------------------

/**
 * Mentors read; organizers run the cohort.
 *
 * A mentor sees the dashboard, the team map and the conversations founders
 * have handed over, and can change none of it. The distinction exists because
 * the alternative was giving a guest an organizer account, which also lets
 * them delete a founder and everything that founder has written.
 */
export type Role = "founder" | "organizer" | "mentor";

export type UserRow = {
  email: string;
  name: string;
  role: Role;
  password_hash: string | null;
  created_at: string | null;
};

/** What the admin page shows: account state without anything secret. */
export type UserSummary = {
  email: string;
  name: string;
  role: Role;
  activated: boolean;
  created_at: string | null;
};

export function getUserRow(email: string): UserRow | null {
  const db = getDb();
  return db
    .query("SELECT email, name, role, password_hash, created_at FROM users WHERE email = $email")
    .get({ $email: email }) as UserRow | null;
}

export function listUsers(): UserSummary[] {
  const db = getDb();
  const rows = db
    .query("SELECT email, name, role, password_hash, created_at FROM users ORDER BY role DESC, name ASC")
    .all() as UserRow[];
  return rows.map(({ password_hash, ...rest }) => ({
    ...rest,
    activated: Boolean(password_hash),
  }));
}

/** Returns false when the email already exists, so callers can report it. */
export function createUser(email: string, name: string, role: Role): boolean {
  const db = getDb();
  const existing = getUserRow(email);
  if (existing) return false;
  db.run(
    "INSERT INTO users (email, name, role, created_at) VALUES ($email, $name, $role, datetime('now'))",
    { $email: email, $name: name, $role: role },
  );
  return true;
}

export function setUserPassword(email: string, passwordHash: string): void {
  const db = getDb();
  db.run("UPDATE users SET password_hash = $hash WHERE email = $email", {
    $hash: passwordHash,
    $email: email,
  });
}

export function updateUser(email: string, name: string, role: Role): void {
  const db = getDb();
  db.run("UPDATE users SET name = $name, role = $role WHERE email = $email", {
    $name: name,
    $role: role,
    $email: email,
  });
}

/**
 * Removes an account and everything belonging to it.
 *
 * The five original tables reference users(email) with ON DELETE NO ACTION,
 * while foreign_keys is ON — so a plain DELETE FROM users threw a constraint
 * error for any founder who had ever used the app, and the caller turned that
 * into an empty HTTP 500. The account survived; the sessions, already deleted
 * by then, did not.
 *
 * The children are deleted explicitly, in one transaction, in FK order. That
 * is lower-risk than recreating seven tables to change their cascade policy,
 * and it makes the erasure claim in the README true — which matters, because
 * this is the GDPR right-to-erasure path.
 */
export function deleteUser(email: string): void {
  const db = getDb();
  db.transaction(() => {
    // Messages hang off threads, which cascade — but only once the threads
    // themselves go, so delete them via the thread ids first.
    db.run(
      "DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE user_email = $email)",
      { $email: email },
    );
    // checkins.ref_decision_id -> decisions, so check-ins go before decisions.
    db.run("DELETE FROM checkins WHERE user_email = $email", { $email: email });
    // decisions.thread_id -> threads, so decisions go before threads.
    db.run("DELETE FROM decisions WHERE user_email = $email", { $email: email });
    db.run("DELETE FROM threads WHERE user_email = $email", { $email: email });
    db.run("DELETE FROM visits WHERE user_email = $email", { $email: email });
    db.run("DELETE FROM working_genius WHERE user_email = $email", { $email: email });
    // Cascades from users anyway, but erasure is the wrong place to rely on a
    // constraint staying as it is.
    db.run("DELETE FROM working_genius_takes WHERE user_email = $email", { $email: email });
    /*
     * The library, and the one case here where erasing a person is not the
     * whole job.
     *
     * A loan row names a founder, so it is personal data and it goes. But the
     * book is a physical object that is still in their bag, and deleting the
     * loan on its own makes the shelf claim it is available. The next organizer
     * to look would see a book that nobody has and nobody can find.
     *
     * So the book is marked unaccounted first, in the same transaction, which
     * keeps the fact that it left the office without keeping anything about
     * who took it. The reminder rows go with the loans by CASCADE.
     */
    db.run(
      `UPDATE books SET status = 'unaccounted', updated_at = datetime('now')
        WHERE id IN (
          SELECT book_id FROM book_loans
           WHERE user_email = $email AND returned_at IS NULL
        )`,
      { $email: email },
    );
    db.run("DELETE FROM book_loans WHERE user_email = $email", { $email: email });
    // sessions and invites cascade, but being explicit costs nothing and keeps
    // the intent readable next to the rest.
    db.run("DELETE FROM sessions WHERE user_email = $email", { $email: email });
    db.run("DELETE FROM invites WHERE user_email = $email", { $email: email });
    db.run("DELETE FROM users WHERE email = $email", { $email: email });
  })();
}

// --- admin audit ---

export type AuditEntry = {
  id: string;
  actor_email: string;
  action: string;
  subject_email: string | null;
  detail: string | null;
  created_at: string;
};

/**
 * Records an administrative action. Never throws into the caller: losing an
 * audit line is bad, but failing the operation the organizer was performing
 * because the audit write failed is worse.
 */
export function recordAdminAction(
  actorEmail: string,
  action: string,
  subjectEmail: string | null = null,
  detail: string | null = null,
): void {
  try {
    const db = getDb();
    db.run(
      `INSERT INTO admin_audit (id, actor_email, action, subject_email, detail)
       VALUES ($id, $actor, $action, $subject, $detail)`,
      {
        $id: crypto.randomUUID(),
        $actor: actorEmail,
        $action: action,
        $subject: subjectEmail,
        $detail: detail,
      },
    );
  } catch (error) {
    console.error("[audit] could not record admin action:", error);
  }
}

export function listAdminAudit(limit = 200): AuditEntry[] {
  const db = getDb();
  return db
    .query("SELECT * FROM admin_audit ORDER BY created_at DESC, rowid DESC LIMIT $limit")
    .all({ $limit: limit }) as AuditEntry[];
}

export function countOrganizers(): number {
  const db = getDb();
  const row = db
    .query("SELECT COUNT(*) AS n FROM users WHERE role = 'organizer'")
    .get() as { n: number };
  return row.n;
}

// --- sessions ---

export type SessionRow = {
  user_email: string;
  /** When this session goes stale if it is not used again. Slides forward. */
  expires_at: string;
  /** When it was created. Fixes the absolute deadline, which never slides. */
  created_at: string;
  name: string;
  role: Role;
};

/**
 * The cookie value is never what is stored.
 *
 * A session row used to hold the token itself, which meant anyone who could
 * read the database — or one of the thirty days of gzipped, unencrypted
 * backups sitting in object storage — held a working credential for every
 * signed-in person until it idled out. Hashing makes the stored value useless
 * on its own: it authenticates nobody without the original cookie.
 *
 * SHA-256 without a salt or a work factor is the right primitive here, unlike
 * for passwords. The input is 256 bits of CSPRNG output, so there is no
 * dictionary to run and nothing to slow an attacker down against; what matters
 * is only that the stored form is one-way. It is also fast, and this runs on
 * every authenticated request.
 *
 * Lookup is by hash, so the comparison happens inside SQLite's index on a
 * value the attacker cannot influence the timing of usefully — there is no
 * string compare of a secret in JavaScript anywhere in this path.
 */
function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

export function createSessionRow(token: string, email: string, expiresAt: string): void {
  const db = getDb();
  db.run(
    "INSERT INTO sessions (token_hash, user_email, expires_at) VALUES ($hash, $email, $expires)",
    { $hash: hashToken(token), $email: email, $expires: expiresAt },
  );
}

export function getSessionRow(token: string): SessionRow | null {
  const db = getDb();
  return db
    .query(
      `SELECT s.user_email, s.expires_at, s.created_at, u.name, u.role
       FROM sessions s JOIN users u ON u.email = s.user_email
       WHERE s.token_hash = $hash`,
    )
    .get({ $hash: hashToken(token) }) as SessionRow | null;
}

/** Slides a live session's idle deadline forward. */
export function touchSessionRow(token: string, expiresAt: string): void {
  const db = getDb();
  db.run("UPDATE sessions SET expires_at = $expires WHERE token_hash = $hash", {
    $hash: hashToken(token),
    $expires: expiresAt,
  });
}

export function deleteSessionRow(token: string): void {
  const db = getDb();
  db.run("DELETE FROM sessions WHERE token_hash = $hash", { $hash: hashToken(token) });
}

export function deleteSessionsForUser(email: string): void {
  const db = getDb();
  db.run("DELETE FROM sessions WHERE user_email = $email", { $email: email });
}

export function purgeExpiredSessions(): void {
  const db = getDb();
  db.run("DELETE FROM sessions WHERE expires_at <= $now", { $now: new Date().toISOString() });
}

// --- invites ---

export type InviteRow = {
  /* No `token` field: the row stores only a hash, and nothing needs the value
     back — the link is emailed once at creation and never reconstructed. */
  user_email: string;
  expires_at: string;
  used_at: string | null;
  name: string;
  role: Role;
};

/**
 * Replaces any outstanding invite for the user, so a re-invite immediately
 * invalidates the previous link.
 */
export function createInvite(token: string, email: string, expiresAt: string): void {
  const db = getDb();
  db.transaction(() => {
    db.run("DELETE FROM invites WHERE user_email = $email", { $email: email });
    db.run(
      "INSERT INTO invites (token_hash, user_email, expires_at) VALUES ($hash, $email, $expires)",
      { $hash: hashToken(token), $email: email, $expires: expiresAt },
    );
  })();
}

export function getInvite(token: string): InviteRow | null {
  const db = getDb();
  return db
    .query(
      `SELECT i.user_email, i.expires_at, i.used_at, u.name, u.role
       FROM invites i JOIN users u ON u.email = i.user_email
       WHERE i.token_hash = $hash`,
    )
    .get({ $hash: hashToken(token) }) as InviteRow | null;
}

export function markInviteUsed(token: string): void {
  const db = getDb();
  db.run("UPDATE invites SET used_at = datetime('now') WHERE token_hash = $hash", { $hash: hashToken(token) });
}

/**
 * Claims an invite and sets the password in one transaction.
 *
 * Redemption used to be validate() -> setUserPassword() -> markInviteUsed() as
 * three separate statements, so two concurrent requests with the same token
 * could both pass validation and both set a password. The UPDATE below only
 * matches a token that is still unused, so exactly one caller can win.
 *
 * Returns false when the token was already claimed.
 */
export function redeemInvite(token: string, passwordHash: string): boolean {
  const db = getDb();
  let claimed = false;
  db.transaction(() => {
    db.run(
      "UPDATE invites SET used_at = datetime('now') WHERE token_hash = $hash AND used_at IS NULL",
      { $hash: hashToken(token) },
    );
    const row = db
      .query("SELECT changes() AS n")
      .get() as { n: number };
    if (row.n !== 1) return;
    const invite = db
      .query("SELECT user_email FROM invites WHERE token_hash = $hash")
      .get({ $hash: hashToken(token) }) as { user_email: string } | null;
    if (!invite) return;
    db.run("UPDATE users SET password_hash = $hash WHERE email = $email", {
      $hash: passwordHash,
      $email: invite.user_email,
    });
    claimed = true;
  })();
  return claimed;
}

// --- per-thread sharing ---

/**
 * A founder opting a single conversation in to coach visibility. Scoped by
 * user_email so one founder cannot share another's thread.
 */
export function setThreadShared(threadId: string, userEmail: string, shared: boolean): boolean {
  const db = getDb();
  /*
   * Unsharing clears the seen stamp.
   *
   * Taking it back and handing it over again is a fresh act, and the founder
   * should not be told the new share was already read because an older one
   * was. Sharing does not clear it explicitly — the column is only ever set
   * while a thread is shared, so it is already null by the time it matters.
   */
  db.run(
    shared
      ? "UPDATE threads SET shared_with_coach = 1 WHERE id = $id AND user_email = $email"
      : "UPDATE threads SET shared_with_coach = 0, shared_seen_at = NULL WHERE id = $id AND user_email = $email",
    { $id: threadId, $email: userEmail },
  );
  // Read the flag back rather than echoing the request. The scoping above
  // means a call naming somebody else's thread updates nothing, and returning
  // the requested value would have told the founder it worked.
  const row = db
    .query("SELECT shared_with_coach FROM threads WHERE id = $id AND user_email = $email")
    .get({ $id: threadId, $email: userEmail }) as { shared_with_coach: number } | null;
  return row?.shared_with_coach === 1;
}

/**
 * Every conversation the cohort has shared, newest first.
 *
 * The share toggle has worked since it shipped — it writes the flag, and
 * `getSharedThreads` reads it back correctly — but nothing ever called that
 * function from a screen, so founders were sharing into a void. This is the
 * read side the feature was missing.
 *
 * Scoped by the flag, not by the caller: a thread appears here only because a
 * founder chose to hand it over. Everything else stays unreadable to
 * organizers, which is the line the whole persistence layer is built around.
 */
/** The states the operating team can file a shared conversation under. */
export type SharedState = "active" | "archived" | "removed";

export function listSharedThreads(): (ThreadRow & {
  founderName: string;
  sharedState: SharedState;
  messages: { role: string; content: string }[];
})[] {
  const db = getDb();
  const threads = db
    .query(
      `SELECT t.*, u.name AS founder_name
         FROM threads t
         JOIN users u ON u.email = t.user_email
        WHERE t.shared_with_coach = 1
          AND COALESCE(t.shared_state, 'active') <> 'removed'
        ORDER BY t.updated_at DESC`,
    )
    .all() as (ThreadRow & { founder_name: string; shared_state: string | null })[];

  const getMsgs = db.prepare(
    "SELECT role, content FROM messages WHERE thread_id = $tid ORDER BY id ASC",
  );

  return threads.map((t) => ({
    ...t,
    founderName: t.founder_name,
    /* Rows written before the column existed have no value; they are active. */
    sharedState: (t.shared_state ?? "active") as SharedState,
    messages: getMsgs.all({ $tid: t.id }) as { role: string; content: string }[],
  }));
}

/**
 * Files a shared conversation on the team's side.
 *
 * Deliberately narrow. It writes one column on the thread and touches nothing
 * else: not the messages, not the founder's share flag, not updated_at. An
 * organizer tidying their own list must not be able to alter, hide or destroy
 * a founder's conversation, and "remove" here means "off our list", never "off
 * their account".
 *
 * Returns false for a thread nobody shared, so a stray id cannot file a
 * private conversation.
 */
export function setSharedThreadState(threadId: string, state: SharedState): boolean {
  const db = getDb();
  const row = db
    .query("SELECT shared_with_coach FROM threads WHERE id = $id")
    .get({ $id: threadId }) as { shared_with_coach: number } | null;
  if (!row || !row.shared_with_coach) return false;
  db.run("UPDATE threads SET shared_state = $state WHERE id = $id", { $id: threadId, $state: state });
  return true;
}

/**
 * Records that the team has read a shared conversation.
 *
 * First read only — the founder is told it landed, not watched. Re-reading it
 * does not move the timestamp, so the signal stays "someone saw this" rather
 * than becoming a log of how often it is opened.
 */
export function markSharedThreadSeen(threadId: string): boolean {
  const db = getDb();
  const row = db
    .query("SELECT shared_with_coach, shared_seen_at FROM threads WHERE id = $id")
    .get({ $id: threadId }) as { shared_with_coach: number; shared_seen_at: string | null } | null;
  // Never stamp a thread that was not shared: that would leak the fact it had
  // been read into a founder's private conversation.
  if (!row || row.shared_with_coach !== 1) return false;
  if (row.shared_seen_at) return true;
  db.run("UPDATE threads SET shared_seen_at = datetime('now') WHERE id = $id", { $id: threadId });
  return true;
}

/** The only raw-transcript view organizers get: threads founders chose to share. */
export function getSharedThreads(userEmail: string) {
  const db = getDb();
  const threads = db
    .query(
      "SELECT * FROM threads WHERE user_email = $email AND shared_with_coach = 1 ORDER BY updated_at DESC",
    )
    .all({ $email: userEmail }) as ThreadRow[];

  const getMsgs = db.prepare(
    "SELECT id, thread_id, role, content FROM messages WHERE thread_id = $tid ORDER BY id ASC",
  );

  return threads.map((t) => {
    const msgs = getMsgs.all({ $tid: t.id }) as MessageRow[];
    return { ...t, messages: msgs.map((m) => ({ role: m.role, content: m.content })) };
  });
}

// ---------------------------------------------------------------------------
// Cohort signals for the organizer dashboard
//
// Deliberately returns no free text. Organizers get themes, attention scores
// and timing — the material for deciding who to talk to — never what anyone
// actually wrote. See src/pages/api/persistence.ts for the same rule applied
// to individual records.
// ---------------------------------------------------------------------------

/**
 * Every dated theme signal for one founder: what they talked about and when.
 *
 * Feeds the "On your mind" arcs, which used to be three hardcoded names with
 * zero-filled bars, identical for every founder and never persisted.
 */
export function getThemeSignals(userEmail: string): { theme: string; created_at: string }[] {
  const db = getDb();
  return db
    .query(
      `SELECT theme, created_at FROM threads   WHERE user_email = $email AND theme IS NOT NULL
       UNION ALL
       SELECT theme, created_at FROM decisions WHERE user_email = $email AND theme IS NOT NULL
       UNION ALL
       SELECT theme, created_at FROM checkins  WHERE user_email = $email AND theme IS NOT NULL`,
    )
    .all({ $email: userEmail }) as { theme: string; created_at: string }[];
}

export type FounderRow = { email: string; name: string; created_at: string | null };

export function listFounders(): FounderRow[] {
  const db = getDb();
  return db
    .query("SELECT email, name, created_at FROM users WHERE role = 'founder' ORDER BY name ASC")
    .all() as FounderRow[];
}

export type CohortCheckinRow = {
  user_email: string;
  created_at: string;
  theme: string | null;
  mood: number | null;
};

/** Every founder check-in, oldest first. `mood` is the 0-100 attention score. */
export function getCohortCheckins(): CohortCheckinRow[] {
  const db = getDb();
  return db
    .query(
      `SELECT c.user_email, c.created_at, c.theme, c.mood
       FROM checkins c
       JOIN users u ON u.email = c.user_email
       WHERE u.role = 'founder'
       ORDER BY c.created_at ASC`,
    )
    .all() as CohortCheckinRow[];
}

/** Count of unresolved decisions per founder, keyed by email. */
export function getOpenDecisionCounts(): Record<string, number> {
  const db = getDb();
  const rows = db
    .query(
      `SELECT d.user_email AS email, COUNT(*) AS n
       FROM decisions d
       JOIN users u ON u.email = d.user_email
       WHERE u.role = 'founder' AND d.status = 'open'
       GROUP BY d.user_email`,
    )
    .all() as { email: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.email, r.n]));
}

// ---------------------------------------------------------------------------
// Deadlines and task tracking (Work Package 3)
//
// Every id here is generated in this module with crypto.randomUUID() and never
// accepted from a caller. That is the direct lesson of the cross-tenant write
// bug: when the client picks the primary key, "are you who you say you are" and
// "is this row yours" become different questions, and it is easy to check only
// the first. Server-generated ids remove the question entirely.
// ---------------------------------------------------------------------------

export type DeadlineRow = {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  /** HH:MM in Helsinki, or null for end of day. */
  due_time: string | null;
  sprint_week: number | null;
  status: "active" | "archived";
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type DeadlineInput = {
  title: string;
  description?: string | null;
  dueDate: string;
  dueTime?: string | null;
  sprintWeek?: number | null;
};

/** Creates a milestone. Returns the row, including its server-chosen id. */
export function createDeadline(input: DeadlineInput, createdBy: string): DeadlineRow {
  const db = getDb();
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO deadlines (id, title, description, due_date, due_time, sprint_week, created_by)
     VALUES ($id, $title, $description, $due_date, $due_time, $sprint_week, $created_by)`,
    {
      $id: id,
      $title: input.title,
      $description: input.description ?? null,
      $due_date: input.dueDate,
      $due_time: input.dueTime ?? null,
      $sprint_week: input.sprintWeek ?? null,
      $created_by: createdBy,
    },
  );
  return getDeadline(id)!;
}

export function getDeadline(id: string): DeadlineRow | null {
  const db = getDb();
  return db
    .query("SELECT * FROM deadlines WHERE id = $id")
    .get({ $id: id }) as DeadlineRow | null;
}

/** Active milestones only — what a founder should see. */
export function listActiveDeadlines(): DeadlineRow[] {
  const db = getDb();
  return db
    .query("SELECT * FROM deadlines WHERE status = 'active' ORDER BY due_date ASC, created_at ASC")
    .all() as DeadlineRow[];
}

/** Everything, including archived — the organizer view. */
export function listAllDeadlines(): DeadlineRow[] {
  const db = getDb();
  return db
    .query("SELECT * FROM deadlines ORDER BY due_date ASC, created_at ASC")
    .all() as DeadlineRow[];
}

export function updateDeadline(
  id: string,
  fields: Partial<DeadlineInput> & { status?: "active" | "archived" },
): boolean {
  const db = getDb();
  const existing = getDeadline(id);
  if (!existing) return false;
  db.run(
    `UPDATE deadlines SET
       title = $title,
       description = $description,
       due_date = $due_date,
       due_time = $due_time,
       sprint_week = $sprint_week,
       status = $status,
       updated_at = datetime('now')
     WHERE id = $id`,
    {
      $id: id,
      $title: fields.title ?? existing.title,
      $description: fields.description === undefined ? existing.description : fields.description,
      $due_date: fields.dueDate ?? existing.due_date,
      // undefined leaves it alone; null clears it back to end of day.
      $due_time: fields.dueTime === undefined ? existing.due_time : fields.dueTime,
      $sprint_week: fields.sprintWeek === undefined ? existing.sprint_week : fields.sprintWeek,
      $status: fields.status ?? existing.status,
    },
  );
  return true;
}

/** Archiving is preferred over deletion so completion history survives. */
export function deleteDeadline(id: string): void {
  const db = getDb();
  db.run("DELETE FROM deadlines WHERE id = $id", { $id: id });
}

/**
 * Marks a deadline done or not done for one founder.
 *
 * `userEmail` must come from the session. There is no code path that accepts it
 * from a request body, which is what makes this immune to the bug class that
 * affected threads, decisions and check-ins.
 */
export function setDeadlineDone(deadlineId: string, userEmail: string, done: boolean): boolean {
  const db = getDb();
  if (!getDeadline(deadlineId)) return false;
  if (done) {
    db.run(
      `INSERT INTO deadline_completions (deadline_id, user_email) VALUES ($id, $email)
       ON CONFLICT(deadline_id, user_email) DO NOTHING`,
      { $id: deadlineId, $email: userEmail },
    );
  } else {
    db.run(
      "DELETE FROM deadline_completions WHERE deadline_id = $id AND user_email = $email",
      { $id: deadlineId, $email: userEmail },
    );
  }
  return true;
}

/** The set of deadline ids this founder has ticked off. */
export function completedDeadlineIds(userEmail: string): string[] {
  const db = getDb();
  return (
    db
      .query("SELECT deadline_id FROM deadline_completions WHERE user_email = $email")
      .all({ $email: userEmail }) as { deadline_id: string }[]
  ).map((r) => r.deadline_id);
}

export type DeadlineStatusRow = {
  deadline_id: string;
  done_count: number;
};

/** How many founders have completed each deadline. */
export function deadlineCompletionCounts(): Record<string, number> {
  const db = getDb();
  const rows = db
    .query(
      `SELECT c.deadline_id AS deadline_id, COUNT(*) AS n
       FROM deadline_completions c
       JOIN users u ON u.email = c.user_email
       WHERE u.role = 'founder'
       GROUP BY c.deadline_id`,
    )
    .all() as { deadline_id: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.deadline_id, r.n]));
}

// --- The office library ------------------------------------------------------
//
// Books on the shelf, and the loans against them. Ids are server-generated
// throughout and a borrower is only ever the session's own email; there is no
// function here that takes an identity from anywhere else.

export type BookRow = {
  id: string;
  title: string;
  author: string | null;
  notes: string | null;
  status: "active" | "archived" | "unaccounted";
  added_by: string | null;
  created_at: string;
  updated_at: string;
};

export type BookInput = {
  title: string;
  author?: string | null;
  notes?: string | null;
};

export type LoanRow = {
  id: string;
  book_id: string;
  user_email: string;
  borrowed_at: string;
  due_date: string;
  returned_at: string | null;
};

/** A book with its open loan, if it has one, and the borrower's name. */
export type ShelfRow = BookRow & {
  loan_id: string | null;
  borrower_email: string | null;
  borrower_name: string | null;
  borrowed_at: string | null;
  due_date: string | null;
};

/** Adds a book to the shelf. Returns the row, including its server-chosen id. */
export function createBook(input: BookInput, addedBy: string): BookRow {
  const db = getDb();
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO books (id, title, author, notes, added_by)
     VALUES ($id, $title, $author, $notes, $added_by)`,
    {
      $id: id,
      $title: input.title,
      $author: input.author ?? null,
      $notes: input.notes ?? null,
      $added_by: addedBy,
    },
  );
  return getBook(id)!;
}

export function getBook(id: string): BookRow | null {
  const db = getDb();
  return db.query("SELECT * FROM books WHERE id = $id").get({ $id: id }) as BookRow | null;
}

export function countBooks(): number {
  const db = getDb();
  return (db.query("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n;
}

/**
 * The shelf, with whoever currently holds each book.
 *
 * One query rather than a lookup per book: the organizer view lists every book
 * and the founder view lists most of them, so the per-row version is a hundred
 * round trips to render one page.
 *
 * The join is to the *open* loan only (returned_at IS NULL), which the partial
 * unique index guarantees is at most one, so this cannot fan a book out into
 * several rows however long its history gets.
 */
export function listShelf(includeInactive = false): ShelfRow[] {
  const db = getDb();
  return db
    .query(
      `SELECT b.*,
              l.id AS loan_id,
              l.user_email AS borrower_email,
              u.name AS borrower_name,
              l.borrowed_at AS borrowed_at,
              l.due_date AS due_date
         FROM books b
         LEFT JOIN book_loans l
           ON l.book_id = b.id AND l.returned_at IS NULL
         LEFT JOIN users u ON u.email = l.user_email
        ${includeInactive ? "" : "WHERE b.status != 'archived'"}
        ORDER BY b.title ASC, b.created_at ASC`,
    )
    .all() as ShelfRow[];
}

export function updateBook(
  id: string,
  fields: Partial<BookInput> & { status?: BookRow["status"] },
): boolean {
  const db = getDb();
  const existing = getBook(id);
  if (!existing) return false;
  db.run(
    `UPDATE books SET
       title = $title,
       author = $author,
       notes = $notes,
       status = $status,
       updated_at = datetime('now')
     WHERE id = $id`,
    {
      $id: id,
      $title: fields.title ?? existing.title,
      // undefined leaves it alone; null clears it.
      $author: fields.author === undefined ? existing.author : fields.author,
      $notes: fields.notes === undefined ? existing.notes : fields.notes,
      $status: fields.status ?? existing.status,
    },
  );
  return true;
}

export function deleteBook(id: string): void {
  const db = getDb();
  db.run("DELETE FROM books WHERE id = $id", { $id: id });
}

/** The open loan on a book, if there is one. */
export function openLoanForBook(bookId: string): LoanRow | null {
  const db = getDb();
  return db
    .query("SELECT * FROM book_loans WHERE book_id = $id AND returned_at IS NULL")
    .get({ $id: bookId }) as LoanRow | null;
}

export function getLoan(id: string): LoanRow | null {
  const db = getDb();
  return db.query("SELECT * FROM book_loans WHERE id = $id").get({ $id: id }) as LoanRow | null;
}

/**
 * Takes a book off the shelf for one person.
 *
 * `userEmail` must come from the session. There is no code path that accepts a
 * borrower from a request body, which is what makes this immune to the bug
 * class that affected threads, decisions and check-ins.
 *
 * Throws if the book is already out. The caller is expected to let the unique
 * index be the arbiter rather than checking first: two founders tapping Borrow
 * at the same moment both pass a read-then-write check, and only one of them
 * can pass this.
 */
export function borrowBook(bookId: string, userEmail: string, dueDate: string): LoanRow {
  const db = getDb();
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO book_loans (id, book_id, user_email, due_date)
     VALUES ($id, $book_id, $user_email, $due_date)`,
    { $id: id, $book_id: bookId, $user_email: userEmail, $due_date: dueDate },
  );
  return getLoan(id)!;
}

/**
 * Puts a book back. Returns false when there was nothing out to return.
 *
 * Read then write, because the bun:sqlite shim types `run` as void and there
 * is no changes() to consult. The UPDATE keeps its own `returned_at IS NULL`
 * guard regardless, so two simultaneous returns cannot stamp two different
 * times onto one loan: the second matches nothing.
 */
export function returnLoan(loanId: string): boolean {
  const db = getDb();
  const open = getLoan(loanId);
  if (!open || open.returned_at !== null) return false;
  db.run(
    "UPDATE book_loans SET returned_at = datetime('now') WHERE id = $id AND returned_at IS NULL",
    { $id: loanId },
  );
  return true;
}

/** Moves an open loan's due date. This is also how a renewal is expressed. */
export function setLoanDue(loanId: string, dueDate: string): boolean {
  const db = getDb();
  const open = getLoan(loanId);
  if (!open || open.returned_at !== null) return false;
  db.run(
    "UPDATE book_loans SET due_date = $due WHERE id = $id AND returned_at IS NULL",
    { $id: loanId, $due: dueDate },
  );
  return true;
}

/** Every loan against a book, newest first. The organizer's history view. */
export function loanHistory(bookId: string): (LoanRow & { name: string | null })[] {
  const db = getDb();
  return db
    .query(
      `SELECT l.*, u.name AS name
         FROM book_loans l
         LEFT JOIN users u ON u.email = l.user_email
        WHERE l.book_id = $id
        ORDER BY l.borrowed_at DESC`,
    )
    .all({ $id: bookId }) as (LoanRow & { name: string | null })[];
}

/** One person's loans, newest first. Used by the founder view and the export. */
export function loansForUser(userEmail: string): (LoanRow & { title: string })[] {
  const db = getDb();
  return db
    .query(
      `SELECT l.*, b.title AS title
         FROM book_loans l
         JOIN books b ON b.id = l.book_id
        WHERE l.user_email = $email
        ORDER BY l.borrowed_at DESC`,
    )
    .all({ $email: userEmail }) as (LoanRow & { title: string })[];
}

export type BookReminderKind = "due-3d" | "overdue";

export type PendingBookReminder = {
  loan_id: string;
  book_id: string;
  title: string;
  due_date: string;
  email: string;
  name: string;
};

/**
 * Loans due on a given date that still owe a nudge of this kind.
 *
 * The NOT EXISTS against book_reminders is what makes this idempotent: the
 * scheduler can run every hour, or twice after a deploy, without anybody being
 * told the same thing twice. Returned loans and books that are not on the
 * active shelf are excluded, so putting a book back silences the rest of its
 * reminders without anything having to remember to cancel them.
 */
export function pendingBookReminders(
  kind: BookReminderKind,
  dueDate: string,
): PendingBookReminder[] {
  const db = getDb();
  return db
    .query(
      `SELECT l.id AS loan_id, b.id AS book_id, b.title, l.due_date, u.email, u.name
         FROM book_loans l
         JOIN books b ON b.id = l.book_id
         JOIN users u ON u.email = l.user_email
        WHERE l.returned_at IS NULL
          AND l.due_date = $due
          AND b.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM book_reminders r
             WHERE r.loan_id = l.id AND r.kind = $kind
          )
        ORDER BY u.name ASC`,
    )
    .all({ $due: dueDate, $kind: kind }) as PendingBookReminder[];
}

/** Records that a nudge went out, so it never goes out again. */
export function recordBookReminder(loanId: string, kind: BookReminderKind): void {
  const db = getDb();
  db.run(
    "INSERT OR IGNORE INTO book_reminders (loan_id, kind) VALUES ($id, $kind)",
    { $id: loanId, $kind: kind },
  );
}

/** The loans in a founder's data export. */
export function getBookLoans(
  userEmail: string,
): { book: string; borrowedAt: string; dueDate: string; returnedAt: string | null }[] {
  const db = getDb();
  return db
    .query(
      `SELECT b.title AS book, l.borrowed_at AS borrowedAt,
              l.due_date AS dueDate, l.returned_at AS returnedAt
         FROM book_loans l
         JOIN books b ON b.id = l.book_id
        WHERE l.user_email = $email
        ORDER BY l.borrowed_at DESC`,
    )
    .all({ $email: userEmail }) as {
      book: string; borrowedAt: string; dueDate: string; returnedAt: string | null;
    }[];
}

/**
 * Who has not completed a given deadline.
 *
 * Task status only. This deliberately never joins to threads, decisions or
 * check-ins — the organizer's view of task completion is a different boundary
 * from the conversation-privacy boundary, and mixing them is how the second
 * one gets eroded.
 */
export type KnowledgeRow = {
  id: string;
  persona: string;
  topic: string;
  body: string;
  position: number;
  status: string;
  source: string;
};

export function listKnowledge(persona: string, includeArchived = false): KnowledgeRow[] {
  const db = getDb();
  const sql = includeArchived
    ? `SELECT id, persona, topic, body, position, status, source FROM knowledge_entries
       WHERE persona = $persona ORDER BY position ASC, topic ASC`
    : `SELECT id, persona, topic, body, position, status, source FROM knowledge_entries
       WHERE persona = $persona AND status = 'active' ORDER BY position ASC, topic ASC`;
  return db.query(sql).all({ $persona: persona }) as KnowledgeRow[];
}

export function upsertKnowledge(entry: {
  id?: string;
  persona: string;
  topic: string;
  body: string;
  position: number;
  source: string;
}): string {
  const db = getDb();
  // Server-generated, like every other id here. A caller never names a row.
  const id = entry.id ?? crypto.randomUUID();
  db.run(
    `INSERT INTO knowledge_entries (id, persona, topic, body, position, source, updated_at)
     VALUES ($id, $persona, $topic, $body, $position, $source, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       topic = $topic, body = $body, position = $position,
       source = $source, updated_at = datetime('now')`,
    {
      $id: id,
      $persona: entry.persona,
      $topic: entry.topic,
      $body: entry.body,
      $position: entry.position,
      $source: entry.source,
    },
  );
  return id;
}

/**
 * Archives every active entry from one source in a single statement.
 *
 * A transcript import adds dozens of rows at once, so undoing one must not mean
 * dozens of clicks. Archives rather than deletes: the entries stay visible in
 * the admin table and can be restored, which is the difference between changing
 * your mind and losing the work.
 */
export function archiveKnowledgeBySource(persona: string, source: string): number {
  const db = getDb();
  const before = db
    .query("SELECT COUNT(*) AS n FROM knowledge_entries WHERE persona = $persona AND source = $source AND status = 'active'")
    .get({ $persona: persona, $source: source }) as { n: number };
  if (before.n === 0) return 0;
  db.run(
    `UPDATE knowledge_entries SET status = 'archived', updated_at = datetime('now')
     WHERE persona = $persona AND source = $source AND status = 'active'`,
    { $persona: persona, $source: source },
  );
  return before.n;
}

/**
 * Removes an entry outright.
 *
 * Archiving exists because most "get rid of this" moments are reversible ones,
 * and it stays the default the UI offers. This is for the other kind: an entry
 * that should not be in the database at all — something a mentor asked to have
 * taken out, or material that turned out to be a participant's.
 *
 * A real DELETE rather than a status, because "archived" still keeps the text
 * on disk and in every backup, which is exactly what a removal request is
 * about. Returns false if the row was already gone, so a double-click reports
 * honestly rather than claiming a second deletion.
 */
export function deleteKnowledge(id: string): boolean {
  const db = getDb();
  const existing = db
    .query("SELECT id FROM knowledge_entries WHERE id = $id")
    .get({ $id: id }) as { id: string } | null;
  if (!existing) return false;
  // db.run() returns void here, so existence is established before the write
  // rather than inferred from a changes count that this driver does not give.
  db.run("DELETE FROM knowledge_entries WHERE id = $id", { $id: id });
  return true;
}

export function setKnowledgeStatus(id: string, status: "active" | "archived"): boolean {
  const db = getDb();
  const existing = db
    .query("SELECT id FROM knowledge_entries WHERE id = $id")
    .get({ $id: id }) as { id: string } | null;
  if (!existing) return false;
  db.run("UPDATE knowledge_entries SET status = $status, updated_at = datetime('now') WHERE id = $id", {
    $id: id,
    $status: status,
  });
  return true;
}

export type ProgrammeWeekRow = {
  week: number;
  phase: string;
  title: string;
  milestones: string;
  sessions: string;
};

/** Everybody holding a role, for notifying an audience rather than a person. */
export function listUsersByRole(role: Role): { email: string; name: string }[] {
  const db = getDb();
  return db
    .query("SELECT email, name FROM users WHERE role = $role ORDER BY name ASC")
    .all({ $role: role }) as { email: string; name: string }[];
}

export type WishAudience = "organizers" | "mentors";

export type WishReply = {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export type WishRow = {
  id: string;
  fromEmail: string;
  fromName: string;
  audience: WishAudience;
  body: string;
  status: "open" | "answered";
  createdAt: string;
  replies: WishReply[];
};

function attachReplies(rows: Omit<WishRow, "replies">[]): WishRow[] {
  if (!rows.length) return [];
  const db = getDb();
  const byWish = new Map<string, WishReply[]>();
  /* One query for every reply in the set rather than one per wish: the
     organizer view lists the whole cohort's wishes at once. */
  const placeholders = rows.map((_, i) => `$id${i}`).join(", ");
  const params: Record<string, string> = {};
  rows.forEach((row, i) => { params[`$id${i}`] = row.id; });
  const replies = db
    .query(
      `SELECT id, wish_id AS wishId, author_name AS authorName, body, created_at AS createdAt
       FROM wish_replies WHERE wish_id IN (${placeholders}) ORDER BY created_at ASC`,
    )
    .all(params) as (WishReply & { wishId: string })[];
  for (const reply of replies) {
    const { wishId, ...rest } = reply;
    const list = byWish.get(wishId);
    if (list) list.push(rest);
    else byWish.set(wishId, [rest]);
  }
  return rows.map((row) => ({ ...row, replies: byWish.get(row.id) ?? [] }));
}

const WISH_COLUMNS = `
  w.id, w.from_email AS fromEmail, COALESCE(u.name, w.from_email) AS fromName,
  w.audience, w.body, w.status, w.created_at AS createdAt
`;

/** One founder's own wishes, whoever they were addressed to. */
export function listWishesFrom(email: string): WishRow[] {
  const db = getDb();
  const rows = db
    .query(
      `SELECT ${WISH_COLUMNS} FROM wishes w
       LEFT JOIN users u ON u.email = w.from_email
       WHERE w.from_email = $email ORDER BY w.created_at DESC`,
    )
    .all({ $email: email }) as Omit<WishRow, "replies">[];
  return attachReplies(rows);
}

/**
 * Everything addressed to one audience.
 *
 * Organizers also read the mentors' queue — they run the programme and a wish
 * for a mentor is still theirs to make happen — but mentors read only their
 * own, which is the whole point of picking who to address.
 */
export function listWishesFor(audiences: WishAudience[]): WishRow[] {
  if (!audiences.length) return [];
  const db = getDb();
  const placeholders = audiences.map((_, i) => `$a${i}`).join(", ");
  const params: Record<string, string> = {};
  audiences.forEach((a, i) => { params[`$a${i}`] = a; });
  const rows = db
    .query(
      `SELECT ${WISH_COLUMNS} FROM wishes w
       LEFT JOIN users u ON u.email = w.from_email
       WHERE w.audience IN (${placeholders})
       ORDER BY w.status = 'answered', w.created_at DESC`,
    )
    .all(params) as Omit<WishRow, "replies">[];
  return attachReplies(rows);
}

export function getWish(id: string): Omit<WishRow, "replies"> | null {
  const db = getDb();
  return db
    .query(
      `SELECT ${WISH_COLUMNS} FROM wishes w
       LEFT JOIN users u ON u.email = w.from_email WHERE w.id = $id`,
    )
    .get({ $id: id }) as Omit<WishRow, "replies"> | null;
}

export function createWish(id: string, fromEmail: string, audience: WishAudience, body: string): void {
  const db = getDb();
  db.run(
    "INSERT INTO wishes (id, from_email, audience, body) VALUES ($id, $from, $audience, $body)",
    { $id: id, $from: fromEmail, $audience: audience, $body: body.trim() },
  );
}

/**
 * How many wishes this founder has sent since a moment.
 *
 * Every wish emails a real person, so there is a cap. Without one a founder
 * with a stuck key sends Mårten forty emails and the feature is switched off by
 * whoever owns his inbox.
 */
export function countWishesSince(email: string, isoTimestamp: string): number {
  const db = getDb();
  const row = db
    .query("SELECT COUNT(*) AS n FROM wishes WHERE from_email = $email AND created_at >= $since")
    .get({ $email: email, $since: isoTimestamp }) as { n: number };
  return row.n;
}

export function addWishReply(
  id: string, wishId: string, authorEmail: string, authorName: string, body: string,
): void {
  const db = getDb();
  db.run(
    `INSERT INTO wish_replies (id, wish_id, author_email, author_name, body)
     VALUES ($id, $wish, $author, $name, $body)`,
    { $id: id, $wish: wishId, $author: authorEmail, $name: authorName, $body: body.trim() },
  );
  // Answering is what marks it answered; there is no separate button to forget.
  db.run("UPDATE wishes SET status = 'answered' WHERE id = $wish", { $wish: wishId });
}

export type ProgrammeEventRow = {
  id: string;
  title: string;
  kind: "session" | "milestone" | "checkpoint" | "social" | "trip";
  startsOn: string;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
};

const EVENT_COLUMNS = `
  id, title, kind,
  starts_on AS startsOn, start_time AS startTime, end_time AS endTime,
  location, description
`;

/**
 * Every dated thing in the programme, in the order it happens.
 *
 * Sorted by date then time, with untimed entries first within a day: an
 * all-day milestone is a property of the whole day, so it reads above the
 * sessions rather than being filed under midnight.
 */
export function listProgrammeEvents(): ProgrammeEventRow[] {
  const db = getDb();
  return db
    .query(
      `SELECT ${EVENT_COLUMNS} FROM programme_events
       WHERE status = 'active'
       ORDER BY starts_on ASC, start_time ASC, title ASC`,
    )
    .all() as ProgrammeEventRow[];
}

export function getProgrammeEvent(id: string): ProgrammeEventRow | null {
  const db = getDb();
  return db
    .query(`SELECT ${EVENT_COLUMNS} FROM programme_events WHERE id = $id AND status = 'active'`)
    .get({ $id: id }) as ProgrammeEventRow | null;
}

/**
 * Creates or replaces one event. The caller owns id generation and validation.
 *
 * createdBy is nullable because not every event has an author: a schedule
 * loaded by a script was not typed by anybody, and the column has a foreign key
 * to users, so inventing a name for it fails the constraint rather than
 * recording something useful.
 */
export function upsertProgrammeEvent(row: ProgrammeEventRow, createdBy: string | null): void {
  const db = getDb();
  db.run(
    `INSERT INTO programme_events
       (id, title, kind, starts_on, start_time, end_time, location, description, created_by, updated_at)
     VALUES ($id, $title, $kind, $startsOn, $startTime, $endTime, $location, $description, $createdBy, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       title = $title, kind = $kind, starts_on = $startsOn,
       start_time = $startTime, end_time = $endTime,
       location = $location, description = $description,
       updated_at = datetime('now')`,
    {
      $id: row.id,
      $title: row.title.trim(),
      $kind: row.kind,
      $startsOn: row.startsOn,
      $startTime: row.startTime,
      $endTime: row.endTime,
      $location: row.location.trim(),
      $description: row.description.trim(),
      $createdBy: createdBy,
    },
  );
}

/**
 * Archives rather than deletes, so a session removed by accident is
 * recoverable and the audit trail keeps pointing at something real.
 */
export function archiveProgrammeEvent(id: string): boolean {
  const db = getDb();
  // db.run() returns void in this driver, so existence is established before
  // the write rather than inferred from a changes count it does not give.
  if (!getProgrammeEvent(id)) return false;
  db.run(
    "UPDATE programme_events SET status = 'archived', updated_at = datetime('now') WHERE id = $id",
    { $id: id },
  );
  return true;
}

export function listProgrammeWeeks(): ProgrammeWeekRow[] {
  const db = getDb();
  return db
    .query("SELECT week, phase, title, milestones, sessions FROM programme_weeks ORDER BY week ASC")
    .all() as ProgrammeWeekRow[];
}

export function getProgrammeWeek(week: number): ProgrammeWeekRow | null {
  const db = getDb();
  return db
    .query("SELECT week, phase, title, milestones, sessions FROM programme_weeks WHERE week = $week")
    .get({ $week: week }) as ProgrammeWeekRow | null;
}

/** Writes a week. Blank everywhere means the week is cleared, not stored empty. */
export function upsertProgrammeWeek(row: ProgrammeWeekRow): void {
  const db = getDb();
  const empty = !row.phase.trim() && !row.title.trim() && !row.milestones.trim() && !row.sessions.trim();
  if (empty) {
    db.run("DELETE FROM programme_weeks WHERE week = $week", { $week: row.week });
    return;
  }
  db.run(
    `INSERT INTO programme_weeks (week, phase, title, milestones, sessions, updated_at)
     VALUES ($week, $phase, $title, $milestones, $sessions, datetime('now'))
     ON CONFLICT(week) DO UPDATE SET
       phase = $phase, title = $title, milestones = $milestones,
       sessions = $sessions, updated_at = datetime('now')`,
    {
      $week: row.week,
      $phase: row.phase.trim(),
      $title: row.title.trim(),
      $milestones: row.milestones.trim(),
      $sessions: row.sessions.trim(),
    },
  );
}

/**
 * Clears one week.
 *
 * upsertProgrammeWeek above already deletes when every field comes in blank,
 * and that stays — but it is not something anybody can find. It was the only
 * way to remove a week, so the admin page had no Remove button on any of the
 * fifteen rows and clearing one meant emptying five fields and pressing Save
 * without being told that would do it. Saying it plainly costs one statement.
 */
export function deleteProgrammeWeek(week: number): void {
  getDb().run("DELETE FROM programme_weeks WHERE week = $week", { $week: week });
}

/**
 * The moments a founder can be nudged about one deadline.
 *
 * 'due-soon' is retired and nothing writes it any more. It stays in the type
 * because rows from the single-nudge cadence are still in the table, and they
 * are the record that somebody was already told.
 */
export type ReminderKind = "due-soon" | "due-3d" | "due-2d" | "due-10h" | "overdue";

export type PendingReminder = {
  deadline_id: string;
  title: string;
  description: string | null;
  due_date: string;
  /** HH:MM in Helsinki, or null for end of day. */
  due_time: string | null;
  email: string;
  name: string;
};

/**
 * Founders who still owe an active deadline and have not been told about it in
 * this way yet.
 *
 * The NOT EXISTS against deadline_reminders is what makes this idempotent: the
 * scheduler can run twice in a day, or a deploy can restart it, without anybody
 * receiving the same reminder twice. Archived deadlines are excluded, because
 * an archived milestone is one the team decided to stop chasing.
 */
export function pendingReminders(kind: ReminderKind, dueDate: string): PendingReminder[] {
  const db = getDb();
  return db
    .query(
      `SELECT d.id AS deadline_id, d.title, d.description, d.due_date, d.due_time, u.email, u.name
       FROM deadlines d
       CROSS JOIN users u
       WHERE d.status = 'active'
         AND d.due_date = $due
         AND u.role = 'founder'
         AND NOT EXISTS (
           SELECT 1 FROM deadline_completions c
           WHERE c.deadline_id = d.id AND c.user_email = u.email
         )
         AND NOT EXISTS (
           SELECT 1 FROM deadline_reminders r
           WHERE r.deadline_id = d.id AND r.user_email = u.email AND r.kind = $kind
         )
       ORDER BY u.name ASC, d.due_date ASC`,
    )
    .all({ $due: dueDate, $kind: kind }) as PendingReminder[];
}

/** Records that a reminder went out, so it never goes out again. */
export function recordReminder(deadlineId: string, userEmail: string, kind: ReminderKind): void {
  const db = getDb();
  db.run(
    `INSERT OR IGNORE INTO deadline_reminders (deadline_id, user_email, kind)
     VALUES ($id, $email, $kind)`,
    { $id: deadlineId, $email: userEmail, $kind: kind },
  );
}

export function foundersBehindOn(deadlineId: string): { email: string; name: string }[] {
  const db = getDb();
  return db
    .query(
      `SELECT u.email, u.name
       FROM users u
       WHERE u.role = 'founder'
         AND u.email NOT IN (
           SELECT user_email FROM deadline_completions WHERE deadline_id = $id
         )
       ORDER BY u.name ASC`,
    )
    .all({ $id: deadlineId }) as { email: string; name: string }[];
}

// ---- Broadcasts -----------------------------------------------------------

export type BroadcastRecipient = { email: string; name: string; role: Role };

/**
 * Resolves an audience to the actual people it means.
 *
 * Roles and individually picked addresses are a union, not a filter: ticking
 * "founders" and also picking one organizer by name reaches both. The query
 * deduplicates, so a person who is in the role *and* picked individually is
 * mailed once, which is the bug you would otherwise only discover by sending
 * someone two copies of the same announcement.
 *
 * Ordering is stable so that the count shown in the confirmation box and the
 * list actually mailed can never drift apart.
 */
export function listBroadcastRecipients(
  roles: Role[],
  emails: string[],
): BroadcastRecipient[] {
  const db = getDb();
  const cleanRoles = roles.filter((r) => r === "founder" || r === "organizer");
  const cleanEmails = emails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!cleanRoles.length && !cleanEmails.length) return [];

  // Bound parameters, one per value: an IN list cannot be parameterised as a
  // whole, and interpolating addresses into SQL is how you get an injection.
  const roleParams: Record<string, string> = {};
  const rolePlaceholders = cleanRoles.map((role, i) => {
    roleParams[`$role${i}`] = role;
    return `$role${i}`;
  });
  const emailParams: Record<string, string> = {};
  const emailPlaceholders = cleanEmails.map((email, i) => {
    emailParams[`$email${i}`] = email;
    return `$email${i}`;
  });

  const clauses: string[] = [];
  if (rolePlaceholders.length) clauses.push(`role IN (${rolePlaceholders.join(", ")})`);
  if (emailPlaceholders.length) clauses.push(`email IN (${emailPlaceholders.join(", ")})`);

  return db
    .query(
      `SELECT email, name, role FROM users
       WHERE ${clauses.join(" OR ")}
       ORDER BY role DESC, name ASC`,
    )
    .all({ ...roleParams, ...emailParams }) as BroadcastRecipient[];
}

/** Opens a broadcast record before the first send, so a crash mid-run still leaves a trace. */
export function createBroadcast(
  id: string,
  actorEmail: string,
  subject: string,
  body: string,
  audience: string,
  contentHash: string,
): void {
  const db = getDb();
  db.run(
    `INSERT INTO broadcasts (id, actor_email, subject, body, audience, content_hash)
     VALUES ($id, $actor, $subject, $body, $audience, $hash)`,
    {
      $id: id,
      $actor: actorEmail,
      $subject: subject,
      $body: body,
      $audience: audience,
      $hash: contentHash,
    },
  );
}

export function recordBroadcastDelivery(
  broadcastId: string,
  email: string,
  status: "sent" | "failed",
  detail: string | null = null,
): void {
  const db = getDb();
  db.run(
    `INSERT OR REPLACE INTO broadcast_recipients (broadcast_id, email, status, detail)
     VALUES ($id, $email, $status, $detail)`,
    { $id: broadcastId, $email: email, $status: status, $detail: detail },
  );
}

export function finishBroadcast(id: string, sent: number, failed: number): void {
  const db = getDb();
  db.run("UPDATE broadcasts SET sent = $sent, failed = $failed WHERE id = $id", {
    $id: id,
    $sent: sent,
    $failed: failed,
  });
}

/**
 * True when this organizer has already test-sent this exact wording to
 * themselves. The send endpoint refuses without it.
 *
 * Matching on a hash of the subject and body means editing a single character
 * after the test invalidates it. That is the point: the gate exists so that
 * what the cohort receives is what somebody actually read in their own inbox.
 */
export function hasTestedBroadcast(actorEmail: string, contentHash: string): boolean {
  const db = getDb();
  const row = db
    .query(
      `SELECT 1 AS ok FROM broadcasts
       WHERE actor_email = $actor AND content_hash = $hash AND audience = 'test'
       LIMIT 1`,
    )
    .get({ $actor: actorEmail, $hash: contentHash }) as { ok: number } | null;
  return Boolean(row);
}

export type BroadcastSummary = {
  id: string;
  actor_email: string;
  subject: string;
  audience: string;
  sent: number;
  failed: number;
  created_at: string;
};

/** Real blasts only. Test sends are bookkeeping for the gate, not history. */
export function listBroadcasts(limit = 20): BroadcastSummary[] {
  const db = getDb();
  return db
    .query(
      `SELECT id, actor_email, subject, audience, sent, failed, created_at
       FROM broadcasts
       WHERE audience <> 'test'
       ORDER BY created_at DESC
       LIMIT $limit`,
    )
    .all({ $limit: limit }) as BroadcastSummary[];
}

/** Who a given blast actually reached, and who it did not. */
export function listBroadcastDeliveries(
  broadcastId: string,
): { email: string; status: string; detail: string | null }[] {
  const db = getDb();
  return db
    .query(
      `SELECT email, status, detail FROM broadcast_recipients
       WHERE broadcast_id = $id
       ORDER BY status ASC, email ASC`,
    )
    .all({ $id: broadcastId }) as { email: string; status: string; detail: string | null }[];
}

// ---- Working-style history ------------------------------------------------

export type WorkingGeniusTake = {
  id: string;
  taken_on: string;
  primary_type: string;
  result_json: string;
  instrument_version: string;
  consistency: number | null;
};

/**
 * Records one take, in addition to the latest-snapshot row.
 *
 * Ignores a repeat on the same day rather than stacking two rows for one
 * sitting: a founder who submits, sees the result and immediately resubmits has
 * taken it once. The retake schedule makes that rare, and the guard is cheaper
 * than reasoning about it later.
 */
export function recordWorkingGeniusTake(
  userEmail: string,
  take: Omit<WorkingGeniusTake, "id">,
): void {
  const db = getDb();
  const existing = db
    .query("SELECT id FROM working_genius_takes WHERE user_email = $email AND taken_on = $on")
    .get({ $email: userEmail, $on: take.taken_on }) as { id: string } | null;

  if (existing) {
    db.run(
      `UPDATE working_genius_takes
         SET primary_type = $primary, result_json = $result,
             instrument_version = $version, consistency = $consistency
       WHERE id = $id`,
      {
        $id: existing.id,
        $primary: take.primary_type,
        $result: take.result_json,
        $version: take.instrument_version,
        $consistency: take.consistency,
      },
    );
    return;
  }

  db.run(
    `INSERT INTO working_genius_takes
       (id, user_email, taken_on, primary_type, result_json, instrument_version, consistency)
     VALUES ($id, $email, $on, $primary, $result, $version, $consistency)`,
    {
      $id: crypto.randomUUID(),
      $email: userEmail,
      $on: take.taken_on,
      $primary: take.primary_type,
      $result: take.result_json,
      $version: take.instrument_version,
      $consistency: take.consistency,
    },
  );
}

/** Oldest first, so a comparison reads left to right as time. */
export function listWorkingGeniusTakes(userEmail: string): WorkingGeniusTake[] {
  const db = getDb();
  return db
    .query(
      `SELECT id, taken_on, primary_type, result_json, instrument_version, consistency
       FROM working_genius_takes WHERE user_email = $email
       ORDER BY taken_on ASC`,
    )
    .all({ $email: userEmail }) as WorkingGeniusTake[];
}

/**
 * One founder's deadline completions, titled so an export reads as something
 * rather than as a list of ids.
 */
export function getDeadlineCompletions(
  userEmail: string,
): { deadline: string; dueDate: string; completedAt: string }[] {
  const db = getDb();
  return db
    .query(
      `SELECT d.title AS deadline, d.due_date AS dueDate, c.completed_at AS completedAt
       FROM deadline_completions c
       JOIN deadlines d ON d.id = c.deadline_id
       WHERE c.user_email = $email
       ORDER BY c.completed_at ASC`,
    )
    .all({ $email: userEmail }) as { deadline: string; dueDate: string; completedAt: string }[];
}
