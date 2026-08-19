export type Msg = { role: "user" | "assistant"; content: string };
export type Personality = "none" | "marten";

export type Thread = {
  id: string;
  title: string;
  theme: string;
  state: "panic" | "thinking" | "venting";
  lastAt: string;
  messages: Msg[];
  personality?: Personality;
  /** Founder has opted this one conversation in to coach visibility. */
  sharedWithCoach?: boolean;
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
};

export type ThemeArc = { name: string; arc: number[] };

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
};

export type WorkingGenius = {
  primary: string;
  counts: Record<string, number>;
  completedAt: string;
};

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/persistence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Persistence error ${res.status}`);
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
  }>;

  const rawDecisions = (dData.decisions || []) as Array<{
    id: string; summary: string; door: string; status: string;
    theme: string; outcome: string | null; at: string; thread_id: string | null;
  }>;

  const rawCheckins = (cData.checkins || []) as Array<{
    id: string; ref_decision_id: string | null; theme: string | null;
    prompt: string; mood: number | null;
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
      personality: (t.personality || "none") as Personality,
      messages: t.messages || [],
      sharedWithCoach: Boolean(t.shared_with_coach),
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
    })),
    themes: (thData.themes as ThemeArc[]) || [],
    week: (thData.week as number) || 1,
    visits: (vData.visits as number) || 0,
    workingGenius: wgData.workingGenius
      ? {
        primary: (wgData.workingGenius as { primary_type: string }).primary_type,
        counts: JSON.parse((wgData.workingGenius as { counts_json: string }).counts_json),
        completedAt: (wgData.workingGenius as { completed_at: string }).completed_at,
      }
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
      personality: thread.personality || "none",
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

export async function saveWorkingGenius(userEmail: string, workingGenius: WorkingGenius) {
  await post({ action: "save-working-genius", userEmail, workingGenius });
}
