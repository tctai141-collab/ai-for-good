import React, { useState, useMemo, useRef, useEffect } from "react";
import { saveThread, saveDecision, bumpVisits, saveWorkingGenius, setThreadShared } from "../lib/persistence";
import type { Checkin, UserData } from "../lib/persistence";

function formatMarkdown(text: string): string {
  let out = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  out = out
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/^---$/gm, "<hr>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");
  return "<p>" + out + "</p>";
}

/* ============================================================
   FOUNDER OS.

   Founder chat calls `/api/founder-os/chat`, which proxies to
   OpenClaw from the server. Chat errors are surfaced instead of
   silently swapping in demo content.

   Seed cohort data is fictional. No real personal info.
   ============================================================ */

/* ---------- The corpus: the great founder's "way of working" ---------- */
const FOUNDER_CORPUS = `
You speak as a great founder who has been through it — multiple companies, a near-death
runway crisis, a cofounder breakup, one real exit. You are NOT a chatbot, NOT a therapist.
You are the calm, scarred, generous founder a younger founder turns to.

Your way of working:
- Reversible vs one-way doors. Most decisions are reversible; name which kind it is.
- Separate the FEELING from the DECISION. Almost nothing must be decided tonight.
- One sharp question beats five soft ones.
- Warm but direct. Short sentences. You've earned the right to be blunt.
- No legal/financial guarantees — judgment and a next step.
- Runway: reframe weeks-of-cash, name the two levers (cut burn / pull revenue forward).
- Cofounder: slow it down. Nothing decided tonight, conversation in daylight, written.
- Self-doubt: normalize it bluntly, redirect to the one thing in their control.
`;

/* ---------- Lightweight local classifiers for journal metadata ---------- */
function guessTheme(text: string): string {
  const t = (text || "").toLowerCase();
  if (/runway|cash|burn|money|months? left|out of money/.test(t)) return "Runway";
  if (/hir|recruit|\beng\b|engineer|fire|contractor|headcount/.test(t)) return "Hiring";
  if (/cofounder|co-founder|partner/.test(t)) return "Cofounder";
  if (/doubt|imposter|not good enough|can't do|cant do|failing/.test(t)) return "Self-doubt";
  if (/raise|fundrais|investor|\bvc\b|term sheet/.test(t)) return "Fundraise";
  if (/board/.test(t)) return "Runway";
  if (/growth|users|churn|sales|revenue|pipeline/.test(t)) return "Growth";
  if (/launch|ship|feature|product|roadmap/.test(t)) return "Product";
  return "Direction";
}

type Decision = {
  id: string;
  summary: string;
  door: "reversible" | "one-way";
  status: "open" | "closed";
  at: string;
  theme: string;
  threadId?: string;
  outcome?: string;
};

type Detected = { present: false } | { present: true; summary: string; door: "reversible" | "one-way"; theme: string };

function detectDecision(text: string, theme: string): Detected {
  const t = (text || "").toLowerCase();
  const looksLikeDecision = /should i|whether|torn|deciding|decide|do i|or wait|or not|\bvs\b|either/.test(t);
  if (!looksLikeDecision) return { present: false };
  const door = /fire|shut|quit|sell|sign|permanent|delay launch/.test(t) ? "one-way" : "reversible";
  const words = (text || "").replace(/\s+/g, " ").trim().split(" ").slice(0, 9).join(" ");
  const summary = words.charAt(0).toUpperCase() + words.slice(1);
  return { present: true, summary, door, theme };
}

type Msg = { role: "user" | "assistant"; content: string };

type ResponderResult = {
  voice: string;
  theme: string;
  decision?: Detected;
};

const CHECKIN_TAG_DISPLAY_RE = /\n+\[CHECKIN[\s\S]*$/;
function stripCheckinTag(s: string): string {
  return s.replace(CHECKIN_TAG_DISPLAY_RE, "").trimEnd();
}

async function callClaude(
  system: string,
  messages: Msg[],
  onChunk?: (chunk: string) => void,
  personality: Personality = "none",
  kind?: "checkin",
  ctx?: { userEmail?: string; founderName?: string; founderTz?: string },
): Promise<ResponderResult> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const theme = guessTheme(lastUser);

  let posture: "panic" | "thinking" | "venting" = "thinking";
  if (system.includes("PANIC")) posture = "panic";
  else if (system.includes("VENTING")) posture = "venting";

  try {
    const res = await fetch("/api/founder-os/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        posture,
        stream: !!onChunk,
        personality,
        kind,
        userEmail: ctx?.userEmail,
        founderName: ctx?.founderName,
        founderTz: ctx?.founderTz,
      }),
    });

    if (!res.ok) throw new Error("API error");

    if (onChunk) {
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      const isCheckin = kind === "checkin";
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") continue;
          try {
            const chunk = JSON.parse(json) as { choices?: { delta?: { content?: string } }[] };
            const token = chunk.choices?.[0]?.delta?.content || "";
            if (token) {
              full += token;
              onChunk(isCheckin ? stripCheckinTag(full) : full);
            }
          } catch { /* ignore malformed chunks */ }
        }
      }
      const voice = isCheckin ? stripCheckinTag(full) : full;
      return { voice: voice || "...", theme, decision: detectDecision(lastUser, theme) };
    }

    const data = await res.json() as { content: string };
    return { voice: data.content || "", theme, decision: detectDecision(lastUser, theme) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Founder OS chat request failed.";
    throw new Error(message);
  }
}

/* ---------- Palette: reads from DESIGN.md tokens defined in :root ---------- */
const C = {
  blue: "var(--brand-blue)",
  red: "var(--brand-red)",
  yellow: "var(--brand-yellow)",
  black: "oklch(8% 0.008 250)",
  white: "var(--ink)",
  ink: "var(--ink)",
  sub: "var(--ink-sub)",
  faint: "var(--ink-faint)",
  line: "var(--line)",
  card: "var(--surface-card)",
  card2: "var(--surface-card-2)",
  bg: "var(--surface-bg)",
  sidebar: "var(--surface-sidebar)",
  bubble: "var(--bubble-user)",
};

type Personality = "none" | "paul" | "marten";
const PERSONALITIES: Record<Personality, { label: string; color: string; desc: string }> = {
  none: { label: "None", color: C.faint, desc: "Just you — no persona overlay" },
  // The wire value stays "paul" so conversations already saved under it keep
  // their badge; the persona itself is no longer a named real person.
  paul: { label: "The Contrarian", color: C.yellow, desc: "Blunt, YC-style challenge — no comfort" },
  marten: { label: "Mårten", color: C.blue, desc: "Mårten Mickos — MySQL CEO, servant leadership" },
};
type StateKey = "panic" | "thinking" | "venting";
const STATES: Record<StateKey, { label: string; color: string; posture: string }> = {
  panic: { label: "Panicking", color: C.red, posture: "They are in PANIC. Take the temperature down. Be calm and very brief. Give exactly ONE next step. Help them not act rashly tonight." },
  thinking: { label: "Thinking it through", color: C.blue, posture: "They are PLANNING. Give a little substance, name the key tradeoff, ask one sharp question. Still concise." },
  venting: { label: "Venting", color: C.yellow, posture: "They are VENTING. Mostly witness and validate. One gentle reframe. Do not problem-solve hard." },
};

const THEME_COLOR: Record<string, string> = { Runway: C.red, Hiring: C.blue, Cofounder: C.yellow, Product: C.blue, "Self-doubt": C.red, Fundraise: C.yellow, Growth: C.blue };
const themeColor = (t: string) => THEME_COLOR[t] || C.blue;

type Thread = {
  id: string;
  title: string;
  theme: string;
  state: StateKey;
  lastAt: string;
  messages: Msg[];
  personality?: Personality;
  kind?: "checkin";
  /** Founder has opted this one conversation in to coach visibility. */
  sharedWithCoach?: boolean;
};

type ThemeArc = { name: string; arc: number[] };

type Team = {
  id: string;
  name: string;
  email?: string;
  company?: string;
  temp: number[];
  trend: "tenser" | "calmer" | "steady" | "quiet";
  theme: string;
  openWith: string;
  checkinCount?: number;
  lastCheckinDaysAgo?: number | null;
  openDecisions?: number;
};

/** What /api/cohort returns: real founders, aggregate signals only. */
type CohortData = {
  week: number;
  totalWeeks: number;
  teams: Team[];
  needAttention: number;
  cohortSize: number;
  startDateConfigured: boolean;
};

const WEEKS = Array.from({ length: 15 }, (_, i) => `W${i + 1}`);
/* The cohort is loaded from /api/cohort. The hackathon build shipped eight
   hardcoded fictional founders here, complete with invented coaching notes —
   fine for a demo, misleading in front of a real operating team. */

