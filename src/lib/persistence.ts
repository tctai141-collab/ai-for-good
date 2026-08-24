export type Msg = { role: "user" | "assistant"; content: string };

export type Thread = {
  id: string;
  title: string;
  theme: string;
  state: "panic" | "thinking" | "venting";
  lastAt: string;
  messages: Msg[];
  /** Founder has opted this one conversation in to coach visibility. */
  sharedWithCoach?: boolean;
  /** When the operating team first opened it. Null until somebody has. */
  sharedSeenAt?: string | null;
};

export type Decision = {
  id: string;
  summary: string;
  door: "reversible" | "one-way";
  status: "open" | "closed";
  at: string;
  theme: string;
  threadId?: string;
  outcome?: string;
};

export type Checkin = {
  id: string;
  refDecisionId: string | null;
  theme?: string;
  prompt: string;
  suggestions?: string[];
  questions?: Array<{ text: string; suggestions?: string[] }>;
  mood?: number;
  /** UTC, as SQLite wrote it. The client converts to Helsinki to ask "today?". */
  createdAt?: string;
};

export type ThemeArc = { name: string; arc: number[] };

import type { WorkingGeniusResult } from "./workingGenius";
export type { WorkingGeniusResult };

export type UserData = {
  threads: Thread[];
  decisions: Decision[];
  checkins: Checkin[];
  /** Derived server-side from real signals; empty until the founder has some. */
  themes: ThemeArc[];
  /** Which sprint week we are in, so in-session updates land in the right bar. */
  week: number;
  visits: number;
  workingGenius?: WorkingGenius;
  /** Every take, oldest first. One entry until the first retake window opens. */
  workingGeniusTakes?: WorkingGeniusTake[];
};

export type WorkingGeniusTake = {
  takenOn: string;
  result: WorkingGeniusResult;
};

export type WorkingGenius = {
  primary: string;
  counts: Record<string, number>;
  completedAt: string;
  /**
   * Full scoring: ranking, the three bands, per-item answers, consistency.
   * Absent on rows written by the six-item quiz this replaced, which knew only
   * a primary type. The UI treats that absence as "retake it" rather than
   * inventing bands it cannot derive.
   */
  result?: WorkingGeniusResult;
};

/**
 * A failed write, with the server's own words kept.
 *
 * The status alone was all that survived, which turned every refusal into
 * "Could not save that" no matter what the server said. Some refusals are
 * permanent and explain themselves: a working-style retake submitted before
 * its window answers 409 and names the date it opens. Throwing that away left
 * a founder who had just answered thirty questions staring at a Try again that
 * could never work.
 */
export class PersistenceError extends Error {
  constructor(readonly status: number, readonly serverMessage: string | null) {
    super(serverMessage ?? `Persistence error ${status}`);
    this.name = "PersistenceError";
  }
}

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/persistence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Best effort: an error body is not guaranteed, and a parse failure here
    // must not replace the real status with a JSON error.
    const detail = await res
      .json()
      .then((d) => (typeof (d as { error?: unknown }).error === "string" ? (d as { error: string }).error : null))
      .catch(() => null);
    throw new PersistenceError(res.status, detail);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

