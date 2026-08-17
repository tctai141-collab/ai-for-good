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
    return { ...t, messages: msgs.map((m) => ({ role: m.role, content: m.content })) };
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
    .query("SELECT user_email, primary_type, counts_json, completed_at FROM working_genius WHERE user_email = $email")
    .get({ $email: userEmail }) as WorkingGeniusRow | null;
  return row;
}

export function upsertWorkingGenius(row: WorkingGeniusRow) {
  const db = getDb();
  db.run(
    `INSERT INTO working_genius (user_email, primary_type, counts_json, completed_at, updated_at)
     VALUES ($user_email, $primary_type, $counts_json, $completed_at, datetime('now'))
     ON CONFLICT(user_email) DO UPDATE SET
       primary_type = $primary_type,
       counts_json = $counts_json,
       completed_at = $completed_at,
       updated_at = datetime('now')`,
    {
      $user_email: row.user_email,
      $primary_type: row.primary_type,
      $counts_json: row.counts_json,
      $completed_at: row.completed_at,
    },
  );
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

export function ensureUser(email: string, name: string, role: "founder" | "organizer") {
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

export type Role = "founder" | "organizer";

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

/** Cascades to that user's sessions and invites via foreign keys. */
export function deleteUser(email: string): void {
  const db = getDb();
  db.run("DELETE FROM users WHERE email = $email", { $email: email });
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
  expires_at: string;
  name: string;
  role: Role;
};

export function createSessionRow(token: string, email: string, expiresAt: string): void {
  const db = getDb();
  db.run(
    "INSERT INTO sessions (token, user_email, expires_at) VALUES ($token, $email, $expires)",
    { $token: token, $email: email, $expires: expiresAt },
  );
}

export function getSessionRow(token: string): SessionRow | null {
  const db = getDb();
  return db
    .query(
      `SELECT s.user_email, s.expires_at, u.name, u.role
       FROM sessions s JOIN users u ON u.email = s.user_email
       WHERE s.token = $token`,
    )
    .get({ $token: token }) as SessionRow | null;
}

export function deleteSessionRow(token: string): void {
  const db = getDb();
  db.run("DELETE FROM sessions WHERE token = $token", { $token: token });
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
  token: string;
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
      "INSERT INTO invites (token, user_email, expires_at) VALUES ($token, $email, $expires)",
      { $token: token, $email: email, $expires: expiresAt },
    );
  })();
}

export function getInvite(token: string): InviteRow | null {
  const db = getDb();
  return db
    .query(
      `SELECT i.token, i.user_email, i.expires_at, i.used_at, u.name, u.role
       FROM invites i JOIN users u ON u.email = i.user_email
       WHERE i.token = $token`,
    )
    .get({ $token: token }) as InviteRow | null;
}

export function markInviteUsed(token: string): void {
  const db = getDb();
  db.run("UPDATE invites SET used_at = datetime('now') WHERE token = $token", { $token: token });
}

// --- per-thread sharing ---

/**
 * A founder opting a single conversation in to coach visibility. Scoped by
 * user_email so one founder cannot share another's thread.
 */
export function setThreadShared(threadId: string, userEmail: string, shared: boolean): boolean {
  const db = getDb();
  db.run(
    "UPDATE threads SET shared_with_coach = $shared WHERE id = $id AND user_email = $email",
    { $shared: shared ? 1 : 0, $id: threadId, $email: userEmail },
  );
  // Read the flag back rather than echoing the request. The scoping above
  // means a call naming somebody else's thread updates nothing, and returning
  // the requested value would have told the founder it worked.
  const row = db
    .query("SELECT shared_with_coach FROM threads WHERE id = $id AND user_email = $email")
    .get({ $id: threadId, $email: userEmail }) as { shared_with_coach: number } | null;
  return row?.shared_with_coach === 1;
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