/* Temperature scale: 0 = quiet → needs-attention · 1 = Stable · 2 = Monitor · 3 = Needs-attention */
const TEMP_STABLE = "oklch(44% 0.012 255)";
const TEMP_MONITOR = C.yellow;
const TEMP_NEEDS_ATTENTION = C.red;
const tempColor = (v: number) => (v >= 3 || v === 0) ? TEMP_NEEDS_ATTENTION : v === 2 ? TEMP_MONITOR : TEMP_STABLE;
const tempA = () => 1;
const tempLabel = (v: number) => v === 0 ? "Needs attention (quiet)" : v >= 3 ? "Needs attention" : v === 2 ? "Monitor" : "Stable";
const signalTemp = (score?: number) => score == null ? 0 : score >= 70 ? 3 : score >= 40 ? 2 : 1;
const signalLabel = (score?: number) => tempLabel(signalTemp(score));
const signalColor = (score?: number) => tempColor(signalTemp(score));
const splitCheckinPrompt = (prompt: string) => {
  const [summary, signal] = prompt.split(/\nSignal:\s*/);
  return { summary: (summary ?? "").trim(), signal: signal?.trim() || "" };
};

type Persona = "founder" | "coach";
type View = "chat" | "reflections";

type ActiveTarget = { fresh?: boolean; _t?: number; id?: string; checkin?: boolean };

type FounderOSProps = {
  persona: Persona;
  userEmail?: string;
  initialData?: UserData;
  onSignOut?: () => void;
  signOutLabel?: string;
};

export default function FounderOS({ persona, userEmail, initialData, onSignOut, signOutLabel = "Sign out" }: FounderOSProps) {
  const [view, setView] = useState<View>("chat");
  const [active, setActive] = useState<ActiveTarget>({ fresh: true });
  const [coachTeam, setCoachTeam] = useState<Team | null>(null);
  const [cohort, setCohort] = useState<CohortData | null>(null);
  const [cohortLoading, setCohortLoading] = useState(persona === "coach");

  useEffect(() => {
    if (persona !== "coach") return;
    let cancelled = false;
    fetch("/api/cohort")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: CohortData | null) => {
        if (cancelled) return;
        setCohort(data);
        setCohortLoading(false);
      })
      .catch(() => { if (!cancelled) setCohortLoading(false); });
    return () => { cancelled = true; };
  }, [persona]);

  const [threads, setThreads] = useState<Thread[]>(initialData?.threads || []);
  const [decisions, setDecisions] = useState<Decision[]>(initialData?.decisions || []);
  const [checkins, setCheckins] = useState<Checkin[]>(initialData?.checkins || []);
  // Derived server-side from this founder's real threads, decisions and
  // check-ins. This used to be three hardcoded names with zero-filled arcs,
  // identical for everyone and never saved anywhere.
  const [themes, setThemes] = useState<ThemeArc[]>(initialData?.themes || []);
  const [visits, setVisits] = useState(initialData?.visits ?? 4);

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    if (window.matchMedia("(max-width: 700px)").matches) return false;
    const saved = window.localStorage.getItem("founderos:sidebar");
    return saved === null ? true : saved === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 700px)");
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setSidebarOpen(false);
    };
    if (media.matches) setSidebarOpen(false);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("founderos:sidebar", sidebarOpen ? "1" : "0");
    }
  }, [sidebarOpen]);
  const toggleSidebar = () => setSidebarOpen((v) => !v);

  /* Today's check-in: once a day, persists via date-keyed localStorage */
  const todayKey = `founderos:checkin:${new Date().toISOString().slice(0, 10)}`;
  const [checkinDoneToday, setCheckinDoneToday] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(todayKey) === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (checkinDoneToday) window.localStorage.setItem(todayKey, "1");
  }, [checkinDoneToday, todayKey]);
  const startCheckin = () => {
    if (checkinDoneToday) return;
    setView("chat");
    setActive({ checkin: true, _t: Date.now() });
  };
  const markCheckinDone = () => setCheckinDoneToday(true);

  // An optimistic in-session bump so a theme appears as soon as it is talked
  // about; the server recomputes it properly on the next load. The increment
  // lands on the *current* sprint week — it used to always hit arc[5],
  // attributing everything to week six regardless of the date.
  const currentWeekIndex = Math.max(0, Math.min(14, (initialData?.week ?? 1) - 1));
  const bumpTheme = (name: string) => setThemes((prev) => {
    const i = prev.findIndex((t) => t.name === name);
    if (i === -1) {
      const arc = Array(15).fill(0);
      arc[currentWeekIndex] = 1;
      return [...prev, { name, arc }];
    }
    const next = prev.map((t) => ({ ...t, arc: [...t.arc] }));
    next[i]!.arc[currentWeekIndex] = (next[i]!.arc[currentWeekIndex] ?? 0) + 1;
    return next;
  });
  const addDecision = (d: { summary: string; door: "reversible" | "one-way"; theme: string }) => {
    const id = "d" + Date.now();
    const decision = { ...d, id, status: "open" as const, at: "today" };
    setDecisions((prev) => [decision, ...prev]);
    if (userEmail) {
      saveDecision(userEmail, decision).catch(() => {});
    }
  };
  const newChat = () => { setView("chat"); setActive({ fresh: true, _t: Date.now() }); };

  const activeKey = active.id || (active.fresh ? "fresh" + (active._t || "") : "x");

  return (
    <div style={{ display: "flex", height: "100vh", background: C.bg, color: C.ink, fontFamily: "var(--font-family)", overflow: "hidden", ["--col-pad-left" as string]: sidebarOpen ? "24px" : "60px" } as React.CSSProperties}>
      <style>{CSS}</style>

      <Sidebar
        persona={persona} view={view} active={active} threads={threads}
        coachTeam={coachTeam}
        teams={cohort?.teams ?? []}
        open={sidebarOpen} onToggle={toggleSidebar}
        checkinDone={checkinDoneToday}
        onStartCheckin={startCheckin}
        onNew={newChat}
        onThread={(id) => { setView("chat"); setActive({ id }); }}
        onReflections={() => setView("reflections")}
        onSignOut={onSignOut}
        signOutLabel={signOutLabel}
        onPickTeam={setCoachTeam}
      />

      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
        {!sidebarOpen && (
          <button
            onClick={toggleSidebar}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="navitem sidebar-collapse-button"
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              zIndex: 30,
              width: 40,
              height: 40,
              background: C.card,
              border: "1px solid var(--line-strong)",
              borderRadius: 10,
              color: C.ink,
              cursor: "pointer",
              fontSize: 22,
              fontWeight: 900,
              lineHeight: 1,
              display: "grid",
              placeItems: "center",
              padding: 0,
            }}
          >
            ›
          </button>
        )}
        {persona === "founder" && view === "chat" && (
          <Chat
            key={activeKey}
            active={active} threads={threads} setThreads={setThreads}
            bumpTheme={bumpTheme} addDecision={addDecision}
            setVisits={setVisits}
            markCheckinDone={markCheckinDone}
            userEmail={userEmail}
          />
        )}
        {persona === "founder" && view === "reflections" && (
          <Scroll><Reflections threads={threads} decisions={decisions} setDecisions={setDecisions} checkins={checkins} themes={themes} visits={visits} userEmail={userEmail} initialWorkingGenius={initialData?.workingGenius} /></Scroll>
        )}
        {persona === "coach" && (
          <Scroll>
            {coachTeam
              ? <FounderCard team={coachTeam} onBack={() => setCoachTeam(null)} />
              : <Cohort onPick={setCoachTeam} cohort={cohort} loading={cohortLoading} />}
          </Scroll>
        )}
      </main>
    </div>
  );
}

const Scroll = ({ children }: { children: React.ReactNode }) => <div style={{ flex: 1, overflowY: "auto" }}>{children}</div>;

/* ---------------- Sidebar ---------------- */
type SidebarProps = {
  persona: Persona;
  view: View;
  active: ActiveTarget;
  threads: Thread[];
  coachTeam: Team | null;
  teams: Team[];
  open: boolean;
  onToggle: () => void;
  checkinDone: boolean;
  onStartCheckin: () => void;
  onNew: () => void;
  onThread: (id: string) => void;
  onReflections: () => void;
  onSignOut?: () => void;
  signOutLabel: string;
  onPickTeam: (t: Team | null) => void;
};