async function get(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/persistence?${qs}`);
  if (!res.ok) throw new Error(`Persistence fetch error ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

export async function loadUserData(userEmail: string): Promise<UserData> {
  const [tData, dData, cData, vData, wgData, thData] = await Promise.all([
    get({ resource: "threads", user: userEmail }),
    get({ resource: "decisions", user: userEmail }),
    get({ resource: "checkins", user: userEmail }),
    get({ resource: "visits", user: userEmail }),
    get({ resource: "working-genius", user: userEmail }),
    get({ resource: "themes", user: userEmail }),
  ]);

  const rawThreads = (tData.threads || []) as Array<{
    id: string; title: string; theme: string; state: string;
    last_at: string; personality: string; messages: Msg[];
    shared_with_coach?: number;
    shared_seen_at?: string | null;
  }>;

  const rawDecisions = (dData.decisions || []) as Array<{
    id: string; summary: string; door: string; status: string;
    theme: string; outcome: string | null; at: string; thread_id: string | null;
  }>;

  const rawCheckins = (cData.checkins || []) as Array<{
    id: string; ref_decision_id: string | null; theme: string | null;
    prompt: string; mood: number | null; created_at?: string;
  }>;

  return {
    threads: rawThreads.map((t) => ({
      id: t.id,
      title: t.title,
      theme: t.theme,
      // SQLite has no CHECK on threads.state, so narrow at the boundary
      // rather than asserting. Anything unexpected reads as "thinking".
      state: (["panic", "thinking", "venting"] as const).includes(t.state as never)
        ? (t.state as Thread["state"])
        : "thinking",
      lastAt: t.last_at,
      messages: t.messages || [],
      sharedWithCoach: Boolean(t.shared_with_coach),
      sharedSeenAt: t.shared_seen_at ?? null,
    })),
    decisions: rawDecisions.map((d) => ({
      id: d.id,
      summary: d.summary,
      door: d.door as "reversible" | "one-way",
      status: d.status as "open" | "closed",
      theme: d.theme,
      outcome: d.outcome || undefined,
      at: d.at,
      threadId: d.thread_id || undefined,
    })),
    checkins: rawCheckins.map((c) => ({
      id: c.id,
      refDecisionId: c.ref_decision_id,
      theme: c.theme || undefined,
      prompt: c.prompt,
      mood: c.mood || undefined,
      createdAt: c.created_at,
    })),
    themes: (thData.themes as ThemeArc[]) || [],
    week: (thData.week as number) || 1,
    visits: (vData.visits as number) || 0,
    workingGeniusTakes: ((wgData.takes as Array<{ taken_on: string; result_json: string }> | undefined) ?? [])
      .flatMap((t) => {
        try {
          return [{ takenOn: t.taken_on, result: JSON.parse(t.result_json) as WorkingGeniusResult }];
        } catch {
          // A row this client cannot parse is not worth failing the whole page
          // over; the comparison simply has one fewer point.
          return [];
        }
      }),
    workingGenius: wgData.workingGenius
      ? (() => {
        const row = wgData.workingGenius as {
          primary_type: string;
          counts_json: string;
          completed_at: string;
          result_json?: string | null;
        };
        return {
          primary: row.primary_type,
          counts: JSON.parse(row.counts_json),
          completedAt: row.completed_at,
          result: row.result_json
            ? (JSON.parse(row.result_json) as WorkingGeniusResult)
            : undefined,
        };
      })()
      : undefined,
  };
}

/** Identity comes from the session cookie; the client no longer asserts it. */
export async function initUser() {
  await post({ action: "init-user" });
}

/** Opt a single conversation in to — or back out of — coach visibility. */
export async function setThreadShared(userEmail: string, threadId: string, shared: boolean) {
  await post({ action: "set-thread-shared", userEmail, threadId, shared });
}

/** Removes a conversation for good. The server scopes this to the caller. */
export async function deleteThread(userEmail: string, threadId: string) {
  await post({ action: "delete-thread", userEmail, threadId });
}

export async function saveThread(userEmail: string, thread: Thread) {
  await post({
    action: "save-thread",
    userEmail,
    thread: {
      id: thread.id,
      title: thread.title,
      theme: thread.theme,
      state: thread.state,
      lastAt: thread.lastAt,
      // Retired: the column outlives the picker so old threads still load.
      personality: "none",
      messages: thread.messages,
    },
  });
}

export async function saveDecision(userEmail: string, decision: Decision) {
  await post({
    action: "save-decision",
    userEmail,
    decision: {
      id: decision.id,
      summary: decision.summary,
      door: decision.door,
      theme: decision.theme,
      status: decision.status,
      outcome: decision.outcome,
      threadId: decision.threadId,
      at: decision.at,
    },
  });
}

export async function saveCheckin(userEmail: string, checkin: Checkin) {
  await post({
    action: "save-checkin",
    userEmail,
    checkin: {
      id: checkin.id,
      theme: checkin.theme,
      prompt: checkin.prompt,
      mood: checkin.mood,
      refDecisionId: checkin.refDecisionId,
    },
  });
}

export async function removeCheckin(userEmail: string, checkinId: string) {
  await post({ action: "delete-checkin", userEmail, checkinId });
}

export async function bumpVisits(userEmail: string): Promise<number> {
  const data = await post({ action: "increment-visits", userEmail });
  return (data.count as number) || 0;
}

/**
 * Sends the raw per-item answers, not a finished profile. The server owns the
 * scoring so that one item bank and one ranking implementation produce every
 * stored result, and returns what it computed.
 */
export async function saveWorkingGenius(
  userEmail: string,
  /* Either shape: a bare type id is what afs-1 sent and is still accepted, an
     object carries the click plus whatever the founder typed. */
  workingGeniusResponses: Record<string, string | { choice: string; text?: string }>,
): Promise<WorkingGeniusResult> {
  const data = await post({ action: "save-working-genius", userEmail, workingGeniusResponses });
  return data.result as WorkingGeniusResult;
}