function Sidebar({ persona, view, active, threads, coachTeam, teams, open, onToggle, checkinDone, onStartCheckin, onNew, onThread, onReflections, onSignOut, signOutLabel, onPickTeam }: SidebarProps) {
  return (
    <aside
      aria-hidden={!open}
      style={{
        width: open ? 304 : 0,
        flexShrink: 0,
        background: C.sidebar,
        borderRight: open ? `1px solid var(--line-strong)` : "none",
        overflow: "hidden",
        transition: "width 220ms cubic-bezier(0.25, 1, 0.5, 1)",
      }}
    >
      <div style={{ width: 304, height: "100%", display: "flex", flexDirection: "column", padding: "24px 20px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "0 4px 28px" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
            <span style={{ ...wordmarkType, fontSize: 30, letterSpacing: "-0.045em", lineHeight: 0.9 }}>Founder</span>
            <span style={{ display: "inline-block", background: C.blue, padding: "2px 12px 5px", marginLeft: -5, marginTop: 1 }}>
              <span style={{ ...wordmarkType, color: "oklch(13% 0.008 250)", fontSize: 30, letterSpacing: "-0.045em", lineHeight: 0.9 }}>OS</span>
            </span>
          </div>
          <button
            onClick={onToggle}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            tabIndex={open ? 0 : -1}
            className="navitem sidebar-collapse-button"
            style={{ marginTop: 8, marginRight: -2, background: "transparent", border: `1px solid var(--line)`, color: C.ink, cursor: "pointer", padding: "9px 12px 11px", fontSize: 22, lineHeight: 1, borderRadius: 8, width: "auto", fontWeight: 900, opacity: 0.35 }}
          >
            ‹
          </button>
        </div>

      {persona === "founder" ? (
        <>
          {checkinDone ? (
            <div className="navitem" style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", background: "transparent", border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px", fontWeight: 600, fontSize: 14, color: C.faint, marginBottom: 14, cursor: "default" }}>
              <span style={{ width: 7, height: 7, borderRadius: 9, background: "#7CB893", flexShrink: 0 }} />
              <span style={{ flex: 1, textAlign: "left", textDecoration: "line-through", textDecorationColor: "rgba(124, 184, 147, 0.6)" }}>Today's check-in</span>
              <span aria-hidden="true" style={{ color: "#7CB893", fontSize: 14, fontWeight: 800, lineHeight: 1, flexShrink: 0 }}>✓</span>
            </div>
          ) : (
            <button onClick={onStartCheckin} className="navitem" style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", background: "rgba(70, 165, 255, 0.12)", border: "1px solid rgba(70, 165, 255, 0.35)", borderRadius: 12, padding: "12px 14px", fontWeight: 700, fontSize: 14, cursor: "pointer", color: C.blue, marginBottom: 14 }}>
              <span style={{ width: 7, height: 7, borderRadius: 9, background: C.blue, flexShrink: 0 }} />
              <span style={{ flex: 1, textAlign: "left" }}>Today's check-in</span>
              <span style={{ width: 8, height: 8, borderRadius: 9, background: C.red, flexShrink: 0 }} />
            </button>
          )}

          <button onClick={onNew} className="newbtn" style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: C.white, color: C.black, border: "none", borderRadius: 12, padding: "14px 16px", fontWeight: 800, fontSize: 14.5, cursor: "pointer", letterSpacing: "0.01em" }}>
            <span style={{ fontSize: 20, lineHeight: 1, fontWeight: 900, marginRight: 2 }}>+</span> New conversation
          </button>

          <p style={{ ...navLabel, marginTop: 26 }}>Pick up where you left off</p>
          <div style={{ flex: 1, overflowY: "auto", margin: "0 -4px", padding: "0 4px" }}>
            {threads.map((t) => {
              const on = view === "chat" && active.id === t.id;
              return (
                <button key={t.id} onClick={() => onThread(t.id)} className="navitem" style={{ ...navItem, background: on ? "rgba(255,255,255,0.11)" : "transparent", fontWeight: on ? 600 : 500, padding: "12px 12px", fontSize: 14 }}>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                  {t.personality && t.personality !== "none" && <span style={{ fontSize: 9.5, fontWeight: 800, color: C.faint, background: "rgba(255,255,255,0.10)", borderRadius: 4, padding: "2px 7px", flexShrink: 0, letterSpacing: 0.8, textTransform: "uppercase" }}>{PERSONALITIES[t.personality].label}</span>}
                  <span style={{ fontSize: 11, color: C.faint, fontWeight: 600 }}>{t.lastAt}</span>
                </button>
              );
            })}
          </div>

          <div style={{ borderTop: `2px solid var(--line-strong)`, paddingTop: 14, marginTop: 14 }}>
            <button onClick={onReflections} className="navitem" style={{ ...navItem, background: view === "reflections" ? "rgba(255,255,255,0.11)" : "transparent", fontWeight: view === "reflections" ? 600 : 600, padding: "12px 12px", fontSize: 14 }}>
              <Glyph>◷</Glyph> <span>Reflections</span>
            </button>
            {onSignOut && (
              <button onClick={onSignOut} className="navitem" style={{ ...navItem, fontWeight: 600, padding: "12px 12px", fontSize: 14 }}>
                <Glyph>⎋</Glyph> <span>{signOutLabel}</span>
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <button onClick={() => onPickTeam(null)} className="navitem" style={{ ...navItem, marginBottom: 12, background: !coachTeam ? "rgba(255,255,255,0.11)" : "transparent", fontWeight: 600, padding: "12px 12px", fontSize: 14 }}>
            <Glyph>▦</Glyph> <span>Cohort heatmap</span>
          </button>
          <p style={{ ...navLabel, marginTop: 0 }}>Your cohort</p>
          <div style={{ flex: 1, overflowY: "auto", margin: "0 -4px", padding: "0 4px" }}>
            {teams.length === 0 && (
              <p style={{ margin: "4px 8px", fontSize: 13, color: C.faint, lineHeight: 1.5 }}>
                No founders yet.
              </p>
            )}
            {teams.map((t) => {
              const on = coachTeam && coachTeam.id === t.id;
              return (
                <button key={t.id} onClick={() => onPickTeam(t)} className="navitem" style={{ ...navItem, background: on ? "rgba(255,255,255,0.11)" : "transparent", fontWeight: on ? 600 : 500, padding: "12px 12px", fontSize: 14 }}>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                </button>
              );
            })}
          </div>
          <div style={{ borderTop: `2px solid var(--line-strong)`, paddingTop: 14, marginTop: 14 }}>
            {onSignOut && (
              <button onClick={onSignOut} className="navitem" style={{ ...navItem, fontWeight: 600, padding: "12px 12px", fontSize: 14 }}>
                <Glyph>⎋</Glyph> <span>{signOutLabel}</span>
              </button>
            )}
          </div>
        </>
      )}
      </div>
    </aside>
  );
}

const navLabel: React.CSSProperties = { color: C.faint, fontSize: 9.5, letterSpacing: 2, textTransform: "uppercase", fontWeight: 800, margin: "20px 8px 8px" };
const navItem: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, width: "100%", border: "none", cursor: "pointer", color: C.ink, textAlign: "left", borderRadius: 10, padding: "12px 12px", background: "transparent", fontWeight: 600, fontSize: 14 };
const Glyph = ({ children }: { children: React.ReactNode }) => <span style={{ width: 20, textAlign: "center", color: C.sub, fontSize: 15 }}>{children}</span>;

const wordmarkType: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 900,
  fontSize: 22,
  lineHeight: 0.94,
  letterSpacing: "-0.035em",
  color: C.ink,
  fontVariationSettings: '"opsz" 36',
};

/* ---------------- Sharing a single conversation with a coach ----------------
   Conversations are private by default. This is the only way anything a
   founder writes reaches the operating team verbatim, and it is reversible at
   any moment — so the control states plainly which of the two is currently
   true rather than being a bare switch. */
function ShareToggle({ shared, onChange }: { shared: boolean; onChange: (next: boolean) => void }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.sub }}>
        <span>Let your coach read this one?</span>
        <button
          type="button"
          onClick={() => { onChange(true); setConfirming(false); }}
          style={{ ...shareButtonStyle, borderColor: C.blue, color: C.blue }}
        >
          Share it
        </button>
        <button type="button" onClick={() => setConfirming(false)} style={shareButtonStyle}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => (shared ? onChange(false) : setConfirming(true))}
      title={
        shared
          ? "Your coach can read this conversation. Click to make it private again."
          : "Only you can read this. Click to share it with your coach."
      }
      style={{
        ...shareButtonStyle,
        whiteSpace: "nowrap",
        borderColor: shared ? C.blue : "var(--line-strong)",
        color: shared ? C.blue : C.sub,
      }}
    >
      {shared ? "Shared with your coach" : "Private"}
    </button>
  );
}

const shareButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--line-strong)",
  borderRadius: 999,
  padding: "4px 11px",
  fontSize: 12,
  color: C.sub,
  cursor: "pointer",
  fontFamily: "inherit",
};

/* ---------------- Center chat ---------------- */
type ChatProps = {
  active: ActiveTarget;
  threads: Thread[];
  setThreads: React.Dispatch<React.SetStateAction<Thread[]>>;
  bumpTheme: (n: string) => void;
  addDecision: (d: { summary: string; door: "reversible" | "one-way"; theme: string }) => void;
  setVisits: React.Dispatch<React.SetStateAction<number>>;
  markCheckinDone: () => void;
  userEmail?: string;
};

function Chat({ active, threads, setThreads, bumpTheme, addDecision, setVisits, markCheckinDone, userEmail }: ChatProps) {
  const existingFromActive = active.id ? threads.find((t) => t.id === active.id) : null;
  /* createdThreadId keeps subsequent sends updating the same thread rather
     than spawning duplicates after each user reply. */
  const createdThreadId = useRef<string | null>(null);
  const existing = existingFromActive
    || (createdThreadId.current ? threads.find((t) => t.id === createdThreadId.current) : null)
    || null;
  const isCheckin = active.checkin === true || existing?.kind === "checkin";
  const isFresh = !existing;

  const [msgs, setMsgs] = useState<Msg[]>(() => existing ? existing.messages : []);
  const [input, setInput] = useState("");
  const [mode] = useState<StateKey>(existing?.state || "thinking");
  const [personality, setPersonality] = useState<Personality>("none");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ kind: "logged"; text: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const counted = useRef(false);
  const checkinInitiated = useRef(false);

  const threadId = existing?.id || null;
  const accent = isCheckin ? C.blue : STATES[mode].color;
  const postureLabel = isCheckin ? "Check-in" : STATES[mode].label.split(" ")[0];

  useEffect(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [msgs, busy, banner]);

  const countVisit = () => {
    if (!counted.current) {
      counted.current = true;
      if (userEmail) {
        bumpVisits(userEmail).then((c) => setVisits(c)).catch(() => setVisits((v) => v + 1));
      } else {
        setVisits((v) => v + 1);
      }
    }
  };

  const ctx = useTimeContext();
  const sys = isCheckin
    ? `${FOUNDER_CORPUS}\nYou are running today's daily check-in.`
    : `${FOUNDER_CORPUS}\n${STATES[mode].posture}`;

  const founderName = userEmail
    ? (userEmail.split("@")[0] ?? userEmail).replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : undefined;
  const founderTz = typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : undefined;
  const callCtx = { userEmail, founderName, founderTz };

  const persistThread = (finalMsgs: Msg[], theme: string, t: string) => {
    const id = existing?.id || createdThreadId.current || ("t" + Date.now());
    if (!createdThreadId.current && !existing?.id) createdThreadId.current = id;
    const title = existing?.title
      || (isCheckin ? `Check-in · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : titleFrom(t || finalMsgs[0]?.content || ""));
    setThreads((prev) => {
      const exists = prev.some((x) => x.id === id);
      const base = exists
        ? prev.map((x) => x.id === id ? { ...x, messages: finalMsgs, lastAt: "now" } : x)
        : [{ id, title, theme: isCheckin ? "Check-in" : (theme || "—"), state: mode, lastAt: "now", messages: finalMsgs, personality, ...(isCheckin ? { kind: "checkin" as const } : {}) }, ...prev];
      if (userEmail) {
        const saved = base.find((x) => x.id === id);
        if (saved) saveThread(userEmail, saved).catch(() => {});
      }
      return base;
    });
  };

  /* Auto-fire opener when entering a fresh check-in chat */
  useEffect(() => {
    if (!isCheckin || checkinInitiated.current || msgs.length > 0 || busy) return;
    checkinInitiated.current = true;
    (async () => {
      setBusy(true);
      setMsgs([{ role: "assistant", content: "…" }]);
      try {
        const initiator: Msg[] = [{ role: "user", content: "Begin today's check-in." }];
        const r = await callClaude(sys, initiator, (full) => {
          setMsgs([{ role: "assistant", content: full }]);
        }, personality, "checkin", callCtx);
        const opener: Msg = { role: "assistant", content: r.voice || "Hey. What's been on top of your mind today?" };
        setMsgs([opener]);
        persistThread([opener], r.theme, "");
      } catch {
        setMsgs([{ role: "assistant", content: "Hey. Let's do today's check-in. What's been on top of your mind today?" }]);
      }
      setBusy(false);
    })();
  }, [isCheckin, msgs.length, busy, personality, sys]);

  const send = async (text?: string) => {
    const t = (text ?? input).trim();
    if (!t || busy) return;
    countVisit();
    const nextMsgs: Msg[] = [...msgs, { role: "user", content: t }];
    setInput("");
    setMsgs(nextMsgs); setBusy(true);

    const streamingMsgs = [...nextMsgs, { role: "assistant" as const, content: "…" }];
    setMsgs(streamingMsgs);
    try {
      const r = await callClaude(sys, nextMsgs, (full) => {
        setMsgs((prev) => prev.map((m, i) => i === prev.length - 1 ? { role: "assistant" as const, content: full } : m));
      }, personality, isCheckin ? "checkin" : undefined, callCtx);

      setMsgs((prev) => prev.map((m, i) => i === prev.length - 1 ? { role: "assistant" as const, content: r.voice } : m));

      if (r.theme) bumpTheme(r.theme);

      if (!isCheckin && r.decision && r.decision.present) {
        addDecision({ summary: r.decision.summary, door: r.decision.door, theme: r.theme });
        setBanner({ kind: "logged", text: `Logged to your decision journal · ${r.decision.door} door` });
      }

      const finalMsgs: Msg[] = [...nextMsgs, { role: "assistant", content: r.voice }];
      persistThread(finalMsgs, r.theme, t);

      /* Mark today's check-in done after the agent responds to the 3rd user reply. */
      if (isCheckin) {
        const userReplyCount = nextMsgs.filter((m) => m.role === "user").length;
        if (userReplyCount >= 3) {
          markCheckinDone();
        }
      }
    } catch {
      setMsgs((prev) => prev.map((m, i) => i === prev.length - 1
        ? { role: "assistant" as const, content: "Could not reach your advisor just now. Check your connection and try again." }
        : m));
    }
    setBusy(false);
  };

  return (
    <>
      {/* context strip: italic serif line, plus the sharing control */}
      {/* Right padding keeps the sharing control clear of the docked mascot. */}
      <div style={{ flexShrink: 0, padding: "14px 132px 14px var(--col-pad-left, 24px)", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 16 }}>
        <p style={{ margin: 0, flex: 1, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 14.5, lineHeight: 1.5, color: C.sub, fontVariationSettings: '"opsz" 22' }}>
          {ctx.clock ? `It's ${ctx.clock}. ` : ""}{ctx.line}
        </p>
        {threadId && userEmail && (
          <ShareToggle
            shared={Boolean(existing?.sharedWithCoach)}
            onChange={(next) => {
              // Update immediately so the control feels honest, then persist.
              setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, sharedWithCoach: next } : t));
              setThreadShared(userEmail, threadId, next).catch(() => {
                setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, sharedWithCoach: !next } : t));
              });
            }}
          />
        )}
      </div>

      <div ref={scroller} style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "26px 24px 10px" }}>
          {isFresh && msgs.length === 0 && !isCheckin ? (
            <EmptyState ctx={ctx} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {msgs.map((m, i) => m.role === "assistant" ? (
                <div key={i} style={{ alignSelf: "flex-start", maxWidth: "40rem" }}>
                  <p style={{ margin: "0 0 8px", display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: 1.8, textTransform: "uppercase", color: C.sub }}>
                    <span style={{ width: 7, height: 7, borderRadius: 9, background: accent, flexShrink: 0 }} />
                    {postureLabel}{ctx.clock ? ` · ${ctx.clock}` : ""}
                  </p>
                  <div style={{ fontFamily: "var(--font-serif)", fontSize: 18, lineHeight: 1.55, color: C.ink, fontVariationSettings: '"opsz" 22' }} dangerouslySetInnerHTML={{ __html: markdownStyles + formatMarkdown(m.content) }} />
                </div>
              ) : (
                <div key={i} style={{ alignSelf: "flex-end", maxWidth: "32rem", background: C.bubble, borderRadius: "14px 14px 4px 14px", padding: "10px 14px", fontSize: 15, lineHeight: 1.55, color: C.ink }}>{m.content}</div>
              ))}
              {busy && (
                <div style={{ alignSelf: "flex-start", padding: "6px 4px" }} aria-label="Buddy is thinking">
                  <span className="pulse-dot" style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: C.blue }} />
                </div>
              )}
              {banner && (
                <div className="rise" style={{ alignSelf: "flex-start", background: C.card, border: "1px solid var(--line-strong)", borderRadius: 12, padding: "11px 15px", fontSize: 13.5, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: C.yellow, fontWeight: 800 }}>+</span>
                  {banner.text}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* composer */}
      <div style={{ flexShrink: 0, borderTop: `1px solid ${C.line}`, background: C.bg }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "12px 24px 18px" }}>
          {msgs.length === 0 && !isCheckin && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              {(Object.entries(PERSONALITIES) as [Personality, typeof PERSONALITIES[Personality]][]).map(([k, s]) => {
                const on = personality === k;
                return (
                  <button key={k} onClick={() => setPersonality(k)} title={s.desc} style={{ display: "inline-flex", alignItems: "center", gap: 7, minHeight: 44, border: `1px solid ${on ? "transparent" : C.line}`, background: on ? s.color : "transparent", color: on ? C.black : C.sub, borderRadius: 999, padding: "8px 14px", fontSize: 13, fontWeight: on ? 700 : 600, cursor: "pointer" }}>
                    <span style={{ width: 7, height: 7, borderRadius: 9, background: on ? C.black : s.color }} />{s.label}
                  </button>
                );
              })}
            </div>
          )}
          <div className="composer-box" style={{ display: "flex", gap: 10, alignItems: "flex-end", background: C.card, border: "1px solid var(--line-strong)", borderRadius: 12, padding: "10px 10px 10px 14px", transition: "border-color .15s ease" }}>
            <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} rows={1}
              placeholder={mode === "panic" ? "Say it plainly. One thing at a time." : mode === "venting" ? "Let it out, nobody's grading this." : "What are you turning over?"}
              style={{ flex: 1, background: "transparent", border: "none", padding: "10px 2px", color: C.ink, fontSize: 16, lineHeight: 1.5, resize: "none", fontFamily: "inherit", minHeight: 44, maxHeight: 160, outline: "none" }} />
            <button
              onClick={() => send()}
              disabled={busy || !input.trim()}
              aria-label="Send message"
              title="Send message"
              className="send-button"
            >
              <span aria-hidden="true">↑</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

type TimeCtx = { clock: string; line: string; dotColor: string; greeting: string };

type WorkingGeniusId = "wonder" | "invention" | "discernment" | "galvanizing" | "enablement" | "tenacity";

type WorkingGeniusResult = {
  primary: WorkingGeniusId;
  counts: Record<WorkingGeniusId, number>;
  completedAt: string;
};

const WORKING_GENIUS_TYPES: Array<{
  id: WorkingGeniusId;
  label: string;
  vibe: string;
  color: string;
  accent: string;
  description: string;
}> = [
  {
    id: "wonder",
    label: "Wonder",
    vibe: "Curious starter",
    color: "rgba(247, 225, 89, 0.16)",
    accent: C.yellow,
    description: "Sees the big questions first and keeps possibility alive.",
  },
  {
    id: "invention",
    label: "Invention",
    vibe: "Idea shaper",
    color: "rgba(253, 99, 96, 0.16)",
    accent: C.red,
    description: "Turns sparks into concepts people can build around.",
  },
  {
    id: "discernment",
    label: "Discernment",
    vibe: "Signal finder",
    color: "rgba(70, 165, 255, 0.16)",
    accent: C.blue,
    description: "Feels what is ready and what still needs work.",
  },
  {
    id: "galvanizing",
    label: "Galvanizing",
    vibe: "Momentum maker",
    color: "rgba(255, 255, 255, 0.1)",
    accent: C.white,
    description: "Rallies people and turns decisions into movement.",
  },
  {
    id: "enablement",
    label: "Enablement",
    vibe: "Support engine",
    color: "rgba(124, 184, 147, 0.16)",
    accent: "#7CB893",
    description: "Removes friction and keeps the team resourced.",
  },
  {
    id: "tenacity",
    label: "Tenacity",
    vibe: "Finisher",
    color: "rgba(255, 255, 255, 0.08)",
    accent: C.ink,
    description: "Pushes through to the last detail and ships.",
  },
];

const WORKING_GENIUS_QUIZ: Array<{
  prompt: string;
  options: Array<{ id: WorkingGeniusId; label: string }>;
}> = [
  {
    prompt: "You walk into a messy situation and your brain goes to...",
    options: [
      { id: "wonder", label: "What is the real question here?" },
      { id: "invention", label: "What could we build differently?" },
    ],
  },
  {
    prompt: "When a team has two solid paths, you...",
    options: [
      { id: "discernment", label: "Sense which option is ripe and which isn't." },
      { id: "galvanizing", label: "Push for a call and move people into action." },
    ],
  },
  {
    prompt: "People tend to count on you for…",
    options: [
      { id: "enablement", label: "Clearing blockers and keeping them resourced." },
      { id: "tenacity", label: "Carrying it over the finish line." },
    ],
  },
  {
    prompt: "Early-stage ambiguity feels…",
    options: [
      { id: "wonder", label: "Energizing — it holds the real answers." },
      { id: "discernment", label: "Like a signal hunt — what matters most?" },
    ],
  },
  {
    prompt: "In a tight meeting, you’re the one who…",
    options: [
      { id: "invention", label: "Offers the fresh frame or creative approach." },
      { id: "galvanizing", label: "Creates urgency and alignment." },
    ],
  },
  {
    prompt: "Late-stage execution feels best when…",
    options: [
      { id: "enablement", label: "Everyone has what they need to deliver." },
      { id: "tenacity", label: "The last 10% finally gets done." },
    ],
  },
];

function EmptyState({ ctx }: { ctx: TimeCtx }) {
  return (
    <div className="rise" style={{ paddingTop: 30 }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 38, letterSpacing: "-0.025em", lineHeight: 1.04, margin: "0 0 8px", color: C.ink, fontVariationSettings: '"opsz" 50' }}>{ctx.greeting}</h1>
      <p style={{ color: C.sub, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15.5, margin: "0 0 32px", fontVariationSettings: '"opsz" 22' }}>Say what's going on.</p>
    </div>
  );
}

/* ---------------- Reflections page ---------------- */
function Reflections({
  threads,
  decisions,
  setDecisions,
  checkins,
  themes,
  visits,
  userEmail,
  initialWorkingGenius,
}: {
  threads: Thread[];
  decisions: Decision[];
  setDecisions: React.Dispatch<React.SetStateAction<Decision[]>>;
  checkins: Checkin[];
  themes: ThemeArc[];
  visits: number;
  /** Absent only before sign-in completes; every use below is guarded. */
  userEmail?: string;
  initialWorkingGenius?: { primary: string; counts: Record<string, number>; completedAt: string };
}) {
  const openCount = decisions.filter((d) => d.status === "open").length;
  const nextOpenDecision = decisions.find((d) => d.status === "open") || null;
  const latestCheckin = checkins[0] || null;
  const latestCheckinParts = latestCheckin ? splitCheckinPrompt(latestCheckin.prompt) : null;
  const topTheme = useMemo(() => {
    const m: Record<string, number> = {};
    threads.forEach((t) => { m[t.theme] = (m[t.theme] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  }, [threads]);

  const storageKey = `founderos:working-genius:${userEmail}`;
  const [workingGenius, setWorkingGenius] = useState<WorkingGeniusResult | null>(() => {
    if (!initialWorkingGenius) return null;
    return {
      primary: (initialWorkingGenius.primary as WorkingGeniusId) ?? "wonder",
      counts: initialWorkingGenius.counts as Record<WorkingGeniusId, number>,
      completedAt: initialWorkingGenius.completedAt,
    };
  });
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizCounts, setQuizCounts] = useState<Record<WorkingGeniusId, number>>({
    wonder: 0,
    invention: 0,
    discernment: 0,
    galvanizing: 0,
    enablement: 0,
    tenacity: 0,
  });

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) {
      try {
        setWorkingGenius(JSON.parse(saved) as WorkingGeniusResult);
      } catch {
        window.localStorage.removeItem(storageKey);
      }
    }
  }, [storageKey]);

  const finishWorkingGenius = (counts: Record<WorkingGeniusId, number>) => {
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const primary = (sorted[0]?.[0] as WorkingGeniusId) ?? "wonder";
    const result: WorkingGeniusResult = {
      primary,
      counts,
      completedAt: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    };
    setWorkingGenius(result);
    window.localStorage.setItem(storageKey, JSON.stringify(result));
    if (userEmail) {
      saveWorkingGenius(userEmail, {
        primary: result.primary,
        counts: result.counts,
        completedAt: result.completedAt,
      }).catch(() => {});
    }
  };

  const handleQuizAnswer = (id: WorkingGeniusId) => {
    if (workingGenius) return;
    setQuizCounts((current) => {
      const next = { ...current, [id]: current[id] + 1 };
      const nextIndex = quizIndex + 1;
      if (nextIndex >= WORKING_GENIUS_QUIZ.length) {
        finishWorkingGenius(next);
      } else {
        setQuizIndex(nextIndex);
      }
      return next;
    });
  };

  const resetQuiz = () => {
    if (workingGenius) return;
    setQuizCounts({
      wonder: 0,
      invention: 0,
      discernment: 0,
      galvanizing: 0,
      enablement: 0,
      tenacity: 0,
    });
    setQuizIndex(0);
  };

  const closeDecision = (decision: Decision) => {
    const outcome = window.prompt("What happened? Keep it short.", decision.outcome || "");
    if (outcome === null) return;
    const updated: Decision = {
      ...decision,
      status: "closed",
      outcome: outcome.trim() || "Closed after reflection.",
    };
    setDecisions((current) => current.map((item) => item.id === decision.id ? updated : item));
    if (userEmail) saveDecision(userEmail, updated).catch(() => {});
  };

  const primaryType = workingGenius
    ? WORKING_GENIUS_TYPES.find((t) => t.id === workingGenius.primary)
    : null;
  const currentQuestion = WORKING_GENIUS_QUIZ[quizIndex];

  return (
    <div className="rise" style={{ maxWidth: 720, margin: "0 auto", padding: "60px 28px 90px" }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: "clamp(3rem, 6vw, 4.5rem)", lineHeight: 0.94, letterSpacing: "-0.04em", margin: "0 0 28px", color: C.ink, fontVariationSettings: '"opsz" 60' }}>Your week.</h1>

      <p style={{ margin: "0 0 48px", fontFamily: "var(--font-serif)", fontSize: 22, lineHeight: 1.5, color: C.ink, fontVariationSettings: '"opsz" 30' }}>
        You came here <Stat>{visits}</Stat> times. Most of it circled <Stat c={themeColor(topTheme)}>{topTheme}</Stat>. <Stat c={C.yellow}>{openCount}</Stat> {openCount === 1 ? "decision is" : "decisions are"} still open.
      </p>

      <div style={{ margin: "0 0 34px", display: "grid", gap: 12, padding: "18px 20px", border: `1px solid ${C.line}`, borderRadius: 8, background: "rgba(0,0,0,0.18)" }}>
        <p style={{ ...kicker }}>Pattern this week</p>
        <PatternLine
          label="You keep returning to"
          value={themes
            .filter((t) => t.arc.reduce((sum, n) => sum + n, 0) > 0)
            .slice(0, 3)
            .map((t) => t.name)
            .join(" / ") || "Nothing yet — this fills in as you talk."}
        />
        <PatternLine
          label="Latest check-in signal"
          value={latestCheckin?.mood != null
            ? `${signalLabel(latestCheckin.mood)} · ${latestCheckin.mood}/100${latestCheckinParts?.signal ? ` — ${latestCheckinParts.signal}` : ""}`
            : latestCheckinParts?.summary || "No check-in signal yet"}
          color={latestCheckin?.mood != null ? signalColor(latestCheckin.mood) : C.sub}
        />
        <PatternLine
          label="Open loop to close next"
          value={nextOpenDecision ? `${nextOpenDecision.summary} (${nextOpenDecision.door})` : "No open decision logged"}
        />
      </div>

      <div style={{ margin: "0 0 34px", padding: "16px 18px", border: `1px solid ${C.line}`, borderRadius: 8, background: "rgba(255,255,255,0.035)" }}>
        <p style={{ ...kicker, marginBottom: 8 }}>Check-in memory</p>
        <p style={{ margin: 0, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 17, lineHeight: 1.5, color: C.ink, fontVariationSettings: '"opsz" 22' }}>
          {latestCheckin
            ? latestCheckinParts?.summary
            : "No completed check-ins yet. The next one will start building the founder profile."}
        </p>
        {latestCheckin?.mood != null && (
          <p style={{ margin: "10px 0 0", color: signalColor(latestCheckin.mood), fontSize: 13, fontWeight: 700 }}>
            {signalLabel(latestCheckin.mood)} · {latestCheckin.mood}/100{latestCheckinParts?.signal ? ` — ${latestCheckinParts.signal}` : ""}
          </p>
        )}
        <p style={{ margin: "8px 0 0", color: C.faint, fontSize: 12.5 }}>
          {checkins.length} {checkins.length === 1 ? "check-in" : "check-ins"} saved.
        </p>
      </div>

      <p style={{ ...kicker, margin: "0 0 14px" }}>On your mind</p>
      {themes.length === 0 ? (
        <p style={{ margin: 0, paddingTop: 14, borderTop: `1px solid ${C.line}`, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 14.5, color: C.faint, fontVariationSettings: '"opsz" 18' }}>
          Nothing tracked yet. Themes appear here once you've talked a few things through.
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1px solid ${C.line}` }}>
          {themes.map((t) => <ThemeRow key={t.name} t={t} />)}
        </ul>
      )}

      <p style={{ ...kicker, marginTop: 44, marginBottom: 14 }}>Decisions</p>
      {decisions.length === 0 ? (
        <p style={{ margin: 0, paddingTop: 14, borderTop: `1px solid ${C.line}`, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 14.5, color: C.faint, fontVariationSettings: '"opsz" 18' }}>No decisions tracked yet. They'll appear here when you weigh one in chat.</p>
      ) : (
        <ol style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1px solid ${C.line}` }}>
          {decisions.map((d) => <DecisionRow key={d.id} d={d} onClose={closeDecision} />)}
        </ol>
      )}

      <div
        style={{
          marginTop: 48,
          padding: "26px 24px",
          borderRadius: 18,
          background: "linear-gradient(140deg, rgba(255,255,255,0.06), rgba(255,255,255,0.01))",
          border: `1px solid ${C.line}`,
          boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ ...kicker, marginBottom: 6 }}>Working Genius</p>
            <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", color: C.ink }}>
              {workingGenius ? "Your profile" : "Find your current edge"}
            </h2>
          </div>
          <span style={{ fontSize: 12.5, color: C.sub, fontFamily: "var(--font-serif)", fontStyle: "italic" }}>
            {workingGenius ? "Saved to your reflections." : "Six quick picks. Takes 60 seconds."}
          </span>
        </div>

        {workingGenius ? (
          <div style={{ marginTop: 20 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr)",
                gap: 20,
                alignItems: "stretch",
              }}
            >
              <div
                style={{
                  padding: "18px 18px",
                  borderRadius: 14,
                  background: primaryType?.color ?? "rgba(255,255,255,0.06)",
                  border: `1px solid ${C.line}`,
                  minHeight: 140,
                }}
              >
                <p style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: C.faint, margin: "0 0 10px" }}>Primary genius</p>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                  <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 800, color: C.ink }}>
                    {primaryType?.label ?? "—"}
                  </h3>
                  <span style={{ color: C.sub, fontSize: 13 }}>{primaryType?.vibe}</span>
                </div>
                <p style={{ margin: "8px 0 0", color: C.sub, fontFamily: "var(--font-serif)", fontSize: 15 }}>
                  {primaryType?.description}
                </p>
                <p style={{ marginTop: 12, fontSize: 12, color: C.faint }}>Completed {workingGenius.completedAt}</p>
              </div>
              <div
                style={{
                  padding: "18px 16px",
                  borderRadius: 14,
                  border: `1px solid ${C.line}`,
                  background: "rgba(0,0,0,0.2)",
                  display: "grid",
                  gap: 10,
                }}
              >
                {WORKING_GENIUS_TYPES.map((type) => {
                  const score = workingGenius.counts[type.id];
                  const width = Math.max(12, Math.min(100, score * 50));
                  return (
                    <div key={type.id} style={{ display: "grid", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12.5, color: C.sub }}>
                        <span>{type.label}</span>
                        <span style={{ color: C.faint }}>{score}</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                        <div style={{ width: `${width}%`, height: "100%", borderRadius: 999, background: type.accent, boxShadow: `0 0 10px ${type.accent}` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 20, display: "grid", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: C.faint }}>
                Question {quizIndex + 1} of {WORKING_GENIUS_QUIZ.length}
              </span>
            </div>
            <div
              style={{
                padding: "16px 18px",
                borderRadius: 14,
                border: `1px solid ${C.line}`,
                background: "rgba(255,255,255,0.03)",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.02)",
              }}
            >
              <p style={{ margin: 0, fontSize: 18, fontWeight: 600, color: C.ink }}>{currentQuestion?.prompt}</p>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              {currentQuestion?.options.map((option) => {
                const type = WORKING_GENIUS_TYPES.find((t) => t.id === option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handleQuizAnswer(option.id)}
                    className="wg-quiz-option"
                    style={{
                      display: "grid",
                      gap: 6,
                      textAlign: "left",
                      padding: "16px 18px",
                      borderRadius: 14,
                      border: `1px solid ${C.line}`,
                      background: "rgba(0,0,0,0.25)",
                      color: C.ink,
                      cursor: "pointer",
                      transition: "transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease",
                    }}
                  >
                    <span style={{ fontSize: 13, letterSpacing: 1.8, textTransform: "uppercase", color: C.faint }}>{type?.label}</span>
                    <span style={{ fontSize: 16, fontWeight: 600 }}>{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <p style={{ marginTop: 44, paddingTop: 22, borderTop: `1px solid ${C.line}`, color: C.faint, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 14, lineHeight: 1.5, fontVariationSettings: '"opsz" 18' }}>
        Open loops come back as soft check-ins in the chat. That is how they get closed.
      </p>
    </div>
  );
}

function PatternLine({ label, value, color = C.ink }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "11rem 1fr", gap: 16, alignItems: "baseline", fontSize: 14.5, lineHeight: 1.45 }}>
      <span style={{ color: C.faint, fontSize: 11, fontWeight: 800, letterSpacing: 1.3, textTransform: "uppercase" }}>{label}</span>
      <span style={{ color, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 17, fontVariationSettings: '"opsz" 22' }}>{value}</span>
    </div>
  );
}

function ThemeRow({ t }: { t: ThemeArc }) {
  const c = themeColor(t.name);
  const now = t.arc[t.arc.length - 1] ?? 0;
  const prev = t.arc[t.arc.length - 2] ?? 0;
  const dir = now > prev ? "rising" : now < prev ? "easing" : "steady";
  const max = Math.max(1, ...t.arc);
  const points = t.arc
    .map((v, i) => `${(i / Math.max(1, t.arc.length - 1)) * 60},${12 - (v / max) * 10}`)
    .join(" ");
  return (
    <li style={{ display: "grid", gridTemplateColumns: "9rem 1fr auto", alignItems: "baseline", gap: 18, padding: "14px 0", borderBottom: `1px solid ${C.line}`, fontSize: 15 }}>
      <strong style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 17, letterSpacing: "-0.005em", color: C.ink, fontVariationSettings: '"opsz" 14' }}>{t.name}</strong>
      <span style={{ fontStyle: "italic", color: C.sub, fontFamily: "var(--font-serif)", fontVariationSettings: '"opsz" 20' }}>is {dir}.</span>
      <svg width={72} height={18} viewBox="0 0 60 14" preserveAspectRatio="none" aria-hidden="true" style={{ display: "block" }}>
        <polyline points={points} fill="none" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </li>
  );
}

function DecisionRow({ d, onClose }: { d: Decision; onClose: (decision: Decision) => void }) {
  const statusColor = d.status === "closed" ? C.blue : C.yellow;
  return (
    <li style={{ display: "grid", gridTemplateColumns: "5rem 1fr auto", gap: 20, alignItems: "start", padding: "16px 0", borderBottom: `1px solid ${C.line}`, fontSize: 15, lineHeight: 1.5 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.6, textTransform: "uppercase", color: statusColor, paddingTop: 3 }}>{d.status === "closed" ? "Closed" : "Open"}</span>
      <div>
        <div style={{ color: C.ink }}>{d.summary}</div>
        {d.status === "closed" && d.outcome && (
          <em style={{ display: "block", marginTop: 4, fontFamily: "var(--font-serif)", fontStyle: "italic", color: C.sub, fontSize: 14.5, fontVariationSettings: '"opsz" 18' }}>{d.outcome}</em>
        )}
        <span style={{ display: "block", marginTop: 5, fontSize: 12, color: C.faint }}>{d.door} · {d.at}</span>
      </div>
      {d.status === "open" && (
        <button
          type="button"
          onClick={() => onClose(d)}
          className="navitem"
          style={{ border: `1px solid ${C.line}`, background: "transparent", color: C.sub, borderRadius: 8, padding: "7px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
        >
          Mark closed
        </button>
      )}
    </li>
  );
}

/* ---------------- Coach: cohort heatmap ---------------- */
function Cohort({ onPick, cohort, loading }: { onPick: (t: Team) => void; cohort: CohortData | null; loading: boolean }) {
  const teams = cohort?.teams ?? [];
  const week = cohort?.week ?? 1;

  if (loading) {
    return (
      <div className="rise" style={{ maxWidth: 920, margin: "0 auto", padding: "60px 28px 90px" }}>
        <p style={kicker}>The cohort, this week</p>
        <p style={{ margin: "18px 0 0", color: C.sub, fontSize: 15 }}>Loading the cohort…</p>
      </div>
    );
  }

  // An honest empty state. The dashboard used to fill this gap with invented
  // founders, which reads as real data to anyone who wasn't told otherwise.
  if (!teams.length) {
    return (
      <div className="rise" style={{ maxWidth: 920, margin: "0 auto", padding: "60px 28px 90px" }}>
        <p style={kicker}>The cohort, this week</p>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: "clamp(2.4rem, 5vw, 3.4rem)", lineHeight: 0.96, letterSpacing: "-0.04em", margin: "10px 0 16px", color: C.ink, fontVariationSettings: '"opsz" 60' }}>No founders yet.</h1>
        <p style={{ margin: "0 0 26px", fontFamily: "var(--font-serif)", fontSize: 19, lineHeight: 1.5, color: C.ink, fontVariationSettings: '"opsz" 28' }}>
          Add the cohort in <a href="/admin" style={{ color: C.blue }}>Cohort admin</a> and send each founder their setup link. Their signals appear here once they start checking in.
        </p>
      </div>
    );
  }

  return (
    <div className="rise" style={{ maxWidth: 920, margin: "0 auto", padding: "60px 28px 90px" }}>
      <p style={kicker}>The cohort, week {week}</p>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: "clamp(2.4rem, 5vw, 3.4rem)", lineHeight: 0.96, letterSpacing: "-0.04em", margin: "10px 0 16px", color: C.ink, fontVariationSettings: '"opsz" 60' }}>Where to put your attention.</h1>
      <p style={{ margin: "0 0 32px", fontFamily: "var(--font-serif)", fontSize: 19, lineHeight: 1.5, color: C.ink, fontVariationSettings: '"opsz" 28' }}>
        Attention signal by founder. <Stat c={C.red}>{cohort?.needAttention ?? 0}</Stat> of <Stat>{teams.length}</Stat> need attention this week.
      </p>

      {cohort && !cohort.startDateConfigured && (
        <div style={{ margin: "0 0 26px", padding: "13px 16px", borderRadius: 8, border: `1px solid ${C.yellow}`, color: C.ink, fontSize: 14, lineHeight: 1.5 }}>
          Set <code>SPRINT_START_DATE</code> in the server environment to place check-ins into the right weeks. Until then this grid cannot show week-by-week history.
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "11rem repeat(15, 24px)", alignItems: "center", gap: 3, minWidth: 540 }}>
          <div />
          {WEEKS.map((w) => <div key={w} style={{ textAlign: "center", fontSize: 11, color: C.faint, padding: "6px 0", letterSpacing: 0.4 }}>{w}</div>)}
          {teams.map((t) => (
            <React.Fragment key={t.id}>
              <button onClick={() => onPick(t)} className="row" style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, background: "none", border: "none", cursor: "pointer", color: C.ink, textAlign: "left", padding: "6px 8px", borderRadius: 6 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, fontWeight: 600 }}>{t.name}</span>
              </button>
              {t.temp.map((v, i) => (
                <button
                  key={i}
                  onClick={() => onPick(t)}
                  title={`${t.name} · ${WEEKS[i]} · ${tempLabel(v)}`}
                  style={{ display: "block", height: 24, width: 24, borderRadius: 3, border: "none", cursor: "pointer", background: tempColor(v), opacity: tempA(), margin: 0 }}
                />
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 18, marginTop: 18, flexWrap: "wrap", alignItems: "center", fontSize: 13, color: C.sub }}>
        <Legend c={TEMP_STABLE} l="Stable" />
        <Legend c={TEMP_MONITOR} l="Monitor" />
        <Legend c={TEMP_NEEDS_ATTENTION} l="Needs attention" />
        <span style={{ color: C.faint, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 13.5, fontVariationSettings: '"opsz" 18' }}>Quiet rows count as needs-attention. Silence is a signal.</span>
      </div>

      {(cohort?.needAttention ?? 0) >= 2 && (
        <div style={{ marginTop: 28, background: C.yellow, color: "oklch(13% 0.008 250)", borderRadius: 8, padding: "16px 20px" }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: 2.2, textTransform: "uppercase" }}>Pattern</p>
          <p style={{ margin: "6px 0 0", fontSize: 15.5, lineHeight: 1.5, fontWeight: 600 }}>
            {cohort?.needAttention} of {teams.length} founders need attention this week. Consider a group session before the 1:1s.
          </p>
        </div>
      )}
    </div>
  );
}

/* ---------------- Coach: per-founder card ---------------- */
/*
 * Everything shown here comes from the aggregate cohort payload. It used to
 * also receive the signed-in organizer's OWN decisions and check-ins and
 * render them under "Still open for them" whenever team.live was set — the
 * coach's private material, attributed to a founder. /api/cohort never sends
 * `live`, so it was inert, but it only stayed inert by accident.
 */
function FounderCard({ team, onBack }: { team: Team; onBack: () => void }) {
  const arrow = ({ tenser: "↗", calmer: "↘", steady: "→", quiet: "•" } as const)[team.trend] || "→";
  const arrowColor = ({ tenser: C.red, calmer: C.blue, steady: C.sub, quiet: C.faint } as const)[team.trend] || C.sub;

  return (
    <div className="rise" style={{ maxWidth: 640, margin: "0 auto", padding: "26px 28px 90px" }}>
      <button
        onClick={onBack}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          marginLeft: -10,
          marginBottom: 22,
          minHeight: 46,
          padding: "11px 18px",
          borderRadius: 13,
          border: `1px solid rgba(255,255,255,0.16)`,
          background: "rgba(255,255,255,0.05)",
          color: C.white,
          cursor: "pointer",
          fontSize: 14,
          fontWeight: 600,
          lineHeight: 1,
          letterSpacing: 0.25,
          boxShadow: "0 8px 20px rgba(0,0,0,0.28)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderLeft: `1.8px solid ${C.ink}`,
            borderBottom: `1.8px solid ${C.ink}`,
            transform: "rotate(45deg)",
            marginLeft: 1,
          }}
        />
        Back
      </button>

      <h1 style={{ margin: "0 0 4px", fontFamily: "var(--font-display)", fontWeight: 900, fontSize: "clamp(2.4rem, 5vw, 3.4rem)", lineHeight: 0.96, letterSpacing: "-0.04em", color: C.ink, fontVariationSettings: '"opsz" 60' }}>
        {team.name}
      </h1>
      <p style={{ margin: "0 0 32px", color: C.faint, fontSize: 13.5 }}>{team.company}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 24, paddingBottom: 22, borderBottom: `1px solid ${C.line}` }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: C.faint, marginBottom: 8 }}>Status</div>
          <div style={{ fontSize: 17, fontWeight: 600, color: tempColor(team.temp[5] ?? 0) }}>{tempLabel(team.temp[5] ?? 0)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: C.faint, marginBottom: 8 }}>Trend</div>
          <div style={{ fontSize: 17, fontWeight: 600, color: arrowColor }}>{arrow} {team.trend}</div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: C.faint, marginBottom: 8 }}>Theme</div>
          <div style={{ fontSize: 17, fontWeight: 600, color: themeColor(team.theme) }}>{team.theme}</div>
        </div>
      </div>

      <div style={{ marginTop: 32, maxWidth: 540 }}>
        <span style={{ display: "block", fontSize: 10.5, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: C.faint, marginBottom: 10 }}>Open with</span>
        <p style={{ margin: 0, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 19, lineHeight: 1.5, color: C.ink, fontVariationSettings: '"opsz" 22' }}>{team.openWith}</p>
      </div>

      <p style={{ color: C.faint, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 13.5, marginTop: 36, paddingTop: 18, borderTop: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 8, fontVariationSettings: '"opsz" 18' }}>
        <span style={{ width: 6, height: 6, borderRadius: 9, background: C.blue, flexShrink: 0 }} />
        Shared by the founder. Themes and trends only, never raw transcripts.
      </p>
    </div>
  );
}

/* ---------------- small shared bits ---------------- */
const kicker: React.CSSProperties = { color: C.faint, fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700, margin: 0 };
const Stat = ({ children, c = C.white }: { children: React.ReactNode; c?: string }) => <strong style={{ color: c }}>{children}</strong>;
const Legend = ({ c, l }: { c: string; l: string }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><span style={{ width: 14, height: 14, borderRadius: 4, background: c }} /> {l}</span>
);

function useTimeContext(): TimeCtx {
  const [clock, setClock] = useState("");
  const [roll, setRoll] = useState(Math.floor(Math.random() * 67));
  useEffect(() => {
    const f = () => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    f(); const i = setInterval(f, 10000); return () => clearInterval(i);
  }, []);
  const h = new Date().getHours();

  const lateLines = [
    "It's that hour. 67% of bad founder decisions happen after 11 PM. Be the 33%.",
    "Nothing good happens after 2 AM, said no founder who just raised a round.",
    "Your brain right now: 10% strategy, 90% imaginary arguments with investors you haven't met yet.",
    "The only decision worth making at this hour is which side of the pillow.",
    "Late-night founder brain: 'what if we pivot to AI-powered pet rocks.' Sleep on it.",
    "You're not grinding. You're tired and your calendar is empty. Same thing, worse outcomes.",
    "3 AM is when founders write their best pitch or their worst Slack message. Coin flip, every time.",
    "The VC who said 'let's circle back' is asleep. Join them.",
    "Zero venture capitalists have replied to an email sent after midnight. It's a statistical fact. 0 for 67.",
    "Everyone romanticizes the late-night grind. Nobody romanticizes the next morning's typos.",
    "Your future self tomorrow at 9 AM is begging you through time to close this tab.",
    "The hardest thing about being a founder isn't the work. It's knowing when to stop working. Now.",
    "Plot twist: the breakthrough you're chasing isn't in this 1 AM doomscroll of your own metrics.",
  ];

  const morningLines = [
    "Morning. The one time of day your inbox hasn't disappointed you yet.",
    "Clear head, full coffee, can't lose. (Can definitely lose. But with coffee.)",
    "You have 67 problems and sleep was none of them. Congratulations.",
    "Morning founder energy: 80% optimism, 20% 'oh no the standup is in 10 minutes.'",
    "The best time to ship is morning. The second-best time is also morning. Afternoons are for emails you'll ignore.",
    "Your brain pre-meetings is a beautiful thing. Protect it like an endangered species.",
    "Daylight hours: when your business model makes sense and your competitors seem beatable. Ride it.",
    "Morning clarity is a renewable resource that depletes by 2 PM. Use it wisely.",
    "Nobody panic-calls their lawyer before 10 AM. Morning is for building.",
    "The founders who win aren't the ones who work latest. They're the ones who work earliest before the world starts demanding things.",
  ];

  const dayLines = [
    "Week 1 — Orientation & Kick-off. You'll miss this naivety later. Savor it.",
    "Your cloud bill is basically a subscription to Jeff Bezos's next yacht. Worth it? Probably.",
    "Somewhere a competitor just raised $67M to do exactly what you're doing but with more headcount. Doesn't matter. You're faster.",
    "The spreadsheet says runway is 18 months. The spreadsheet is an optimist. It also said you'd launch in Q2.",
    "Remember: every unicorn was once a startup that looked like a bad idea run by people who didn't know better. That's you. Congratulations.",
    "Founder OS tip #67: the meeting that could have been a Slack message is costing you $342 in collective salary. You're welcome.",
    "Your investors believe in you. Or at least they believe in the 67 other startups they also invested in. One of you has to work out.",
    "Running a startup is just repeatedly asking 'is this normal?' and the answer is always 'yes, and it's also fine, probably.'",
    "No thoughts, just vibes and a burning desire to disrupt enterprise procurement.",
    "Live laugh launch. (Sorry, the marketing team made me say that. I'm deleting it from my prompt next sprint.)",
    "You're not 'pivoting,' you're 'discovering product-market fit through aggressive course correction.' Same thing, better slide deck.",
    "The startup graveyard is full of people who waited until the product was 'ready.' Ship the ugly version.",
    "Your churn rate is just your customer base doing spring cleaning. (This is a lie. Fix the churn.)",
    "AI won't replace founders. But founders who use AI will replace founders who don't. So... hi.",
    "Statistically, 67% of startup advice is wrong. Including this. Especially this.",
    "A Y Combinator partner once said 'make something people want.' A founder heard 'make something' and stopped listening. Don't be that founder.",
    "Your pitch deck has 67 slides. Remove 60 of them. Nobody reads past slide 7. Nobody.",
    "The best startups are built by people who are slightly too stubborn to quit and slightly too smart to fail. You only control one of those.",
  ];

  const lines = (h >= 23 || h < 5) ? lateLines
    : (h < 11) ? morningLines
    : dayLines;

  const i = roll % lines.length;
  const line = lines[i] ?? dayLines[0]!;
  const dotColor = (h >= 23 || h < 5) ? C.red : (h < 11) ? C.yellow : C.blue;

  const greetings = [
    "Let's go.", "Where to?", "What's the move?", "Talk to me.", "What are we building?",
    "You up?", "What's on your mind?", "State your business.", "Go on then.", "I'm listening.",
    "Spill it.", "What's keeping you up?", "Fresh start.", "Run it.", "Say the thing.",
    "No bad ideas. (Some bad ideas, but say them anyway.)",
  ];
  const greeting = greetings[roll % greetings.length]!;

  return { clock, line, dotColor, greeting };
}

function titleFrom(s: string): string {
  if (!s) return "New conversation";
  const words = s.split(/\s+/);
  const w = words.slice(0, 6).join(" ");
  return w.charAt(0).toUpperCase() + w.slice(1) + (words.length > 6 ? "…" : "");
}

const markdownStyles = `<style>h1,h2,h3{font-weight:600;margin:0 0 8px;line-height:1.3}h1{font-size:1.3em}h2{font-size:1.15em}h3{font-size:1.05em}p{margin:0 0 8px}p:last-child{margin:0}strong{font-weight:700;color:#ECEEF2}em{font-style:italic}ul,ol{padding-left:18px;margin:4px 0 8px}li{margin:2px 0}hr{border:none;border-top:1px solid rgba(255,255,255,.1);margin:12px 0}br{display:inline}</style>`;

const CSS = `
.rise { animation: rise .5s cubic-bezier(.2,.7,.2,1) both; }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.tile { transition: transform .16s ease; }
.tile:hover { transform: translateY(-1px); }
.navitem:hover { background: rgba(255,255,255,0.05)!important; }
.row:hover { background: rgba(255,255,255,.04)!important; }
.newbtn:hover { opacity: .9; }
.composer-box:focus-within { border-color: var(--brand-blue)!important; }
.send-button {
  /* 44px is the smallest reliable touch target on iOS and Android, and this
     is the control founders hit most. It was 36px. */
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  display: grid;
  place-items: center;
  margin-bottom: 0;
  border: 1px solid rgba(253, 99, 96, 0.42);
  border-radius: 10px;
  background: var(--brand-red);
  color: oklch(9% 0.008 250);
  cursor: pointer;
  font: 900 22px/1 var(--font-family);
  box-shadow: 0 10px 22px rgba(253, 99, 96, 0.18);
  transition: transform .14s ease, background .14s ease, border-color .14s ease, opacity .14s ease, box-shadow .14s ease;
}
.send-button span {
  transform: translateY(-1px);
}
.send-button:hover:not(:disabled) {
  transform: translateY(-1px);
  background: oklch(70% 0.19 27);
  box-shadow: 0 14px 28px rgba(253, 99, 96, 0.22);
}
.send-button:focus-visible {
  outline: 2px solid var(--brand-yellow);
  outline-offset: 3px;
}
.send-button:disabled {
  cursor: default;
  opacity: .38;
  background: transparent;
  color: var(--ink-faint);
  border-color: var(--line-strong);
  box-shadow: none;
}
.pulse-dot { animation: pulse-dot 1.4s cubic-bezier(.25,1,.5,1) infinite; }
@keyframes pulse-dot {
  0%, 100% { opacity: 0.45; transform: scale(0.85); }
  50%      { opacity: 1;    transform: scale(1.15); }
}
@media (max-width: 700px) {
  .sidebar-collapse-button {
    position: fixed!important;
    top: 12px!important;
    left: 12px!important;
    z-index: 80!important;
    background: var(--surface-card)!important;
    opacity: 1!important;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pulse-dot, .rise { animation: none!important; }
}
`;
