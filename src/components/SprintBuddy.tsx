import React, { useState, useMemo, useRef, useEffect } from "react";
import Tasks, { useDeadlines, nextUp, type DeadlinesState } from "./Tasks";
import { saveThread, saveDecision, saveCheckin, bumpVisits, saveWorkingGenius, setThreadShared, deleteThread, PersistenceError } from "../lib/persistence";
import {
  INSTRUMENT_PREAMBLE,
  WORKING_GENIUS_ITEMS,
  WORKING_GENIUS_TYPES,
  bandCopy,
  daysUntil,
  nextRetakeDate,
  retakeOpen,
  typeById,
  WIDGET_ORDER,
  type WorkingGeniusAnswer,
  type WorkingGeniusBand,
  type WorkingGeniusId,
  type WorkingGeniusResult,
} from "../lib/workingGenius";
import { MAX_WG_TEXT_CHARS } from "../lib/limits";
import type { Checkin, UserData } from "../lib/persistence";
import { advisorErrorMessage } from "../lib/advisor-errors";
import TextShimmer from "./TextShimmer";
import InteractiveHoverButton from "./InteractiveHoverButton";
import GlassFilter from "./GlassFilter";

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

   Founder chat calls `/api/chat`, which proxies to
   OpenClaw from the server. Chat errors are surfaced instead of
   silently swapping in demo content.

   Seed cohort data is fictional. No real personal info.
   ============================================================ */

/*
 * The client does not carry a system prompt, and must not.
 *
 * A `FOUNDER_CORPUS` constant used to sit here: 896 characters of the
 * fabricated-founder persona that was retired from the server — "multiple
 * companies, a near-death runway crisis, a cofounder breakup, one real exit".
 * It never reached the model, because `callClaude` sends `posture` rather than
 * `system`; its only real job was to be searched for "PANIC" and "VENTING" to
 * recover the posture it had just been concatenated with.
 *
 * It shipped in the public bundle all the same, which meant a persona the
 * product had deliberately stopped using was readable by anyone who opened
 * devtools, and one careless change away from being sent for real.
 *
 * Nothing replaced it. The posture that survived that cleanup has since gone
 * too, so the client now sends messages and a flag for which flow to run, and
 * the server decides everything else.
 */

/**
 * The calendar day in Helsinki, as YYYY-MM-DD.
 *
 * The cohort is in one timezone and the server is UTC, so "today" has to mean
 * the founder's today. en-CA is used only because it formats as ISO; no locale
 * is implied by it.
 */
function asDate(stamp: string): Date {
  // SQLite writes "2026-09-15 06:12:44" in UTC with no marker; an optimistic
  // row written here is already a full ISO string. Both have to parse the same.
  return new Date(/[TZ]/.test(stamp) ? stamp : stamp.replace(" ", "T") + "Z");
}

function helsinkiDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

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
  kind?: "checkin",
  ctx?: { userEmail?: string; founderName?: string; founderTz?: string },
): Promise<ResponderResult> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const theme = guessTheme(lastUser);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        stream: !!onChunk,
        kind,
        userEmail: ctx?.userEmail,
        founderName: ctx?.founderName,
        founderTz: ctx?.founderTz,
      }),
    });

    // Carry the status through. Collapsing every failure into one message is
    // what made a 403 look like a dropped connection.
    if (!res.ok) throw new Error(advisorErrorMessage(res.status));

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
    // A thrown fetch means the request never landed; anything else already
    // carries a message chosen for the status it came back with.
    if (err instanceof TypeError) throw new Error(advisorErrorMessage(null));
    throw err instanceof Error ? err : new Error(advisorErrorMessage(null));
  }
}

/* ---------- Palette: reads from DESIGN.md tokens defined in :root ---------- */
const C = {
  /* The interactive accent, signal red since 2026-08-24. Was blue, and was
     called blue here long enough that the rename is worth the diff. */
  accent: "var(--brand-accent)",
  red: "var(--brand-red)",
  yellow: "var(--brand-yellow)",
  /* Not a brand colour, but the only other hue the app already uses, and the
     categorical sets need it now that blue is gone. */
  green: "#7CB893",
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

/*
 * The voice picker used to sit here: "None" and "Mårten", earlier also a
 * contrarian archetype. There is one voice now and it is the app's own, so
 * there is nothing to pick between. Threads saved under the old wire values
 * still open — the server ignores the field rather than mapping it.
 */
/*
 * Threads still carry a state, and it is always "thinking".
 *
 * There were three: panic, thinking, venting, each with its own posture sent to
 * the model. No founder could ever reach two of them. The mode was declared
 * `const [mode] = useState(...)` with no setter and nothing in the interface
 * set it, so every conversation ever started was "thinking" and the panic and
 * venting postures were unreachable code that looked shipped and passed tests.
 *
 * Removed rather than wired up, deliberately. Making it work would have meant
 * asking a founder in trouble to first classify their own emotional state,
 * which is friction at the worst possible moment. The general prompt already
 * handles distress: it names reversible decisions, separates the feeling from
 * the decision, and says almost nothing has to be decided tonight.
 *
 * The column keeps its CHECK on all three values because threads saved before
 * this are still in the database with the old ones.
 */
type StateKey = "panic" | "thinking" | "venting";
const THREAD_STATE: StateKey = "thinking";
const CHAT_ACCENT = C.accent;

/*
 * Spread across what is left after blue. Three themes used to be blue and would
 * all have become the accent, putting five of seven on one of two reds. Runway
 * and Self-doubt keep the alarm coral because that is what they are; the rest
 * take green and yellow. Theme rows are labelled, so this is legibility rather
 * than meaning.
 */
/*
 * Theme hues, and why they are not the status ones.
 *
 * These used to be drawn from the status palette: Runway and Self-doubt were
 * C.red, Hiring and Growth C.green, Cofounder and Fundraise C.yellow. Red is
 * also what "Needs attention" and an overdue deadline are painted in, so the
 * word Runway in "most of it circled Runway" was the same colour as an alarm,
 * saying nothing about how the week went. It was survivable while the
 * interactive accent was red too and everything was red; it is not now that
 * red means exactly one thing.
 *
 * So: a categorical ramp with no member in the red, amber or green families,
 * assigned in a fixed order. Fixed, because a hue that moves when the set
 * changes is worse than no hue — colour has to follow the theme, never its
 * rank. Anything unlisted falls to slate rather than borrowing a neighbour's.
 */
const THEME_COLOR: Record<string, string> = {
  Runway: "#7c8cf8",      // indigo
  Hiring: "#38bdf8",      // sky
  Cofounder: "#c084fc",   // violet
  Product: "#f472b6",     // pink
  "Self-doubt": "#94a3b8", // slate
  Fundraise: "#2dd4bf",   // teal
  Growth: "#a5b4fc",      // periwinkle
};
const THEME_FALLBACK = "#8a8f98";
const themeColor = (t: string) => THEME_COLOR[t] || THEME_FALLBACK;

type Thread = {
  id: string;
  title: string;
  theme: string;
  state: StateKey;
  lastAt: string;
  messages: Msg[];
  kind?: "checkin";
  /** Founder has opted this one conversation in to coach visibility. */
  sharedWithCoach?: boolean;
  sharedSeenAt?: string | null;
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
type WorkingGeniusMapRow = {
  email: string;
  name: string;
  gifts: WorkingGeniusId[];
  competencies: WorkingGeniusId[];
  drains: WorkingGeniusId[];
  takenOn: string;
};

type CohortData = {
  week: number;
  totalWeeks: number;
  teams: Team[];
  needAttention: number;
  quiet: number;
  cohortSize: number;
  startDateConfigured: boolean;
  /** Founders who agreed to be on the map. Bands only, never answers. */
  map: WorkingGeniusMapRow[];
  /** How many did not. Counted, never named — see the API for why. */
  mapWithheld: number;
};

const WEEKS = Array.from({ length: 15 }, (_, i) => `W${i + 1}`);
/* The cohort is loaded from /api/cohort. The hackathon build shipped eight
   hardcoded fictional founders here, complete with invented coaching notes —
   fine for a demo, misleading in front of a real operating team. */

/*
 * Temperature scale: 0 = no check-in · 1 = Stable · 2 = Monitor · 3 = Needs attention
 *
 * "No check-in" is drawn as an empty outline rather than a colour, because the
 * absence of a signal is not a signal of distress. It used to render in the
 * same red as a founder in real difficulty, which made a quiet week and a hard
 * week indistinguishable at a glance — and they call for opposite responses.
 */
const TEMP_STABLE = "oklch(44% 0.012 255)";
const TEMP_MONITOR = C.yellow;
const TEMP_NEEDS_ATTENTION = C.red;
const tempColor = (v: number) => v >= 3 ? TEMP_NEEDS_ATTENTION : v === 2 ? TEMP_MONITOR : v === 0 ? "transparent" : TEMP_STABLE;
const tempBorder = (v: number) => v === 0 ? `1px solid ${C.line}` : "none";
/* For text. A transparent swatch works in the grid and would be invisible as a
   label, so "no check-in" reads as muted rather than absent. */
const tempTextColor = (v: number) => v === 0 ? C.faint : tempColor(v);
const tempA = () => 1;
const tempLabel = (v: number) => v === 0 ? "No check-in" : v >= 3 ? "Needs attention" : v === 2 ? "Monitor" : "Stable";
const signalTemp = (score?: number) => score == null ? 0 : score >= 70 ? 3 : score >= 40 ? 2 : 1;
const signalLabel = (score?: number) => tempLabel(signalTemp(score));
const signalColor = (score?: number) => tempTextColor(signalTemp(score));
const splitCheckinPrompt = (prompt: string) => {
  const [summary, signal] = prompt.split(/\nSignal:\s*/);
  return { summary: (summary ?? "").trim(), signal: signal?.trim() || "" };
};

type Persona = "founder" | "coach";
type View = "chat" | "reflections";

type ActiveTarget = { fresh?: boolean; _t?: number; id?: string; checkin?: boolean };

type SprintBuddyProps = {
  persona: Persona;
  userEmail?: string;
  initialData?: UserData;
  onSignOut?: () => void;
  signOutLabel?: string;
};

export default function SprintBuddy({ persona, userEmail, initialData, onSignOut, signOutLabel = "Sign out" }: SprintBuddyProps) {
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
    const saved = window.localStorage.getItem("sprintbuddy:sidebar");
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
      window.localStorage.setItem("sprintbuddy:sidebar", sidebarOpen ? "1" : "0");
    }
  }, [sidebarOpen]);
  const toggleSidebar = () => setSidebarOpen((v) => !v);

  /* Deadlines are fetched once here rather than inside the sidebar section,
     because the collapsed-sidebar button needs the overdue count too. */
  const deadlines = useDeadlines(persona === "founder" ? userEmail : undefined);

  /*
   * Today's check-in, answered by the server's own record rather than by this
   * browser's localStorage.
   *
   * Two things were wrong with the flag this replaces. It lived in
   * localStorage, so a founder who checked in on a laptop was invited to check
   * in again on their phone, and the record the server already held was never
   * asked. And it was keyed on the UTC date while every other date in the
   * product is computed in Helsinki, so for three hours every night the app
   * and the reminders disagreed about what day it was.
   */
  const [locallyCheckedIn, setLocallyCheckedIn] = useState(false);
  const checkinDoneToday = useMemo(() => {
    if (locallyCheckedIn) return true;
    const last = checkins[0]?.createdAt;
    return Boolean(last && helsinkiDay(asDate(last)) === helsinkiDay(new Date()));
  }, [checkins, locallyCheckedIn]);
  const startCheckin = () => {
    if (checkinDoneToday) return;
    setView("chat");
    setActive({ checkin: true, _t: Date.now() });
  };
  const markCheckinDone = () => setLocallyCheckedIn(true);

  /*
   * The five-second version.
   *
   * The full check-in is three questions answered in prose, which is two to
   * four minutes. That is the right depth and the wrong price for a daily
   * habit: a five-minute daily log is abandoned inside a fortnight while a
   * five-second one survives for months. With no notification channel to lean
   * on, the cheap path matters more, not less.
   *
   * It writes the same kind of row as the long version, so a founder who only
   * ever taps still builds a trend, and the operating team still gets a signal.
   * The scale is attention needed, not happiness, matching what the model emits
   * from the full check-in: higher means more worth a conversation.
   */
  /*
   * The one-tap check-in is gone. Five mood chips beside the real check-in
   * meant a founder could log a day in one click, and every one of them did:
   * the cheap path is always the one taken, so the full check-in — the
   * questions the programme actually needs answered — never got opened.
   * Removing the cheap path is the only way the expensive one gets used.
   *
   * Nothing is migrated. Entries it already wrote are ordinary check-ins with
   * a short prompt and a mood, indistinguishable from a full one answered
   * briefly, and they stay in the founder's record.
   */

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

  /**
   * Removes a conversation, optimistically, and puts it back if the server
   * disagrees. A delete that appears to work and silently did not is worse
   * than one that visibly fails — the founder would find it again tomorrow.
   */
  const removeThread = async (id: string) => {
    const previous = threads;
    setThreads((prev) => prev.filter((t) => t.id !== id));
    // Do not leave the reader staring at a conversation that no longer exists.
    if (active.id === id) setActive({ fresh: true, _t: Date.now() });
    try {
      if (userEmail) await deleteThread(userEmail, id);
    } catch {
      setThreads(previous);
    }
  };

  const activeKey = active.id || (active.fresh ? "fresh" + (active._t || "") : "x");

  return (
    <div style={{ display: "flex", height: "100vh", background: C.bg, color: C.ink, fontFamily: "var(--font-family)", overflow: "hidden", ["--col-pad-left" as string]: sidebarOpen ? "24px" : "60px" } as React.CSSProperties}>
      <style>{CSS}</style>
      {/* What .btn-glass refracts through. Mounted at the root rather than
          inside a button: SVG filter ids are global to the document, and one
          per button would mean twenty elements all defining #btn-glass, with
          every reference resolving to whichever mounted first. */}
      <GlassFilter id="btn-glass" />

      <Sidebar
        persona={persona} view={view} active={active} threads={threads}
        coachTeam={coachTeam}
        teams={cohort?.teams ?? []}
        open={sidebarOpen} onToggle={toggleSidebar}
        checkinDone={checkinDoneToday}
        deadlines={deadlines}
        onStartCheckin={startCheckin}
        onNew={newChat}
        onThread={(id) => { setView("chat"); setActive({ id }); }}
        onDeleteThread={removeThread}
        decisions={decisions}
        onReflections={() => setView("reflections")}
        onSignOut={onSignOut}
        signOutLabel={signOutLabel}
        onPickTeam={setCoachTeam}
      />

      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
        {persona === "founder" && (
          <MobileActions
            checkinDone={checkinDoneToday}
            onStartCheckin={startCheckin}
            deadlines={deadlines}
            onOpenSidebar={() => setSidebarOpen(true)}
          />
        )}
        {!sidebarOpen && (
          <button
            onClick={toggleSidebar}
            aria-label={
              deadlines.overdueCount > 0
                ? `Expand sidebar — ${deadlines.overdueCount} deadline${deadlines.overdueCount === 1 ? "" : "s"} overdue`
                : "Expand sidebar"
            }
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
            {deadlines.overdueCount > 0 && (
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: -5,
                  right: -5,
                  minWidth: 18,
                  height: 18,
                  padding: "0 5px",
                  borderRadius: 9,
                  background: C.red,
                  color: "oklch(98% 0 0)",
                  fontSize: 10.5,
                  fontWeight: 800,
                  lineHeight: "18px",
                  textAlign: "center",
                  fontVariantNumeric: "tabular-nums",
                  border: `2px solid ${C.bg}`,
                  boxSizing: "content-box",
                }}
              >
                {deadlines.overdueCount}
              </span>
            )}
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
            firstRun={threads.length === 0 && checkins.length === 0}
          />
        )}
        {persona === "founder" && view === "reflections" && (
          <Scroll><Reflections threads={threads} decisions={decisions} setDecisions={setDecisions} checkins={checkins} themes={themes} visits={visits} userEmail={userEmail} initialWorkingGenius={initialData?.workingGenius} takes={initialData?.workingGeniusTakes} /></Scroll>
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
  deadlines: DeadlinesState;
  onStartCheckin: () => void;
  onNew: () => void;
  onThread: (id: string) => void;
  onDeleteThread: (id: string) => void;
  /** Only so the delete warning can say how many go with the conversation. */
  decisions: Decision[];
  onReflections: () => void;
  onSignOut?: () => void;
  signOutLabel: string;
  onPickTeam: (t: Team | null) => void;
};

function Sidebar({ persona, view, active, threads, coachTeam, teams, open, onToggle, checkinDone, deadlines, onStartCheckin, onNew, onThread, onDeleteThread, decisions, onReflections, onSignOut, signOutLabel, onPickTeam }: SidebarProps) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const pending = confirmDelete ? threads.find((t) => t.id === confirmDelete) ?? null : null;
  const pendingDecisions = pending ? decisions.filter((d) => d.threadId === pending.id).length : 0;

  /*
   * Escape closes it. A destructive dialog a keyboard cannot dismiss is a
   * dialog people click through to get rid of.
   */
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setConfirmDelete(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending]);


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
          {/*
            One wordmark, cut from moving light.

            It was "Sprint" over "Buddy" in a solid red block, which Tai called
            ugly and which also put the loudest colour in the product on a
            label nobody clicks. Both words are one element now, so the fill is
            clipped across the whole mark at once rather than per line.
          */}
          <span className="wordmark-liquid" aria-label="Sprint Buddy">
            Sprint<br />Buddy
          </span>
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
          <Tasks state={deadlines} />

          <ProgrammeRail />

          {checkinDone ? (
            <div className="navitem" style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", background: "transparent", border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px", fontWeight: 600, fontSize: 14, color: C.faint, marginBottom: 14, cursor: "default" }}>
              <span style={{ width: 7, height: 7, borderRadius: 9, background: "#7CB893", flexShrink: 0 }} />
              <span style={{ flex: 1, textAlign: "left", textDecoration: "line-through", textDecorationColor: "rgba(124, 184, 147, 0.6)" }}>Today's check-in</span>
              <span aria-hidden="true" style={{ color: "#7CB893", fontSize: 14, fontWeight: 800, lineHeight: 1, flexShrink: 0 }}>✓</span>
            </div>
          ) : (
            /*
             * Prominent, not alarming, and one dot rather than two.
             *
             * This was a red-tinted panel with red text. Once the accent became
             * signal red it read as a warning rather than an invitation, and it
             * sat a shade away from the overdue deadline directly above it. A
             * routine daily action should not look like something has gone
             * wrong. The dot on the right still carries "not done yet", which
             * was always the actual signal; the bullet on the left was
             * decorative and became a second red dot saying nothing.
             */
            <button onClick={onStartCheckin} className="btn-glass" style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "12px 16px", fontWeight: 700, fontSize: 14, marginBottom: 14 }}>
              <span style={{ flex: 1, textAlign: "left" }}>Today's check-in</span>
              <span style={{ width: 8, height: 8, borderRadius: 9, background: C.accent, flexShrink: 0 }} />
            </button>
          )}


          <button onClick={onNew} className="newbtn btn-metal" style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "14px 18px", fontWeight: 800, fontSize: 14.5, letterSpacing: "0.01em" }}>
            <span style={{ fontSize: 20, lineHeight: 1, fontWeight: 900, marginRight: 2 }}>+</span> New conversation
          </button>

          <p style={{ ...navLabel, marginTop: 26 }}>Pick up where you left off</p>
          <div style={{ flex: 1, minHeight: 96, overflowY: "auto", margin: "0 -4px", padding: "0 4px" }}>
            {threads.map((t) => {
              const on = view === "chat" && active.id === t.id;
              return (
                <div key={t.id} className="threadrow" style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <button onClick={() => onThread(t.id)} className="navitem" style={{ ...navItem, background: on ? "rgba(255,255,255,0.11)" : "transparent", fontWeight: on ? 600 : 500, padding: "12px 34px 12px 12px", fontSize: 14 }}>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                    <span style={{ fontSize: 11, color: C.faint, fontWeight: 600 }}>{t.lastAt}</span>
                  </button>
                  {/* A sibling, not a child: a button cannot be nested inside a
                      button, and the delete must not also open the thread. */}
                  <button
                    className="thread-delete"
                    aria-label={`Delete conversation: ${t.title}`}
                    title="Delete conversation"
                    onClick={() => setConfirmDelete(t.id)}
                    style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", width: 26, height: 26, display: "grid", placeItems: "center", background: "transparent", border: "none", borderRadius: 6, color: C.faint, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0, fontFamily: "inherit" }}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
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
      {pending && (
        /*
         * A real dialog rather than the row-replacement this used to be.
         * Deleting a conversation is irreversible and now takes the decisions
         * captured from it as well, so it deserves a moment of friction and a
         * plain statement of what goes. A native confirm() would block the
         * page and cannot list any of this.
         */
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-title"
          onClick={() => setConfirmDelete(null)}
          style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.55)", display: "grid", placeItems: "center", padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(420px, 100%)", background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 22, boxShadow: "0 18px 50px rgba(0,0,0,0.45)" }}
          >
            <h2 id="delete-title" style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 700, color: C.ink }}>
              Delete this conversation?
            </h2>
            <p style={{ margin: "0 0 4px", fontSize: 13.5, lineHeight: 1.55, color: C.sub }}>
              <strong style={{ color: C.ink }}>This cannot be undone.</strong> Deleting
              {" "}<span style={{ color: C.ink }}>{pending.title}</span> removes:
            </p>
            <ul style={{ margin: "8px 0 14px", paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7, color: C.sub }}>
              <li>{pending.messages.length} message{pending.messages.length === 1 ? "" : "s"}</li>
              {pendingDecisions > 0 && (
                <li style={{ color: C.ink }}>
                  {pendingDecisions} decision{pendingDecisions === 1 ? "" : "s"} captured here
                </li>
              )}
            </ul>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                className="btn-glass"
                onClick={() => setConfirmDelete(null)}
                style={{ minHeight: 40 }}
              >
                Cancel
              </button>
              <button
                autoFocus
                onClick={() => { const id = pending.id; setConfirmDelete(null); onDeleteThread(id); }}
                style={{ background: C.red, color: "oklch(98% 0 0)", border: "none", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", minHeight: 40 }}
              >
                Delete for good
              </button>
            </div>
          </div>
        </div>
      )}

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
};

/* ---------------- Sharing a single conversation with a coach ----------------
   Conversations are private by default. This is the only way anything a
   founder writes reaches the operating team verbatim, and it is reversible at
   any moment — so the control states plainly which of the two is currently
   true rather than being a bare switch. */
function seenAgo(iso: string): string {
  const then = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `${Math.floor(days / 7)} weeks ago`;
}

/*
 * Sharing something difficult and hearing nothing back is worse than not
 * sharing, so once the team has opened it the founder is told. First read
 * only — they learn it landed, not how often it is looked at.
 */
function ShareToggle({ shared, seenAt, onChange }: { shared: boolean; seenAt?: string | null; onChange: (next: boolean) => void }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.sub }}>
        <span>Let your coach read this one?</span>
        <button
          type="button"
          onClick={() => { onChange(true); setConfirming(false); }}
          style={{ ...shareButtonStyle, borderColor: C.accent, color: C.accent }}
        >
          Share it
        </button>
        <button type="button" onClick={() => setConfirming(false)} style={shareButtonStyle}>
          Cancel
        </button>
      </div>
    );
  }

  /*
   * The resting label is the state; the hover label is the act.
   *
   * It used to be one muted grey pill reading "Private", which told a founder
   * what was true and nothing about what they could do, so nobody found it.
   * Now the pill says what will happen the moment it is pointed at, and the
   * accessible name says it too rather than leaving it to a title attribute.
   */
  const button = (
    <InteractiveHoverButton
      type="button"
      onClick={() => (shared ? onChange(false) : setConfirming(true))}
      emphasis={shared}
      label={shared ? "Shared with your coach" : "Private"}
      action={shared ? "Make it private" : "Share with your coach"}
      aria-label={
        shared
          ? "Shared with your coach. Activate to make this conversation private again."
          : "Private. Activate to share this conversation with your coach."
      }
    />
  );

  if (!shared || !seenAt) return button;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {button}
      <span style={{ fontSize: 11.5, color: C.faint }}>Read by the team {seenAgo(seenAt)}</span>
    </span>
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
  /** No threads and no check-ins yet: they have never seen this screen. */
  firstRun: boolean;
};

/*
 * The composer's idle prompt, in the cohort's own register.
 *
 * Replaces the single "What are you turning over?" — Tai's list, deduplicated
 * ("Let them cook." was in it twice). A new one is drawn each time the app is
 * opened, and again every hour if it is left sitting there, so the same line
 * does not go stale in front of someone who lives in this tab.
 *
 * Only the neutral prompt rotates. Panic and venting keep their own wording:
 * a founder who has told the app they are panicking should not be met with
 * "We're cooked."
 */
/*
 * Thirteen lines were cut from this list on 2026-08-23: "We're cooked.",
 * "It's over.", "Pack it up.", "Massive L.", "Mid.", and the rest of the
 * defeatist ones.
 *
 * This is the most-read string in the product and it is drawn at random before
 * the founder has typed anything, so it cannot know what kind of day they are
 * having. A founder opening the app an hour after losing a pilot was being met
 * with "It's over." The register is right and stays; those particular lines
 * were the product having a joke at the expense of the one moment it exists
 * for. "They cooked." and "You cooked." are compliments in this register and
 * stayed.
 */
const IDLE_PROMPTS = [
  "Who are you cooking?",
  "What are you cooking?",
  "Let them cook.",
  "Who let them cook?",
  "What are they cooking?",
  "What are you serving?",
  "What are they serving?",
  "What's the vibe?",
  "What's the move?",
  "What's good?",
  "What's the tea?",
  "Spill the tea.",
  "They cooked.",
  "You cooked.",
  "We're cooking.",
  "Cook harder.",
  "You ate.",
  "Ate and left no crumbs.",
  "It's giving…",
  "Say less.",
  "Bet.",
  "No cap.",
  "That's cap.",
  "Be so for real.",
  "Bffr.",
  "We're so back.",
  "They're locked in.",
  "Stop yapping.",
  "Let them yap.",
  "Stop glazing.",
  "That's wild.",
  "That's crazy.",
  "Out of pocket.",
  "Lowkey.",
  "Highkey.",
  "Real.",
  "Valid.",
  "Based.",
  "Fire.",
  "Bussin'.",
  "Hits different.",
  "Absolute cinema.",
  "Main character energy.",
  "Touch grass.",
  "Drop the lore.",
  "What's the lore?",
  "Canon event.",
  "Side quest.",
  "Plot twist.",
  "Aura check.",
  "+100 aura.",
  "W or L?",
  "Common W.",
  "Lock in.",
  "Stay locked in.",
  "Built different.",
  "Rent free.",
  "Say it louder.",
  "Be fr.",
  "We listen and we don't judge.",
  "Chat, what are we doing?",
  "Chat, be honest.",
  "Chat, is this real?",
  "Nah, no way.",
  "No shot.",
  "You're wildin'.",
  "Why are they…",
  "Who invited them?",
  "Nobody asked.",
  "Not the…",
  "The audacity.",
  "Go touch grass.",
] as const;

/** Drawn on mount rather than at module load, so a reload is a fresh draw. */
function drawPrompt(): string {
  return IDLE_PROMPTS[Math.floor(Math.random() * IDLE_PROMPTS.length)]!;
}

/**
 * How long a prompt sits before the next one blurs in over it.
 *
 * There used to be a second, hourly timer here, from before the line
 * animated: it existed so a tab left open all afternoon was not frozen on one
 * prompt. The cycle below subsumes it. The only state the hourly timer still
 * reached was a composer focused and empty, where the line is hidden anyway.
 */
const PROMPT_CYCLE_MS = 4200;

/**
 * The idle prompt, one letter at a time.
 *
 * Taken from a supplied AI chat input whose placeholder cycled with a
 * staggered per-letter blur. The idea is the good part; the rest of that
 * component was mic, attachment and search toggles this app has no use for,
 * and motion/react to animate opacity and blur on a span, which CSS has done
 * for years. Each letter carries its own animation-delay.
 *
 * A native placeholder attribute cannot be animated, so this is an overlay,
 * which means keeping it strictly in step with the real one: it is hidden the
 * moment the founder types or focuses, and it never takes a pointer event.
 *
 * It is also aria-hidden, and the textarea keeps a fixed aria-label. Feeding
 * the rotating line to the label instead would rename the field every few
 * seconds, and rename it to things like "Bffr." — a prompt is a nudge, not
 * what the control is called.
 */
function AnimatedPlaceholder({ text, paused }: { text: string; paused: boolean }) {
  if (paused) return null;
  return (
    <span key={text} className="composer-ghost" aria-hidden="true">
      {[...text].map((ch, i) => (
        <span key={i} style={{ animationDelay: `${i * 22}ms` }}>
          {ch === " " ? "\u00A0" : ch}
        </span>
      ))}
    </span>
  );
}

function Chat({ active, threads, setThreads, bumpTheme, addDecision, setVisits, markCheckinDone, userEmail, firstRun }: ChatProps) {
  /* The component is mounted client:only, so drawing at first render cannot
     desync from a server-rendered value — there is no server render. */
  const [idlePrompt, setIdlePrompt] = useState(drawPrompt);
  const [composerFocused, setComposerFocused] = useState(false);

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

  // Declared down here rather than up with the other composer state, because
  // it reads `input`, which is initialised on the line above this one.
  useEffect(() => {
    if (composerFocused || input.length > 0) return;
    const timer = setInterval(() => setIdlePrompt(drawPrompt()), PROMPT_CYCLE_MS);
    return () => clearInterval(timer);
  }, [composerFocused, input.length]);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ kind: "logged"; text: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const counted = useRef(false);
  const checkinInitiated = useRef(false);

  const threadId = existing?.id || null;

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
  // The real system prompt is assembled server-side and never leaves it. This
  // only tells the route which of the two flows to run.
  const sys = isCheckin ? "You are running today's daily check-in." : "";

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
        : [{ id, title, theme: isCheckin ? "Check-in" : (theme || "—"), state: THREAD_STATE, lastAt: "now", messages: finalMsgs, ...(isCheckin ? { kind: "checkin" as const } : {}) }, ...prev];
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
        }, "checkin", callCtx);
        const opener: Msg = { role: "assistant", content: r.voice || "Hey. What's been on top of your mind today?" };
        setMsgs([opener]);
        persistThread([opener], r.theme, "");
      } catch {
        setMsgs([{ role: "assistant", content: "Hey. Let's do today's check-in. What's been on top of your mind today?" }]);
      }
      setBusy(false);
    })();
  }, [isCheckin, msgs.length, busy, sys]);

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
      }, isCheckin ? "checkin" : undefined, callCtx);

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
    } catch (err) {
      const message = err instanceof Error && err.message
        ? err.message
        : advisorErrorMessage(null);
      setMsgs((prev) => prev.map((m, i) => i === prev.length - 1
        ? { role: "assistant" as const, content: message }
        : m));
    }
    setBusy(false);
  };

  return (
    <>
      {/* The context strip: the time-of-day line, plus the sharing control.
          The right padding clears the docked mascot, and is a variable because
          on a phone there is no docked mascot to clear and 132px of it was
          taking a third of the screen. */}
      <div className="context-strip" style={{ flexShrink: 0, borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 16 }}>
        <p style={{ margin: 0, flex: 1, fontStyle: "italic", fontSize: 13.5, lineHeight: 1.5, color: C.sub }}>
          {ctx.clock ? `It's ${ctx.clock}. ` : ""}{ctx.line}
        </p>
        {threadId && userEmail && (
          <ShareToggle
            shared={Boolean(existing?.sharedWithCoach)}
            seenAt={existing?.sharedSeenAt}
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
            <EmptyState firstRun={firstRun} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {msgs.map((m, i) => m.role === "assistant" ? (
                /* No header. Every answer used to carry "THINKING · 05:51 PM"
                   above it, including the one still being written, which named
                   a posture the app no longer has and stamped a time nobody
                   asked for. The wait below says what is happening while it
                   happens; a finished answer needs no label. */
                <div key={i} style={{ alignSelf: "flex-start", maxWidth: "40rem" }}>
                  <div style={{ fontFamily: "var(--font-serif)", fontSize: 18, lineHeight: 1.55, color: C.ink }} dangerouslySetInnerHTML={{ __html: markdownStyles + formatMarkdown(m.content) }} />
                </div>
              ) : (
                <div key={i} style={{ alignSelf: "flex-end", maxWidth: "32rem", background: C.bubble, borderRadius: "14px 14px 4px 14px", padding: "10px 14px", fontSize: 15, lineHeight: 1.55, color: C.ink }}>{m.content}</div>
              ))}
              {busy && (
                /* Was an unlabelled pulsing dot. A founder waiting on an answer
                   should be told what is happening, not shown a light. */
                <div
                  style={{ alignSelf: "flex-start", padding: "6px 4px", display: "flex", alignItems: "center", gap: 9 }}
                  role="status"
                  aria-live="polite"
                >
                  <span className="pulse-dot" style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: C.accent, flexShrink: 0 }} />
                  <TextShimmer duration={1.5} className="composer-wait">Generating answers</TextShimmer>
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
          <div className="composer-box" style={{ display: "flex", gap: 10, alignItems: "flex-end", background: C.card, border: "1px solid var(--line-strong)", borderRadius: 12, padding: "10px 10px 10px 14px", transition: "border-color .15s ease" }}>
            <div style={{ position: "relative", flex: 1, display: "flex" }}>
              <AnimatedPlaceholder text={idlePrompt} paused={composerFocused || input.length > 0} />
              <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} rows={1}
                onFocus={() => setComposerFocused(true)}
                onBlur={() => setComposerFocused(false)}
                aria-label="Message Sprint Buddy"
                style={{ flex: 1, background: "transparent", border: "none", padding: "10px 2px", color: C.ink, fontSize: 16, lineHeight: 1.5, resize: "none", fontFamily: "inherit", minHeight: 44, maxHeight: 160, outline: "none" }} />
            </div>
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

type TimeCtx = { clock: string; line: string; dotColor: string };

/*
 * The six types, the thirty items and the scoring live in lib/workingGenius.ts
 * so that the browser and the API score against one implementation. Only the
 * palette stays here, because it is presentation and the rest is not.
 */
/*
 * Six types, and after the recolour only five hues to tell them apart with.
 *
 * Blue used to carry discernment. With the accent now red, discernment and
 * invention both landed on a red and sat next to each other in the wheel. They
 * are separated as far as the remaining palette allows: the deep signal red
 * against the softer coral. It is the weakest pair here and it is worth a
 * proper sixth hue if this wheel matters, but nothing is encoded by colour
 * alone. Every band and every gear carries its name.
 */
const WG_COLOR: Record<WorkingGeniusId, { tint: string; accent: string }> = {
  wonder: { tint: "rgba(247, 225, 89, 0.16)", accent: C.yellow },
  invention: { tint: "rgba(94, 106, 210, 0.16)", accent: C.accent },
  discernment: { tint: "rgba(253, 99, 96, 0.16)", accent: C.red },
  galvanizing: { tint: "rgba(255, 255, 255, 0.10)", accent: C.white },
  enablement: { tint: "rgba(124, 184, 147, 0.16)", accent: "#7CB893" },
  tenacity: { tint: "rgba(255, 255, 255, 0.08)", accent: C.ink },
};

const WG_BAND_META: Record<WorkingGeniusBand, { title: string; blurb: string; accent: string }> = {
  genius: {
    title: "Working genius",
    blurb: "Gifted at it and energised by it. Give yourself more of this.",
    accent: "#7CB893",
  },
  competency: {
    title: "Working competency",
    blurb: "You can do it well enough and it does not cost you much. Fine in moderation.",
    accent: C.yellow,
  },
  frustration: {
    title: "Working frustration",
    blurb: "It drains you, whether or not you are good at it. Get help here first.",
    accent: C.red,
  },
};

/**
 * The five-second check-in.
 *
 * Five labels, not a 0-10 scale. A number asks the founder to calibrate against
 * an invisible standard; a word they recognise does not, and the point of this
 * control is that it costs no thought. The values behind them are attention
 * needed rather than happiness, matching the signal the full check-in produces,
 * so both kinds of row plot on the same trend.
 *
 * The optional line is deliberately optional and deliberately one line. A
 * founder with ninety seconds should be able to register something real; a
 * founder with fifteen minutes should be using the full check-in instead.
 */
/**
 * The two daily actions, on a phone.
 *
 * Below 700px the sidebar collapses to zero width, and both the check-in and
 * the whole deadline list live inside it. That left the device a founder
 * actually carries between sessions showing nothing they could act on. This
 * strip is hidden entirely on wider screens, where the sidebar already does
 * the job properly.
 */
function MobileActions({
  checkinDone,
  onStartCheckin,
  deadlines,
  onOpenSidebar,
}: {
  checkinDone: boolean;
  onStartCheckin: () => void;
  deadlines: DeadlinesState;
  onOpenSidebar: () => void;
}) {
  const next = nextUp(deadlines);
  const overdue = next?.item.group === "overdue";

  /*
   * Two rows, not one.
   *
   * Measured at 390px with everything on a single line: the deadline collapsed
   * to 26 pixels, because it is the only flexible item and the five mood
   * buttons take what they need first. The one thing a founder opens their
   * phone to see was the one thing squeezed out.
   */
  return (
    <div className="mobile-actions">
      <div className="mobile-actions-row">
        {checkinDone ? (
          <span className="mobile-actions-done">
            <span aria-hidden="true">✓</span> Checked in
          </span>
        ) : (
          <button type="button" onClick={onStartCheckin} className="mobile-actions-checkin">
            Today&rsquo;s check-in
          </button>
        )}

        {next && (
          <button
            type="button"
            onClick={onOpenSidebar}
            className="mobile-actions-next"
            style={overdue ? { color: C.red, borderColor: "rgba(253, 99, 96, 0.4)" } : undefined}
          >
            <span className="mobile-actions-title">{next.item.title}</span>
            <span className="mobile-actions-when">{next.label}</span>
            {next.more > 0 && <span className="mobile-actions-more">+{next.more}</span>}
          </button>
        )}
      </div>

    </div>
  );
}

/*
 * The empty chat.
 *
 * There used to be a rotating greeting here at 38px ("What's the move?",
 * "Let's go.") over "Say what's going on." in italics. Tai: not needed. It
 * asked the founder a question the composer already asks, in type large enough
 * to be the page's subject, and then the composer asked it again three inches
 * below.
 *
 * What is left is the thing that only appears once and actually carries
 * information.
 */
function EmptyState({ firstRun }: { firstRun: boolean }) {
  if (!firstRun) return null;

  return (
    <div className="rise" style={{ paddingTop: 30 }}>
      {/*
        Shown once, on a genuinely empty account.

        A founder used to arrive here straight from setting a password, with no
        idea what this was for and no statement that it was private. The
        privacy promise existed only on the sign-in page they had already left.
        Two sentences, then it never appears again: the second visit is not the
        moment to explain the product.
      */}
      <div
        style={{
          maxWidth: 520,
          padding: "14px 16px",
          border: `1px solid ${C.line}`,
          borderRadius: 10,
          background: "rgba(255,255,255,0.03)",
        }}
      >
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: C.sub }}>
          This is your space to think out loud. Sprint Buddy is software, not a
          person, and it carries what this programme&rsquo;s mentors teach.
        </p>
        <p style={{ margin: "8px 0 0", fontSize: 14.5, lineHeight: 1.6, color: C.sub }}>
          <strong style={{ color: C.ink }}>Nothing here is read by the team</strong> unless
          you share a conversation on purpose. Start anywhere, or use today&rsquo;s
          check-in.
        </p>
      </div>
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
  takes,
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
  takes?: Array<{ takenOn: string; result: WorkingGeniusResult }>;
  initialWorkingGenius?: {
    primary: string;
    counts: Record<string, number>;
    completedAt: string;
    result?: WorkingGeniusResult;
  };
}) {
  const openCount = decisions.filter((d) => d.status === "open").length;
  const nextOpenDecision = decisions.find((d) => d.status === "open") || null;
  const latestCheckin = checkins[0] || null;
  const latestCheckinParts = latestCheckin ? splitCheckinPrompt(latestCheckin.prompt) : null;
  /* The oldest dated check-in. Was computed inside the printable record; the
     counts it belongs with now sit at the top of the page. */
  const startedOn = useMemo(() => {
    const dated = checkins.filter((c) => c.createdAt).map((c) => asDate(c.createdAt!));
    const first = dated.length ? dated[dated.length - 1]! : null;
    return first ? first.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;
  }, [checkins]);

  /* Open first. The page used to carry a separate "open loop to close next"
     row naming the first one; putting them at the top of the list says the
     same thing without a second copy of the decision. */
  const orderedDecisions = useMemo(
    () => [...decisions].sort((a, b) => Number(a.status === "closed") - Number(b.status === "closed")),
    [decisions],
  );
  const topTheme = useMemo(() => {
    const m: Record<string, number> = {};
    threads.forEach((t) => { m[t.theme] = (m[t.theme] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  }, [threads]);

  /*
   * Three states: not started, mid-assessment, and scored. The scored result
   * is whatever the server computed. The browser never scores, so a founder
   * and the operating team are always looking at the same numbers.
   *
   * A row saved by the six-item quiz this replaced arrives without `result`.
   * That is shown as an old result to be retaken rather than padded out with
   * bands the six items could not support.
   */
  const [wgResult, setWgResult] = useState<WorkingGeniusResult | null>(
    initialWorkingGenius?.result ?? null,
  );
  const [wgLegacy, setWgLegacy] = useState<boolean>(
    Boolean(initialWorkingGenius && !initialWorkingGenius.result),
  );
  /*
   * Retakes are pinned to three dates the whole cohort shares. The instrument
   * measures where energy goes, which does not move week to week, so a retake
   * the morning after a bad session would measure the session. Enforced on the
   * server too; this only decides what the card says.
   */
  const today = helsinkiDay(new Date());
  const lastTakenOn = wgResult?.completedAt ?? initialWorkingGenius?.completedAt ?? null;
  const canRetake = retakeOpen(lastTakenOn, today);
  const nextWindow = nextRetakeDate(lastTakenOn);

  const [wgStarted, setWgStarted] = useState(false);
  /** The consent card is open. Nothing is answered or saved until it is not. */
  const [wgConsenting, setWgConsenting] = useState(false);
  const [wgIndex, setWgIndex] = useState(0);
  const [wgAnswers, setWgAnswers] = useState<Record<string, WorkingGeniusAnswer>>({});
  /* The open box for the current item, kept out of `wgAnswers` until it is
     committed so that typing does not re-render every option on every key. */
  const [wgText, setWgText] = useState("");
  const [wgHatch, setWgHatch] = useState(false);
  const [wgSaving, setWgSaving] = useState(false);
  const [wgError, setWgError] = useState<string | null>(null);
  /** Set when the server refuses because the window is shut. Not retryable. */
  const [wgClosed, setWgClosed] = useState<string | null>(null);

  const wgItem = WORKING_GENIUS_ITEMS[wgIndex];

  const submitWorkingGenius = async (answers: Record<string, WorkingGeniusAnswer>) => {
    if (!userEmail) return;
    setWgSaving(true);
    setWgError(null);
    try {
      const result = await saveWorkingGenius(userEmail, answers);
      setWgResult(result);
      setWgLegacy(false);
      setWgStarted(false);
    } catch (error) {
      /*
       * A 409 is the retake window, and it is permanent until a date. Saying
       * "Could not save that" next to a Try again that can never work is the
       * worst possible answer to somebody who has just spent six minutes on
       * thirty questions, so the server's own sentence is shown and the retry
       * is withdrawn.
       */
      if (error instanceof PersistenceError && error.status === 409) {
        setWgClosed(error.serverMessage ?? "This one is not open yet.");
        setWgStarted(false);
      } else {
        // The answers stay in state, so Try again resubmits rather than
        // restarting thirty items.
        setWgError("Could not save that. Your answers are still here.");
      }
    } finally {
      setWgSaving(false);
    }
  };

  /**
   * Commits an answer and moves on.
   *
   * Whatever is in the open box goes with it, whether they picked an option or
   * took the "neither" hatch. Text alongside a real choice is context; text
   * with "neither" is the answer. The server decides which type either one
   * describes, once, at submission.
   */
  const answerWorkingGenius = (choice: WorkingGeniusId | "neither") => {
    if (!wgItem || wgSaving) return;
    const typed = wgText.trim();
    /* "Neither" with nothing written is not an answer, it is a skipped
       question. The box is the whole point of that option. */
    if (choice === "neither" && !typed) return;

    const answer: WorkingGeniusAnswer = { choice, ...(typed ? { text: typed } : {}) };
    const next = { ...wgAnswers, [wgItem.id]: answer };
    setWgAnswers(next);
    setWgText("");
    setWgHatch(false);

    if (wgIndex + 1 >= WORKING_GENIUS_ITEMS.length) {
      void submitWorkingGenius(next);
    } else {
      setWgIndex(wgIndex + 1);
    }
  };

  /* Going back restores what they wrote, so Back is a revision rather than a
     way to lose a sentence you spent a minute on. */
  const backWorkingGenius = () => {
    const previous = WORKING_GENIUS_ITEMS[wgIndex - 1];
    const saved = previous ? wgAnswers[previous.id] : undefined;
    setWgText(saved?.text ?? "");
    setWgHatch(saved?.choice === "neither");
    setWgIndex(wgIndex - 1);
  };

  /*
   * Both entry points open the consent card first.
   *
   * Nothing starts until the founder has read what happens to the result and
   * said yes, including a retake: consent is to a particular arrangement, and
   * the arrangement is the same every time it is asked.
   */
  const askWorkingGenius = () => setWgConsenting(true);

  const startWorkingGenius = () => {
    setWgConsenting(false);
    setWgAnswers({});
    setWgText("");
    setWgHatch(false);
    setWgIndex(0);
    setWgError(null);
    setWgStarted(true);
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


  return (
    <div className="rise" style={{ maxWidth: 720, margin: "0 auto", padding: "60px 28px 90px" }}>
      <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap", margin: "0 0 28px" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(1.75rem, 3.4vw, 2rem)", lineHeight: 1.15, letterSpacing: "var(--track-display)", margin: 0, color: C.ink }}>Your week.</h1>
        {/* Was down beside "Your record" at the foot of the page, which is a
            long way to scroll for the page's only export. */}
        {(checkins.length > 0 || threads.length > 0) && (
          <button type="button" className="record-print btn-glass" onClick={() => window.print()}>
            Print or save as PDF
          </button>
        )}
      </header>

      <p style={{ margin: "0 0 30px", fontSize: 15, lineHeight: 1.6, color: C.sub, letterSpacing: "var(--track-body)" }}>
        You came here <Stat>{visits}</Stat> times. Most of it circled <Stat c={themeColor(topTheme)}>{topTheme}</Stat>. <Stat c={C.yellow}>{openCount}</Stat> {openCount === 1 ? "decision is" : "decisions are"} still open.
      </p>

      {/* The counts, hoisted out of the printable record at the foot of the
          page. They were the summary, and the summary was the last thing on
          screen. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 14, margin: "0 0 12px", paddingTop: 22, borderTop: `1px solid ${C.line}` }}>
        <RecordStat n={checkins.length} label={checkins.length === 1 ? "check-in" : "check-ins"} />
        <RecordStat n={threads.length} label={threads.length === 1 ? "conversation" : "conversations"} />
        <RecordStat n={decisions.length} label={decisions.length === 1 ? "decision" : "decisions"} />
        <RecordStat n={decisions.filter((d) => d.status === "closed").length} label="closed" />
      </div>
      {startedOn && (
        <p style={{ margin: "0 0 44px", fontSize: 13, color: C.faint }}>Started {startedOn}.</p>
      )}

      {/* One card, not two. "The sprint so far" and "Check-in memory" sat
          stacked, and between them they printed the mood score three times —
          once in the chart, once as a signal line, once in a "Pattern this
          week" table above. It is one thing: how the weeks have felt. */}
      <div style={{ margin: "0 0 44px", padding: "20px 22px", border: `1px solid ${C.line}`, borderRadius: 14, background: "rgba(255,255,255,0.035)" }}>
        <p style={{ ...kicker, marginBottom: 14 }}>How it has felt</p>
        <Arc checkins={checkins} />
        {latestCheckin && (
          <blockquote style={{ margin: "18px 0 0", paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
            <p style={{ margin: 0, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 17, lineHeight: 1.5, color: C.ink }}>
              {latestCheckinParts?.summary}
            </p>
            {latestCheckin.mood != null && (
              <p style={{ margin: "10px 0 0", color: signalColor(latestCheckin.mood), fontSize: 13, fontWeight: 700 }}>
                {signalLabel(latestCheckin.mood)} · {latestCheckin.mood}/100{latestCheckinParts?.signal ? ` — ${latestCheckinParts.signal}` : ""}
              </p>
            )}
          </blockquote>
        )}
        {!latestCheckin && (
          <p style={{ margin: "14px 0 0", fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15, color: C.faint }}>
            No completed check-ins yet. The next one starts this off.
          </p>
        )}
      </div>

      <p style={{ ...kicker, margin: "0 0 14px" }}>On your mind</p>
      {themes.length === 0 ? (
        <p style={{ margin: 0, paddingTop: 14, borderTop: `1px solid ${C.line}`, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 14.5, color: C.faint }}>
          Nothing tracked yet. Themes appear here once you've talked a few things through.
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1px solid ${C.line}` }}>
          {themes.map((t) => <ThemeRow key={t.name} t={t} />)}
        </ul>
      )}

      <p style={{ ...kicker, marginTop: 44, marginBottom: 14 }}>Decisions</p>
      {decisions.length === 0 ? (
        <p style={{ margin: 0, paddingTop: 14, borderTop: `1px solid ${C.line}`, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 14.5, color: C.faint }}>No decisions tracked yet. They'll appear here when you weigh one in chat.</p>
      ) : (
        <ol style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1px solid ${C.line}` }}>
          {orderedDecisions.map((d) => <DecisionRow key={d.id} d={d} onClose={closeDecision} />)}
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
            <p style={{ ...kicker, marginBottom: 6 }}>Working style</p>
            <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", color: C.ink }}>
              {wgResult ? "Where your energy goes" : "Find where your energy goes"}
            </h2>
          </div>
          {wgResult ? (
            canRetake ? (
              <button
                type="button"
                onClick={askWorkingGenius}
                style={{
                  background: "none", border: `1px solid ${C.accent}`, borderRadius: 999,
                  padding: "7px 15px", color: C.accent, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                }}
              >
                Retake it now
              </button>
            ) : nextWindow ? (
              <span
                title="Locked until the next window so the retake measures you, not the week you have just had"
                style={{ fontSize: 12.5, color: C.faint, textAlign: "right", lineHeight: 1.45 }}
              >
                Next on {readableWindow(nextWindow)}
                <br />
                <span style={{ color: C.sub }}>
                  {daysUntil(nextWindow, today)} {daysUntil(nextWindow, today) === 1 ? "day" : "days"}
                </span>
              </span>
            ) : (
              <span style={{ fontSize: 12.5, color: C.faint }}>Last one taken</span>
            )
          ) : (
            <span style={{ fontSize: 12.5, color: C.sub, fontFamily: "var(--font-serif)", fontStyle: "italic" }}>
              Thirty either-or questions. About six minutes.
            </span>
          )}
        </div>

        {wgClosed && (
          <p style={{ margin: "14px 0 0", fontSize: 13.5, color: C.yellow, lineHeight: 1.6 }}>
            {wgClosed} Your answers were not saved.
          </p>
        )}

        {(!wgStarted || wgResult) && <WgPrivateNote />}
        {wgConsenting && (
          <WgConsent onAgree={startWorkingGenius} onCancel={() => setWgConsenting(false)} />
        )}

        {wgResult ? (
          <div style={{ marginTop: 20, display: "grid", gap: 14 }}>
            {(["genius", "competency", "frustration"] as WorkingGeniusBand[]).map((band) => (
              <WgBandCard key={band} band={band} ids={wgResult.bands[band]} />
            ))}
            <WgRanking result={wgResult} />
            <WgCaveats result={wgResult} />
            <WgDownload />
            <WgHistory takes={takes ?? []} />
          </div>
        ) : wgStarted && wgItem ? (
          <div style={{ marginTop: 20, display: "grid", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: C.faint }}>
                {wgIndex + 1} of {WORKING_GENIUS_ITEMS.length}
              </span>
              {wgIndex > 0 && (
                <button
                  type="button"
                  onClick={backWorkingGenius}
                  style={{ background: "none", border: "none", color: C.faint, fontSize: 12.5, cursor: "pointer", padding: 0 }}
                >
                  ← Back
                </button>
              )}
            </div>
            <div style={{ height: 4, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <div style={{ width: `${(wgIndex / WORKING_GENIUS_ITEMS.length) * 100}%`, height: "100%", background: C.accent, transition: "width 200ms ease" }} />
            </div>

            {wgIndex === 0 && (
              <p className="wg-preamble">{INSTRUMENT_PREAMBLE}</p>
            )}

            {/*
              * The question is not a card.
              *
              * It used to be: same padding, same radius, same border and the
              * same weight as the options, two pixels apart in size. Nothing
              * told the eye which one was being asked and which were the things
              * to click, thirty times in a row. It is display type on the
              * ground now, and the answers are the only surfaces on screen.
              */}
            <div className="wg-ask">
              <span className="wg-kicker">Which one pulls you?</span>
              <p className="wg-prompt">{wgItem.prompt}</p>
            </div>

            <div className="wg-options">
              {/*
                * The option's type is deliberately not labelled here. The old
                * quiz printed "WONDER" above each choice, which told the
                * founder exactly what each answer scored and turned the
                * instrument into a self-portrait. The types appear in the
                * result, where knowing them costs nothing.
                */}
              {wgItem.options.map((option, i) => {
                const picked = wgAnswers[wgItem.id]?.choice === option.id;
                const key = i === 0 ? "A" : "B";
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={wgSaving}
                    onClick={() => answerWorkingGenius(option.id)}
                    className={`wg-option${picked ? " is-picked" : ""}`}
                    aria-keyshortcuts={key}
                  >
                    <span className="wg-option-pane" aria-hidden="true" />
                    <span className="wg-option-bevel" aria-hidden="true" />
                    <span className="wg-option-body">
                      <span className="wg-option-key" aria-hidden="true">{key}</span>
                      <span className="wg-option-label">{option.label}</span>
                    </span>
                  </button>
                );
              })}

              {/*
                * The escape hatch, and deliberately the third option rather
                * than a box on every item. If every question demands typing,
                * completion craters and what comes back is the word "both",
                * which is less informative than a forced choice.
                */}
              <button
                type="button"
                disabled={wgSaving}
                onClick={() => setWgHatch(true)}
                className={`wg-option wg-option--hatch${wgHatch ? " is-open" : ""}`}
                aria-expanded={wgHatch}
              >
                <span className="wg-option-pane" aria-hidden="true" />
                <span className="wg-option-bevel" aria-hidden="true" />
                <span className="wg-option-body">
                  <span className="wg-option-key" aria-hidden="true">C</span>
                  <span className="wg-option-label">Neither, or it depends. Here is what I actually do:</span>
                </span>
              </button>
            </div>

            {/*
              * Recessed rather than raised: an inset reads as somewhere to type,
              * a pane reads as something to click. Same material, opposite
              * affordance.
              *
              * One line that grows. A large empty textarea reads as homework
              * and gets skipped.
              */}
            <div className={`wg-write${wgHatch ? " is-open" : ""}`}>
              <label className="wg-write-label" htmlFor="wg-text">
                {wgHatch ? "What actually happens?" : "Want to add context? (optional)"}
              </label>
              <textarea
                id="wg-text"
                className="wg-write-box"
                rows={1}
                value={wgText}
                maxLength={MAX_WG_TEXT_CHARS}
                onChange={(e) => {
                  setWgText(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
                }}
                placeholder="e.g. I usually wait to see if someone else steps up, then take over if nobody does."
              />
              {wgHatch && (
                <div className="wg-write-actions">
                  <button
                    type="button"
                    className="wg-write-cancel btn-glass"
                    onClick={() => { setWgHatch(false); setWgText(""); }}
                  >
                    Back to the two options
                  </button>
                  <button
                    type="button"
                    className="wg-write-send btn-metal"
                    disabled={wgSaving || !wgText.trim()}
                    onClick={() => answerWorkingGenius("neither")}
                  >
                    {wgIndex + 1 >= WORKING_GENIUS_ITEMS.length ? "Finish" : "Next"}
                  </button>
                </div>
              )}
            </div>

            {/* One instance for the quiz, with its own id. Filter ids are
                global to the document; two families sharing one is how a pane
                silently loses its refraction when the other unmounts. */}
            <GlassFilter id="wg-glass" />

            {wgSaving && (
              <p style={{ margin: 0, fontSize: 13, color: C.faint }}>Scoring…</p>
            )}
            {wgError && (
              <p style={{ margin: 0, fontSize: 13, color: C.red }}>
                {wgError}{" "}
                <button
                  type="button"
                  onClick={() => void submitWorkingGenius(wgAnswers)}
                  style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", padding: 0, fontSize: 13, textDecoration: "underline" }}
                >
                  Try again
                </button>
              </p>
            )}
          </div>
        ) : (
          <div style={{ marginTop: 20, display: "grid", gap: 16 }}>
            <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.55, color: C.sub, fontFamily: "var(--font-serif)" }}>
              Six kinds of work. Two you are gifted at <em>and</em> energised by, two you can do
              without much cost, two that drain you whether or not you are good at them. The point
              is not the label. It is knowing which two to stop volunteering for, and who on your
              team should be doing them instead.
            </p>
            {wgLegacy && initialWorkingGenius && (
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: C.faint, padding: "12px 14px", borderRadius: 12, border: `1px solid ${C.line}`, background: "rgba(0,0,0,0.2)" }}>
                You took the earlier six-question version on {initialWorkingGenius.completedAt}, which
                only ever named one type and could not compare all six. Retaking it gives you the
                full ranking.
              </p>
            )}
            <div>
              <button
                type="button"
                className="btn-metal"
                onClick={askWorkingGenius}
                disabled={!userEmail}
                style={{ padding: "12px 22px", fontSize: 14.5, fontWeight: 700 }}
              >
                {wgLegacy ? "Retake it properly" : "Start"}
              </button>
            </div>
          </div>
        )}
      </div>

      <SprintRecord
        threads={threads}
        decisions={decisions}
        checkins={checkins}
        themes={themes}
        result={wgResult}
      />

      <p style={{ marginTop: 44, paddingTop: 22, borderTop: `1px solid ${C.line}`, color: C.faint, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 14, lineHeight: 1.5 }}>
        Open loops come back as soft check-ins in the chat. That is how they get closed.
      </p>
    </div>
  );
}

/**
 * The record of the sprint, printable.
 *
 * The programme ends and there is nothing to take away from it. This is the
 * closing artefact, assembled entirely from what the founder actually did:
 * counted, not narrated. Nothing here is generated by a model, so there is
 * nothing in it that can be wrong about their twelve weeks.
 *
 * Visible from week one rather than unlocked at the end. A summary that appears
 * only once it is too late to influence is a worse thing than one that fills in
 * while you watch.
 */
function SprintRecord({
  threads,
  decisions,
  checkins,
  themes,
  result,
}: {
  threads: Thread[];
  decisions: Decision[];
  checkins: Checkin[];
  themes: ThemeArc[];
  result: WorkingGeniusResult | null;
}) {
  const closed = decisions.filter((d) => d.status === "closed");
  const dated = checkins.filter((c) => c.createdAt).map((c) => asDate(c.createdAt!));
  const first = dated.length ? dated[dated.length - 1]! : null;
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const top = themes
    .filter((t) => t.arc.reduce((sum, n) => sum + n, 0) > 0)
    .slice(0, 4)
    .map((t) => t.name);

  const nothingYet = !checkins.length && !threads.length;

  return (
    /*
     * Print only.
     *
     * On screen this repeated the page above it almost line for line: the same
     * four counts, the same theme list, the same closed decisions. It was the
     * last thing a founder scrolled to and it told them nothing they had not
     * just read.
     *
     * It still exists because it is the thing that prints — the @media print
     * rule below hides everything except .sprint-record — and a printed sheet
     * does need the whole record on one page. So it stays complete, and stays
     * off the screen. The button that triggers it moved up to the page header.
     */
    <section className="sprint-record" style={{ marginTop: 44, paddingTop: 26, borderTop: `2px solid ${C.line}` }}>
      <h2 style={{ margin: "0 0 6px", fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: C.ink }}>
        Your record
      </h2>
      <p style={{ margin: "0 0 18px", fontSize: 13.5, color: C.faint, lineHeight: 1.6 }}>
        Yours to keep. Counted from what you did, not written about you.
      </p>

      {nothingYet ? (
        <p style={{ margin: 0, fontSize: 13.5, color: C.faint }}>This fills in as you go.</p>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 14, marginBottom: 20 }}>
            <RecordStat n={checkins.length} label={checkins.length === 1 ? "check-in" : "check-ins"} />
            <RecordStat n={threads.length} label={threads.length === 1 ? "conversation" : "conversations"} />
            <RecordStat n={decisions.length} label={decisions.length === 1 ? "decision" : "decisions"} />
            <RecordStat n={closed.length} label="closed" />
          </div>

          {first && (
            <p style={{ margin: "0 0 16px", fontSize: 13.5, color: C.sub }}>
              Started {fmt(first)}.
            </p>
          )}

          {top.length > 0 && (
            <p style={{ margin: "0 0 16px", fontSize: 14, color: C.sub, lineHeight: 1.6 }}>
              <strong style={{ color: C.ink }}>What kept coming up:</strong> {top.join(", ")}.
            </p>
          )}

          {result && (
            <p style={{ margin: "0 0 16px", fontSize: 14, color: C.sub, lineHeight: 1.6 }}>
              <strong style={{ color: C.ink }}>Where your energy goes:</strong>{" "}
              {result.bands.genius.map((id) => typeById(id).label).join(" and ")}, with{" "}
              {result.bands.frustration.map((id) => typeById(id).label).join(" and ")} draining you.
            </p>
          )}

          {closed.length > 0 && (
            <>
              <p style={{ ...kicker, margin: "22px 0 10px" }}>Decisions you closed</p>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
                {closed.slice(0, 12).map((d) => (
                  <li key={d.id} style={{ fontSize: 13.5, lineHeight: 1.55, color: C.sub, borderLeft: `2px solid ${C.line}`, paddingLeft: 12 }}>
                    <span style={{ color: C.ink }}>{d.summary}</span>
                    {d.outcome ? <> {"\u2014"} {d.outcome}</> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

function RecordStat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <p style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 800, color: C.ink, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{n}</p>
      <p style={{ margin: "4px 0 0", fontSize: 12, color: C.faint, letterSpacing: 0.3 }}>{label}</p>
    </div>
  );
}

/* ------------------------------- working style result -------------------- */

function WgGear({ id, size = 34 }: { id: WorkingGeniusId; size?: number }) {
  const { accent, tint } = WG_COLOR[id];
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, borderRadius: 999, display: "grid", placeItems: "center",
        background: tint, border: `1px solid ${accent}`, color: accent,
        fontWeight: 800, fontSize: Math.round(size * 0.42), flexShrink: 0,
      }}
    >
      {typeById(id).letter}
    </span>
  );
}

function WgBandCard({ band, ids }: { band: WorkingGeniusBand; ids: WorkingGeniusId[] }) {
  const meta = WG_BAND_META[band];
  return (
    <section
      style={{
        padding: "18px", borderRadius: 14, border: `1px solid ${C.line}`,
        background: "rgba(0,0,0,0.2)", display: "grid", gap: 15,
      }}
    >
      <div>
        <p style={{ margin: 0, fontSize: 11.5, letterSpacing: 2, textTransform: "uppercase", fontWeight: 800, color: meta.accent }}>
          {meta.title}
        </p>
        <p style={{ margin: "5px 0 0", fontSize: 13, color: C.faint }}>{meta.blurb}</p>
      </div>
      {ids.map((id) => {
        const type = typeById(id);
        return (
          <div key={id} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <WgGear id={id} />
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: C.ink }}>{type.label}</p>
              <p style={{ margin: "3px 0 0", fontSize: 14.5, lineHeight: 1.45, color: C.sub, fontFamily: "var(--font-serif)" }}>
                {bandCopy(type, band)}
              </p>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function WgRanking({ result }: { result: WorkingGeniusResult }) {
  const max = WORKING_GENIUS_ITEMS.length / WORKING_GENIUS_TYPES.length * 2; // 10
  return (
    <section style={{ padding: "18px", borderRadius: 14, border: `1px solid ${C.line}`, background: "rgba(0,0,0,0.2)", display: "grid", gap: 11 }}>
      <p style={{ margin: "0 0 3px", fontSize: 11.5, letterSpacing: 2, textTransform: "uppercase", color: C.faint }}>
        All six, by how often you chose them
      </p>
      {result.ranking.map((id, i) => {
        const type = typeById(id);
        const score = result.counts[id];
        return (
          <div key={id} style={{ display: "grid", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12.5, color: C.sub }}>
              <span>
                <span style={{ color: C.faint, marginRight: 7 }}>{i + 1}</span>
                {type.label}
              </span>
              <span style={{ color: C.faint }}>{score}/{max}</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <div
                style={{
                  width: `${Math.max(2, (score / max) * 100)}%`, height: "100%", borderRadius: 999,
                  background: WG_COLOR[id].accent, boxShadow: `0 0 10px ${WG_COLOR[id].accent}`,
                }}
              />
            </div>
          </div>
        );
      })}
    </section>
  );
}

/**
 * Says out loud where the result is soft.
 *
 * Every question was asked twice, so we know how often the founder contradicted
 * themselves, and we know whether a band boundary was decided by the answers or
 * by a tie-break. Withholding that would make a coin toss look like a finding,
 * which is the failure mode of every pop personality test.
 */
/**
 * The founder-only promise, stated where it is relied on.
 *
 * Written plainly and without hedging because it is enforced rather than
 * aspirational: the read is owner-only in the API and
 * test/working-genius-privacy.test.ts fails if an organizer can reach it.
 * Softening the wording would be the tell that somebody had stopped being sure.
 */
/**
 * What moved between takes.
 *
 * The reason the retakes are spaced across the sprint at all. One take is a
 * label; four are a record of whether the work changed how a founder spends
 * their energy, which is the only interesting question the instrument can
 * answer.
 *
 * Shows nothing until there are two, and says plainly when nothing changed.
 * A profile that reports movement every time is measuring noise.
 */
/**
 * The way out to the printable report.
 *
 * A link, not a fetch. /report renders from the session and nothing else, and
 * the founder's browser turns it into a PDF, so no document containing a
 * private result is ever built on the server or stored anywhere.
 */
function WgDownload({ takenOn }: { takenOn?: string }) {
  return (
    <a
      className="glass-button wg-download"
      href={takenOn ? `/report?take=${encodeURIComponent(takenOn)}` : "/report"}
      target="_blank"
      rel="noopener"
    >
      <span className="glass-button-pane" aria-hidden="true" />
      <span className="glass-button-bevel" aria-hidden="true" />
      <span className="glass-button-label">Download your report</span>
    </a>
  );
}

function WgHistory({ takes }: { takes: Array<{ takenOn: string; result: WorkingGeniusResult }> }) {
  if (takes.length < 2) return null;

  const label = (ids: WorkingGeniusId[]) => ids.map((id) => typeById(id).label).join(" + ");
  const first = takes[0]!;
  const last = takes[takes.length - 1]!;
  const moved = label(first.result.bands.genius) !== label(last.result.bands.genius);

  return (
    <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
      <p style={{ ...kicker, marginBottom: 12 }}>Across the sprint</p>

      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
        {takes.map((t, i) => (
          <li key={t.takenOn} style={{ display: "grid", gridTemplateColumns: "5.5rem 1fr", gap: 12, alignItems: "baseline" }}>
            <span style={{ fontSize: 12, color: C.faint, fontVariantNumeric: "tabular-nums" }}>
              {readableWindow(t.takenOn)}
            </span>
            <span style={{ fontSize: 13.5, color: i === takes.length - 1 ? C.ink : C.sub }}>
              {label(t.result.bands.genius)}{" "}
              {/* Any past take is printable, not just the current one. */}
              <a
                href={`/report?take=${encodeURIComponent(t.takenOn)}`}
                target="_blank"
                rel="noopener"
                style={{ marginLeft: 6, fontSize: 12, color: C.faint, textDecoration: "underline", textUnderlineOffset: 3 }}
              >
                report
              </a>
            </span>
          </li>
        ))}
      </ol>

      <p style={{ margin: "14px 0 0", fontSize: 13, color: C.sub, lineHeight: 1.6 }}>
        {moved
          ? `Your top two moved from ${label(first.result.bands.genius)} to ${label(last.result.bands.genius)}. Worth asking whether the work changed or you did.`
          : `Your top two have not moved since ${readableWindow(first.takenOn)}. That is the usual outcome and it is not a failure of the sprint.`}
      </p>
    </div>
  );
}

/** "8 October", which is what a person reads, not what a machine stores. */
function readableWindow(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}

function WgPrivateNote() {
  return (
    <p
      style={{
        margin: "16px 0 0",
        fontSize: 12.5,
        lineHeight: 1.6,
        color: C.sub,
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
      }}
    >
      The operating team can see your profile — the six ranked, and which two
      you are gifted at. They cannot see your individual answers or anything you
      wrote in your own words, and neither can anyone else in the cohort.
    </p>
  );
}

/**
 * The consent card, shown before anything is answered.
 *
 * The result used to be the founder's and nobody else's, and the note above
 * this said so in those words. It is shared with the operating team now, which
 * is a decision the founder has to make before they start rather than discover
 * afterwards — so this is a gate, not a notice: there is no way into the
 * questions except through the button that agrees.
 *
 * The copy says exactly what is shared and exactly what is not, because the
 * distinction is the whole point. A ranking of six work types is a reasonable
 * thing to hand a coach. The free text beside "neither, or it depends" is where
 * people write about a cofounder they have not spoken to yet, and that is not
 * shared, so it should not be left ambiguous.
 */
function WgConsent({ onAgree, onCancel }: { onAgree: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    /* showModal, not open: it brings the focus trap, Escape and the backdrop
       with it rather than leaving the page behind it reachable. */
    if (!dialog.open) dialog.showModal();
    /* Escape and the backdrop both close it, and closing without agreeing is
       not agreeing. */
    const onClose = () => onCancel();
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [onCancel]);

  return (
    <dialog ref={ref} className="wg-consent" aria-labelledby="wg-consent-title">
      <h2 id="wg-consent-title">Before you start</h2>
      <p>
        Your result is shared with the Sprint operating team. That means the two
        kinds of work you are gifted at, the two that drain you, and where the
        other two sit — the same picture you will see.
      </p>
      <p>
        <strong>Not shared:</strong> your thirty individual answers, and anything
        you type in the box when you answer &ldquo;neither, or it depends&rdquo;.
        Nobody but you reads those.
      </p>
      <p className="wg-consent-why">
        It is shared so the team can put people on the work that suits them and
        see what the cohort is short of. Other founders do not see your profile.
      </p>
      <div className="wg-consent-actions">
        <button type="button" className="btn-glass" onClick={onCancel}>
          Not now
        </button>
        <button type="button" className="btn-metal" onClick={onAgree} autoFocus>
          I agree, start
        </button>
      </div>
    </dialog>
  );
}

function WgCaveats({ result }: { result: WorkingGeniusResult }) {
  const pairs = WORKING_GENIUS_ITEMS.length / 2;
  const changed = Math.round((1 - result.consistency) * pairs);
  const notes: string[] = [];

  if (changed >= 5) {
    notes.push(
      `You answered ${changed} of the ${pairs} pairs one way the first time and the other way the second. That is enough that the middle of this ranking should be read as unsettled rather than as a result.`,
    );
  } else if (changed > 0) {
    notes.push(`You switched on ${changed} of the ${pairs} pairs between the two askings, which is normal.`);
  }
  if (result.boundaryMargins.geniusCompetency === 0) {
    notes.push("Your second and third types finished level, so the line between genius and competency was a tie-break, not a finding. Read those two as interchangeable.");
  }
  if (result.boundaryMargins.competencyFrustration === 0) {
    notes.push("Your fourth and fifth types finished level, so the line between competency and frustration was a tie-break, not a finding.");
  }
  for (const [a, b] of result.contested) {
    notes.push(`${typeById(a).label} and ${typeById(b).label} came out exactly level, including against each other. Nothing in your answers separates them.`);
  }

  return (
    <div style={{ display: "grid", gap: 8, paddingTop: 4 }}>
      {notes.map((note) => (
        <p key={note} style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: C.faint, fontFamily: "var(--font-serif)", fontStyle: "italic" }}>
          {note}
        </p>
      ))}
      <p style={{ margin: 0, fontSize: 12, color: C.faint }}>
        Completed {result.completedAt} · {WORKING_GENIUS_ITEMS.length} items · {result.version}
      </p>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: C.faint }}>
        Six-type model after Patrick Lencioni's The 6 Types of Working Genius. This is the Sprint's
        own instrument, not the official assessment.
      </p>
    </div>
  );
}

/**
 * The sprint so far, as one line.
 *
 * The product promised a founder that the value compounds and then never once
 * showed it: twelve weeks produced "N check-ins saved" and a single latest
 * number. This is the smallest honest fix.
 *
 * Deliberately a trend and not a streak. A streak punishes exactly the founder
 * having a hard month, which is the one this should be kindest to. A trend
 * rewards nothing and shames nothing; it just shows what happened.
 *
 * Nothing is drawn below three points. A two-point "trend" is a line between
 * two moods and reads as a finding when it is an accident.
 */
function Arc({ checkins }: { checkins: Checkin[] }) {
  const points = useMemo(() => {
    return checkins
      .filter((c) => typeof c.mood === "number" && c.createdAt)
      .slice(0, 40)
      .reverse()
      .map((c) => ({ mood: c.mood as number, at: asDate(c.createdAt as string) }));
  }, [checkins]);

  if (points.length < 3) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: C.faint, lineHeight: 1.6 }}>
        Your trend appears here after three check-ins. {points.length === 0 ? "None yet." : `${points.length} so far.`}
      </p>
    );
  }

  const W = 560;
  const H = 96;
  const PAD = 6;
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(1, points.length - 1);
  // The scale is attention needed, so 0 at the top reads as the good end.
  const y = (m: number) => PAD + ((m / 100) * (H - PAD * 2));

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.mood).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`;

  const last = points[points.length - 1]!;
  const first = points[0]!;
  const shift = last.mood - first.mood;
  const endColor = signalColor(last.mood);

  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const summary = `${points.length} check-ins from ${fmt(first.at)} to ${fmt(last.at)}. ` +
    `Started ${signalLabel(first.mood).toLowerCase()}, now ${signalLabel(last.mood).toLowerCase()}.`;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={summary}
        style={{ display: "block", overflow: "visible" }}
      >
        <title>{summary}</title>
        {/* Two recessive rules at the band edges, so a reader can place a point
            without a full grid competing with the line. */}
        {[40, 70].map((band) => (
          <line key={band} x1={PAD} x2={W - PAD} y1={y(band)} y2={y(band)} stroke={C.line} strokeWidth="1" strokeDasharray="2 4" />
        ))}
        <path d={area} fill={C.accent} opacity="0.08" />
        <path d={line} fill="none" stroke={C.accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.mood)} r={i === points.length - 1 ? 4.5 : 2.5}
            fill={i === points.length - 1 ? endColor : C.accent}
            stroke={C.bg} strokeWidth="2">
            <title>{`${fmt(p.at)} · ${signalLabel(p.mood)} (${p.mood}/100)`}</title>
          </circle>
        ))}
      </svg>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", marginTop: 10, fontSize: 12.5, color: C.faint }}>
        {/* The count sits in the strip at the top of the page; repeating it
            here was the third place on screen saying "6 check-ins". */}
        <span>{fmt(first.at)} to {fmt(last.at)}</span>
        <span style={{ color: endColor }}>Now {signalLabel(last.mood).toLowerCase()}</span>
        {Math.abs(shift) >= 10 && (
          <span>{shift < 0 ? "Steadier than you started" : "Under more strain than you started"}</span>
        )}
      </div>
    </div>
  );
}

type ProgrammeWeek = { week: number; phase: string; title: string; milestones: string; sessions: string };

/**
 * What is on, in the left rail.
 *
 * Lives in the navigation rather than on Reflections because it answers a
 * question a founder has in passing, not one they sit down for. It is the
 * cohort's own schedule and it was, until now, the one thing the product
 * would not tell them.
 *
 * Shows this week by default and opens to the next two, and says what it is
 * waiting for when the programme has no weeks in it yet. Founders should be
 * able to learn that the schedule lives here before there is a schedule.
 */
function ProgrammeRail() {
  const [weeks, setWeeks] = useState<ProgrammeWeek[] | null>(null);
  const [now, setNow] = useState(1);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/programme")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return;
        setWeeks((d.weeks as ProgrammeWeek[]) ?? []);
        setNow((d.currentWeek as number) ?? 1);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const ahead = useMemo(() => {
    if (!weeks) return [];
    return weeks
      .filter((w) => w.week >= now && (w.title || w.milestones || w.sessions))
      .slice(0, 3);
  }, [weeks, now]);

  const [current, ...rest] = ahead;
  const shown = open ? ahead : current ? [current] : [];

  return (
    <section aria-label="Programme" style={{ marginBottom: 16 }}>
      <p style={{ ...navLabel, margin: "0 0 6px", padding: "0 4px" }}>What&rsquo;s on</p>

      {/*
        The empty state is shown, not hidden.

        I hid this when the programme had no weeks in it, reasoning that an
        empty box in permanent navigation teaches people to ignore that corner.
        That was the wrong call here: a founder who cannot see the section at
        all has no way to learn the schedule will appear there, and it read as
        the feature having gone missing. A section that says what it is waiting
        for is not an empty box.
      */}
      {!shown.length && (
        <p style={{ margin: 0, padding: "0 4px", fontSize: 12.5, color: C.faint, lineHeight: 1.45 }}>
          Nothing scheduled yet. The team fills this in as the sprint is planned.
        </p>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {shown.map((w) => (
          <div key={w.week} style={{ padding: "0 4px" }}>
            <p style={{
              margin: 0, fontSize: 10.5, fontWeight: 800, letterSpacing: 1.2,
              textTransform: "uppercase", color: w.week === now ? C.accent : C.faint,
            }}>
              {w.week === now ? "This week" : `Week ${w.week}`}
            </p>
            {w.title && (
              <p style={{ margin: "2px 0 0", fontSize: 13.5, fontWeight: 600, color: C.ink, lineHeight: 1.35 }}>{w.title}</p>
            )}
            {w.sessions && (
              <p style={{ margin: "2px 0 0", fontSize: 12, color: C.sub, lineHeight: 1.45 }}>{w.sessions}</p>
            )}
            {open && w.milestones && (
              <p style={{ margin: "2px 0 0", fontSize: 11.5, color: C.faint, lineHeight: 1.45 }}>{w.milestones}</p>
            )}
          </div>
        ))}
      </div>

      {rest.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="navitem"
          style={{
            display: "block", width: "100%", textAlign: "left", marginTop: 6,
            background: "transparent", border: "none", color: C.faint,
            cursor: "pointer", font: "600 11.5px/1 inherit", padding: "6px 4px",
          }}
        >
          {open ? "Show less" : `What's coming (${rest.length})`}
        </button>
      )}
    </section>
  );
}

function PatternLine({ label, value, color = C.ink }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "11rem 1fr", gap: 16, alignItems: "baseline", fontSize: 14.5, lineHeight: 1.45 }}>
      <span style={{ color: C.faint, fontSize: 11, fontWeight: 800, letterSpacing: 1.3, textTransform: "uppercase" }}>{label}</span>
      <span style={{ color, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 17 }}>{value}</span>
    </div>
  );
}

function ThemeRow({ t }: { t: ThemeArc }) {
  const c = themeColor(t.name);
  const now = t.arc[t.arc.length - 1] ?? 0;
  const prev = t.arc[t.arc.length - 2] ?? 0;
  /* Direction only when there is one. Every theme printed "is steady." before,
     which put the same three italic words down the middle of the column and
     said nothing; most arcs are flat most weeks. */
  const dir = now > prev ? "rising" : now < prev ? "easing" : null;
  const total = t.arc.reduce((sum, n) => sum + n, 0);
  const max = Math.max(1, ...t.arc);
  const points = t.arc
    .map((v, i) => `${(i / Math.max(1, t.arc.length - 1)) * 60},${12 - (v / max) * 10}`)
    .join(" ");
  return (
    <li style={{ display: "grid", gridTemplateColumns: "9rem 1fr auto", alignItems: "baseline", gap: 18, padding: "14px 0", borderBottom: `1px solid ${C.line}`, fontSize: 15 }}>
      <strong style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 17, letterSpacing: "-0.005em", color: C.ink }}>{t.name}</strong>
      <span style={{ color: C.sub, fontSize: 13.5 }}>
        {total} {total === 1 ? "mention" : "mentions"}
        {dir && <span style={{ color: c }}> · {dir}</span>}
      </span>
      <svg width={72} height={18} viewBox="0 0 60 14" preserveAspectRatio="none" aria-hidden="true" style={{ display: "block" }}>
        <polyline points={points} fill="none" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </li>
  );
}

function DecisionRow({ d, onClose }: { d: Decision; onClose: (decision: Decision) => void }) {
  const statusColor = d.status === "closed" ? C.accent : C.yellow;
  return (
    <li style={{ display: "grid", gridTemplateColumns: "5rem 1fr auto", gap: 20, alignItems: "start", padding: "16px 0", borderBottom: `1px solid ${C.line}`, fontSize: 15, lineHeight: 1.5 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.6, textTransform: "uppercase", color: statusColor, paddingTop: 3 }}>{d.status === "closed" ? "Closed" : "Open"}</span>
      <div>
        <div style={{ color: C.ink }}>{d.summary}</div>
        {d.status === "closed" && d.outcome && (
          <em style={{ display: "block", marginTop: 4, fontFamily: "var(--font-serif)", fontStyle: "italic", color: C.sub, fontSize: 14.5 }}>{d.outcome}</em>
        )}
        <span style={{ display: "block", marginTop: 5, fontSize: 12, color: C.faint }}>{d.door} · {d.at}</span>
      </div>
      {d.status === "open" && (
        <button
          type="button"
          onClick={() => onClose(d)}
          className="btn-glass"
          style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}
        >
          Mark closed
        </button>
      )}
    </li>
  );
}

/**
 * Who in the cohort is gifted at what.
 *
 * Shown to the operating team, built only from founders who agreed to it on
 * the card before they answered anything. What is here is the band per type
 * and nothing under it: no individual answers, no free text. The server has no
 * route to those for an organizer at all, which is the only way that promise
 * stays true as this page grows.
 *
 * Founders who did not share are counted, not named. "Three have not shared"
 * is a fact the team needs; a list turns a voluntary thing into a visible
 * omission, which is not what was agreed to.
 *
 * The column totals are the point of reading it across rather than down. A
 * cohort with nobody gifted at Tenacity finishes nothing, and that is invisible
 * one profile at a time.
 */
function WorkingGeniusMap({ rows, withheld }: { rows: WorkingGeniusMapRow[]; withheld: number }) {
  if (rows.length === 0) {
    return (
      <div style={{ marginTop: 34, paddingTop: 22, borderTop: `1px solid ${C.line}` }}>
        <p style={kicker}>Team map</p>
        <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.6, color: C.sub }}>
          {withheld > 0
            ? `Nobody has shared a working-style profile yet. ${withheld} ${withheld === 1 ? "founder has" : "founders have"} not taken it.`
            : "Appears once founders take the working-style assessment and agree to share the result."}
        </p>
      </div>
    );
  }

  const band = (row: WorkingGeniusMapRow, id: WorkingGeniusId) =>
    row.gifts.includes(id) ? "gift" : row.competencies.includes(id) ? "competency" : "drain";

  const giftedAt = (id: WorkingGeniusId) => rows.filter((r) => r.gifts.includes(id)).length;
  const gaps = WIDGET_ORDER.filter((id) => giftedAt(id) === 0);

  return (
    <div style={{ marginTop: 34, paddingTop: 22, borderTop: `1px solid ${C.line}` }}>
      <p style={kicker}>Team map</p>
      <p style={{ margin: "10px 0 18px", fontSize: 14, lineHeight: 1.6, color: C.sub }}>
        Where each founder&rsquo;s energy goes, from the working-style assessment.
        Shared with their agreement; their individual answers are not.
        {withheld > 0 && ` ${withheld} ${withheld === 1 ? "founder has" : "founders have"} not shared.`}
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", minWidth: 460, fontSize: 13.5 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0 14px 8px 0", fontWeight: 600, color: C.faint, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" }}>
                Founder
              </th>
              {WIDGET_ORDER.map((id) => (
                <th key={id} style={{ padding: "0 10px 8px", fontWeight: 600, color: C.faint, fontSize: 11, letterSpacing: 0.6 }}>
                  {typeById(id).label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.email} style={{ borderTop: `1px solid ${C.line}` }}>
                <td style={{ padding: "9px 14px 9px 0", color: C.ink, whiteSpace: "nowrap" }}>{row.name}</td>
                {WIDGET_ORDER.map((id) => {
                  const b = band(row, id);
                  return (
                    <td key={id} style={{ padding: "9px 10px", textAlign: "center" }}>
                      {/* A filled dot, a hollow one, or nothing — so the three
                          bands are told apart by shape and not by colour
                          alone. The text beside it is what a screen reader
                          reads; the dot is what an eye reads. */}
                      <span aria-hidden="true" style={{ color: b === "drain" ? C.faint : C.ink, fontSize: 15 }}>
                        {b === "gift" ? "\u25cf" : b === "competency" ? "\u25cb" : "\u00b7"}
                      </span>
                      <span className="sr-only">{`${typeById(id).label}: ${b === "gift" ? "gifted" : b === "competency" ? "competent" : "drains them"}`}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 18, marginTop: 14, flexWrap: "wrap", fontSize: 13, color: C.sub }}>
        <span>&#9679; gifted at</span>
        <span>&#9675; can do it</span>
        <span>&middot; drains them</span>
      </div>

      {gaps.length > 0 && (
        <p style={{ margin: "16px 0 0", fontSize: 14, lineHeight: 1.6, color: C.ink }}>
          Nobody who has shared is gifted at{" "}
          <strong>{gaps.map((id) => typeById(id).label).join(" or ")}</strong>. That is the
          work this cohort will avoid without noticing.
        </p>
      )}
    </div>
  );
}

/* ---------------- Coach: cohort heatmap ---------------- */
function Cohort({ onPick, cohort, loading }: { onPick: (t: Team) => void; cohort: CohortData | null; loading: boolean }) {
  const teams = cohort?.teams ?? [];
  const week = cohort?.week ?? 1;

  /*
   * Whoever needs attention first, then whoever has gone quiet, then the rest
   * by name. The page is called "where to put your attention" and the answer
   * was previously in whatever order the database returned.
   *
   * Ordering only. Colour follows the check-in and never the row's position,
   * so a founder does not change colour when somebody else's week changes.
   */
  const sortedTeams = useMemo(() => {
    const settled = Math.max(1, week - 1);
    const rank = (t: Team) => {
      const v = t.temp[settled - 1] ?? 1;
      if (v >= 3) return 0;
      if (v === 2) return 1;
      if (v === 0) return 2;
      return 3;
    };
    return [...teams].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [teams, week]);

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
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(1.625rem, 3.2vw, 1.875rem)", lineHeight: 1.15, letterSpacing: "var(--track-display)", margin: "10px 0 16px", color: C.ink }}>No founders yet.</h1>
        <p style={{ margin: "0 0 26px", fontSize: 14.5, lineHeight: 1.6, color: C.sub, letterSpacing: "var(--track-body)" }}>
          Add the cohort in <a href="/admin" style={{ color: C.accent }}>Cohort admin</a> and send each founder their setup link. Their signals appear here once they start checking in.
        </p>
      </div>
    );
  }

  return (
    <div className="rise" style={{ maxWidth: 920, margin: "0 auto", padding: "60px 28px 90px" }}>
      <p style={kicker}>The cohort, week {week}</p>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(1.625rem, 3.2vw, 1.875rem)", lineHeight: 1.15, letterSpacing: "var(--track-display)", margin: "10px 0 16px", color: C.ink }}>Where to put your attention.</h1>
      <p style={{ margin: "0 0 32px", fontSize: 14.5, lineHeight: 1.6, color: C.sub, letterSpacing: "var(--track-body)" }}>
        Who to check on, not who is performing. <Stat c={C.red}>{cohort?.needAttention ?? 0}</Stat> of <Stat>{teams.length}</Stat> showing strain
        {(cohort?.quiet ?? 0) > 0 && <> · <Stat>{cohort?.quiet}</Stat> with no check-in</>}.
      </p>

      {cohort && !cohort.startDateConfigured && (
        <div style={{ margin: "0 0 26px", padding: "13px 16px", borderRadius: 8, border: `1px solid ${C.yellow}`, color: C.ink, fontSize: 14, lineHeight: 1.5 }}>
          Set <code>SPRINT_START_DATE</code> in the server environment to place check-ins into the right weeks. Until then this grid cannot show week-by-week history.
        </div>
      )}

      {/*
        The grid.

        Three things were wrong with the version this replaces, and the first
        is the one that mattered.

        A future week and a week nobody checked in looked identical — both an
        empty cell — while the legend underneath said "an empty cell is an
        absence, not a verdict". In week three of fifteen, twelve of every row
        were future weeks being read as twelve absences. Weeks after the
        current one are now drawn as ruled-off ground rather than as cells, so
        absence starts meaning absence.

        Second, the current week was not marked at all, so there was no anchor
        for "this week" on a grid whose whole subject is this week.

        Third, every cell was a button with a `title` and no accessible name,
        which is fifteen unlabelled buttons per row to a screen reader. Each
        cell now says who, which week and what.

        Rows sort by whoever needs attention first. That is ordering, not
        recolouring: a founder's colour follows their check-in and never their
        position.
      */}
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "11rem repeat(15, 24px)", alignItems: "center", gap: 3, minWidth: 540 }}>
          <div />
          {WEEKS.map((w, i) => (
            <div
              key={w}
              style={{
                textAlign: "center",
                fontSize: 11,
                color: i + 1 === week ? C.ink : C.faint,
                fontWeight: i + 1 === week ? 700 : 400,
                padding: "6px 0",
                letterSpacing: 0.4,
              }}
            >
              {w}
            </div>
          ))}
          {sortedTeams.map((t) => (
            <React.Fragment key={t.id}>
              <button onClick={() => onPick(t)} className="row" style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, background: "none", border: "none", cursor: "pointer", color: C.ink, textAlign: "left", padding: "6px 8px", borderRadius: 6 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, fontWeight: 600 }}>{t.name}</span>
              </button>
              {t.temp.map((v, i) => {
                const future = i + 1 > week;
                const current = i + 1 === week;
                return (
                  <button
                    key={i}
                    onClick={() => onPick(t)}
                    disabled={future}
                    aria-label={
                      future
                        ? `${t.name}, ${WEEKS[i]}, not reached yet`
                        : `${t.name}, ${WEEKS[i]}, ${tempLabel(v)}`
                    }
                    title={future ? `${t.name} · ${WEEKS[i]} · not reached yet` : `${t.name} · ${WEEKS[i]} · ${tempLabel(v)}`}
                    style={{
                      display: "block",
                      height: 24,
                      width: 24,
                      borderRadius: 3,
                      boxSizing: "border-box",
                      margin: 0,
                      /* A week that has not happened is not a cell. Drawn as a
                         hairline on the baseline so the row still reads as a
                         row, without offering a value it does not have. */
                      border: future ? "none" : tempBorder(v),
                      background: future
                        ? `linear-gradient(to bottom, transparent 11px, ${C.line} 11px, ${C.line} 13px, transparent 13px)`
                        : tempColor(v),
                      cursor: future ? "default" : "pointer",
                      outline: current && !future ? `1px solid ${C.line}` : "none",
                      outlineOffset: 2,
                    }}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 18, marginTop: 18, flexWrap: "wrap", alignItems: "center", fontSize: 13, color: C.sub }}>
        <Legend c={TEMP_STABLE} l="Stable" />
        <Legend c={TEMP_MONITOR} l="Monitor" />
        <Legend c={TEMP_NEEDS_ATTENTION} l="Needs attention" />
        <Legend c="transparent" l="No check-in" outlined />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <span
            aria-hidden="true"
            style={{
              display: "block", width: 14, height: 14,
              background: `linear-gradient(to bottom, transparent 6px, ${C.line} 6px, ${C.line} 8px, transparent 8px)`,
            }}
          />
          Not reached yet
        </span>
        <span style={{ color: C.faint, fontStyle: "italic", fontSize: 13 }}>An empty cell is an absence, not a verdict.</span>
      </div>

      {/* Two different problems, so two different prompts. Silence is checked
          first: if a third of the cohort is not using the tool, the strain
          numbers are drawn from too few people to mean much yet. */}
      {(cohort?.quiet ?? 0) > 0 && (cohort?.quiet ?? 0) >= teams.length / 3 && (
        <div style={{ marginTop: 28, border: `1px solid ${C.line}`, borderRadius: 8, padding: "16px 20px" }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: 2.2, textTransform: "uppercase", color: C.faint }}>Adoption</p>
          <p style={{ margin: "6px 0 0", fontSize: 15.5, lineHeight: 1.5, color: C.ink }}>
            {cohort?.quiet} of {teams.length} have not checked in this week. That is a habit problem before it is a
            coaching one — and until it closes, the signals above come from too few people to read much into.
          </p>
        </div>
      )}

      <WorkingGeniusMap rows={cohort?.map ?? []} withheld={cohort?.mapWithheld ?? 0} />

      {(cohort?.needAttention ?? 0) >= 2 && (
        <div style={{ marginTop: 16, background: C.yellow, color: "oklch(13% 0.008 250)", borderRadius: 8, padding: "16px 20px" }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: 2.2, textTransform: "uppercase" }}>Pattern</p>
          <p style={{ margin: "6px 0 0", fontSize: 15.5, lineHeight: 1.5, fontWeight: 600 }}>
            {cohort?.needAttention} of {teams.length} founders are showing strain this week. Consider a group session before the 1:1s.
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
  const arrowColor = ({ tenser: C.red, calmer: C.accent, steady: C.sub, quiet: C.faint } as const)[team.trend] || C.sub;

  return (
    <div className="rise" style={{ maxWidth: 640, margin: "0 auto", padding: "26px 28px 90px" }}>
      <button
        onClick={onBack}
        className="btn-glass"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          marginLeft: -10,
          marginBottom: 22,
          minHeight: 46,
          padding: "11px 18px",
          fontSize: 14,
          lineHeight: 1,
          letterSpacing: 0.25,
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

      <h1 style={{ margin: "0 0 4px", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(1.625rem, 3.2vw, 1.875rem)", lineHeight: 1.15, letterSpacing: "var(--track-display)", color: C.ink }}>
        {team.name}
      </h1>
      <p style={{ margin: "0 0 32px", color: C.faint, fontSize: 13.5 }}>{team.company}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 24, paddingBottom: 22, borderBottom: `1px solid ${C.line}` }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: C.faint, marginBottom: 8 }}>Status</div>
          <div style={{ fontSize: 17, fontWeight: 600, color: tempTextColor(team.temp[5] ?? 0) }}>{tempLabel(team.temp[5] ?? 0)}</div>
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
        <p style={{ margin: 0, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 19, lineHeight: 1.5, color: C.ink }}>{team.openWith}</p>
      </div>

      <p style={{ color: C.faint, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 13.5, marginTop: 36, paddingTop: 18, borderTop: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 6, height: 6, borderRadius: 9, background: C.accent, flexShrink: 0 }} />
        Shared by the founder. Themes and trends only, never raw transcripts.
      </p>
    </div>
  );
}

/* ---------------- small shared bits ---------------- */
const kicker: React.CSSProperties = { color: C.faint, fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700, margin: 0 };
const Stat = ({ children, c = C.white }: { children: React.ReactNode; c?: string }) => <strong style={{ color: c }}>{children}</strong>;
const Legend = ({ c, l, outlined }: { c: string; l: string; outlined?: boolean }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
    <span
      style={{
        width: 14,
        height: 14,
        borderRadius: 4,
        background: c,
        border: outlined ? `1px solid ${C.line}` : "none",
        boxSizing: "border-box",
      }}
    /> {l}
  </span>
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
    "Sprint Buddy tip #67: the meeting that could have been a Slack message is costing you $342 in collective salary. You're welcome.",
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
  const dotColor = (h >= 23 || h < 5) ? C.red : (h < 11) ? C.yellow : C.accent;

  /* The rotating greeting that used to head the empty chat is gone with it;
     the composer's own idle prompt asks the same question, once. */
  return { clock, line, dotColor };
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

/* The delete control on a conversation row. Hidden until the row is hovered
   or focused, so the list stays calm — but a touch screen has no hover, and an
   invisible control there is no control at all. */
.thread-delete { opacity: 0; transition: opacity 120ms ease, color 120ms ease; }
.threadrow:hover .thread-delete,
.threadrow:focus-within .thread-delete { opacity: 1; }
.thread-delete:hover { color: var(--brand-red)!important; background: rgba(255,255,255,0.07)!important; }
.thread-delete:focus-visible { opacity: 1; outline: 2px solid var(--brand-accent); outline-offset: 1px; }
@media (hover: none) { .thread-delete { opacity: 0.5; } }

/* ---- The working-style consent card ------------------------------------- */
.wg-consent {
  width: min(30rem, calc(100vw - 2rem));
  padding: 24px 26px;
  border: 1px solid var(--line-strong);
  border-radius: 14px;
  background: var(--surface-card);
  color: var(--ink);
  font-family: inherit;
}
.wg-consent::backdrop { background: rgba(0, 0, 0, 0.62); }
.wg-consent h2 {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: var(--track-heading);
}
.wg-consent p {
  margin: 0 0 12px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink-sub);
}
.wg-consent p strong { color: var(--ink); font-weight: 600; }
.wg-consent-why { color: var(--ink-faint) !important; font-size: 13px !important; }
.wg-consent-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 20px;
}
@media (max-width: 480px) {
  .wg-consent-actions { flex-direction: column-reverse; }
  .wg-consent-actions button { width: 100%; }
}

/* ---- Buttons ---------------------------------------------------------------
   Two materials, and the tier is read off the material rather than off a
   colour.

   .btn-metal is the primary: brushed steel, a fixed gradient of greys that
   sweeps across the face on hover. The supplied component drives that surface
   with a WebGL shader from @paper-design/shaders and runs it permanently at
   speed 0.6. Neither is here: a renderer plus a shader bundle for one button
   is a lot of weight, and a face that never stops moving would compete with
   the mascot, the composer and the deadline column all at once. A
   background-position transition on a multi-stop gradient sweeps the same way
   and only moves under the pointer.

   .btn-glass is the secondary: no fill, a rim built entirely from layered
   inset shadows, and the page behind it refracted. That shadow stack is
   carried over from the supplied component almost unchanged, because it is the
   component.

   Neither carries the accent. Red still marks state — focus, overdue, the
   destructive confirm — where it means something. */
.btn-metal, .btn-glass {
  position: relative;
  border: 0;
  border-radius: 999px;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
}
.btn-metal {
  padding: 10px 20px;
  font-size: 14px;
  color: oklch(18% 0.008 250);
  background: linear-gradient(
    104deg,
    #6e737d 0%, #b9bec7 12%, #f2f4f7 22%, #9aa0aa 34%,
    #d7dbe1 46%, #7c828c 58%, #eef0f4 70%, #a7adb7 82%, #6e737d 100%
  );
  /* Wider than the button, so the sweep has somewhere to go. */
  background-size: 220% 100%;
  background-position: 0% 50%;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.5),
    inset 0 -1px 0 rgba(0, 0, 0, 0.3),
    0 9px 9px rgba(0, 0, 0, 0.12),
    0 2px 5px rgba(0, 0, 0, 0.15);
  transition:
    background-position 700ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 140ms ease,
    box-shadow 140ms ease;
}
.btn-metal:hover:not(:disabled) { background-position: 100% 50%; }
.btn-metal:active:not(:disabled) {
  transform: translateY(1px) scale(0.985);
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.55),
    inset 0 2px 4px rgba(0, 0, 0, 0.35),
    0 1px 2px rgba(0, 0, 0, 0.3);
}
.btn-glass {
  padding: 9px 16px;
  font-size: 13px;
  color: var(--ink);
  background: none;
  backdrop-filter: url("#btn-glass");
  -webkit-backdrop-filter: url("#btn-glass");
  box-shadow:
    0 0 8px rgba(0, 0, 0, 0.03),
    0 2px 6px rgba(0, 0, 0, 0.08),
    inset 3px 3px 0.5px -3.5px rgba(255, 255, 255, 0.09),
    inset -3px -3px 0.5px -3.5px rgba(255, 255, 255, 0.85),
    inset 1px 1px 1px -0.5px rgba(255, 255, 255, 0.6),
    inset -1px -1px 1px -0.5px rgba(255, 255, 255, 0.6),
    inset 0 0 6px 6px rgba(255, 255, 255, 0.12),
    inset 0 0 2px 2px rgba(255, 255, 255, 0.06),
    0 0 12px rgba(0, 0, 0, 0.15);
  transition: transform 300ms cubic-bezier(0.22, 1, 0.36, 1), color 160ms ease;
}
.btn-glass:hover:not(:disabled) { transform: scale(1.05); }
.btn-glass:active:not(:disabled) { transform: scale(0.98); }
.btn-metal:disabled, .btn-glass:disabled { opacity: 0.5; cursor: default; }
.btn-metal:focus-visible, .btn-glass:focus-visible {
  outline: 2px solid var(--brand-accent);
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  .btn-metal, .btn-glass { transition: none; }
  .btn-metal:hover:not(:disabled) { background-position: 0% 50%; }
  .btn-glass:hover:not(:disabled), .btn-glass:active:not(:disabled) { transform: none; }
}

/* Deadline checkboxes.
   The browser default paints an unchecked box as a filled white square, which
   on this sidebar reads as the loudest thing in the column, louder than the
   overdue label it sits next to. accentColor only styles the checked state, so
   the unchecked one has to be drawn.

   The mark is the tick path from the supplied component, carried over as a
   mask rather than redrawn: it is a real glyph with a long tail and a slight
   lift at the end, where the previous version was two CSS borders rotated 45
   degrees. At 16px that difference is the whole character of the control.

   A mask, not a background image, because the path then takes currentColor and
   the same rule works whatever the box is filled with. The page's CSP allows
   img-src 'self' data:, which is what governs this. */
.deadline-check {
  appearance: none;
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  margin: 0;
  flex-shrink: 0;
  border: 1px solid var(--line-strong);
  border-radius: 4px;
  background: transparent;
  /* The supplied component's shadow-sm shadow-black/5. Barely there, and it is
     what stops the box reading as a hole punched in the row. */
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  cursor: inherit;
  display: grid;
  place-items: center;
  transition: background 120ms ease, border-color 120ms ease;
}
.deadline-check:hover:not(:disabled) { border-color: var(--brand-accent); }
.deadline-check:checked { background: var(--brand-accent); border-color: var(--brand-accent); }
.deadline-check::after {
  content: "";
  width: 9px;
  height: 9px;
  /* Nothing to show until it is ticked; the box is drawn by the input. */
  background: currentColor;
  color: transparent;
  -webkit-mask-image: url("data:image/svg+xml,<svg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%209%209'><path%20fill-rule='evenodd'%20clip-rule='evenodd'%20d='M8.53547%200.62293C8.88226%200.849446%208.97976%201.3142%208.75325%201.66099L4.5083%208.1599C4.38833%208.34356%204.19397%208.4655%203.9764%208.49358C3.75883%208.52167%203.53987%208.45309%203.3772%208.30591L0.616113%205.80777C0.308959%205.52987%200.285246%205.05559%200.563148%204.74844C0.84105%204.44128%201.31533%204.41757%201.62249%204.69547L3.73256%206.60459L7.49741%200.840706C7.72393%200.493916%208.18868%200.396414%208.53547%200.62293Z'/></svg>");
  mask-image: url("data:image/svg+xml,<svg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%209%209'><path%20fill-rule='evenodd'%20clip-rule='evenodd'%20d='M8.53547%200.62293C8.88226%200.849446%208.97976%201.3142%208.75325%201.66099L4.5083%208.1599C4.38833%208.34356%204.19397%208.4655%203.9764%208.49358C3.75883%208.52167%203.53987%208.45309%203.3772%208.30591L0.616113%205.80777C0.308959%205.52987%200.285246%205.05559%200.563148%204.74844C0.84105%204.44128%201.31533%204.41757%201.62249%204.69547L3.73256%206.60459L7.49741%200.840706C7.72393%200.493916%208.18868%200.396414%208.53547%200.62293Z'/></svg>");
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: contain;
  mask-size: contain;
  transition: color 120ms ease;
}
.deadline-check:checked::after { color: oklch(13% 0.008 250); }
.deadline-check:focus-visible {
  /* offset-2, from the supplied component. It clears the 4px radius, where an
     offset of 0 would trace the corners and look broken. */
  outline: 2px solid var(--brand-accent);
  outline-offset: 2px;
}
.row:hover { background: rgba(255,255,255,.04)!important; }
/* ---- Composer placeholder --------------------------------------------------
   The idle line, blurring in a letter at a time. A native placeholder cannot
   be animated, so this is an overlay sitting exactly where the text will be:
   same font, same padding, same line height, or it jumps when typing starts. */
.composer-ghost {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  padding: 10px 2px;
  font-size: 16px;
  line-height: 1.5;
  color: var(--ink-faint);
  white-space: nowrap;
  overflow: hidden;
  pointer-events: none;
  user-select: none;
}
.composer-ghost > span {
  display: inline-block;
  opacity: 0;
  animation: ghost-in .45s cubic-bezier(.2, .8, .3, 1) forwards;
}
@keyframes ghost-in {
  from { opacity: 0; filter: blur(9px); transform: translateY(7px); }
  to { opacity: 1; filter: blur(0); transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  /* No stagger, no blur: the line simply is there. */
  .composer-ghost > span { animation: none; opacity: 1; }
}

/* ---- Composer edge ---------------------------------------------------------
   A light travels slowly around the border of the box a founder types into,
   brighter and quicker once it has focus.

   Asked for as a liquid-metal shader component. That component is a button
   built on @paper-design/shaders, and using it here would mean a WebGL context
   running continuously behind the one control that is on screen the entire time
   a founder is in the app, for a border. This is a rotating conic gradient
   masked to the edge: no dependency, no canvas, compositor-only.

   The angle animates through a registered custom property, because a gradient
   is not interpolable but an angle is. Without @property the sweep would jump
   between keyframes instead of travelling. */
@property --edge-angle {
  syntax: "<angle>";
  initial-value: 0deg;
  inherits: false;
}

.composer-box { position: relative; }

.composer-box::before {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  padding: 1px;
  background: conic-gradient(
    from var(--edge-angle),
    transparent 0%,
    rgba(255, 255, 255, 0.5) 7%,
    var(--brand-accent) 13%,
    rgba(255, 255, 255, 0.5) 19%,
    transparent 30%,
    transparent 100%
  );
  /* Two boxes, one subtracted from the other: what is left is the 1px ring. */
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  opacity: 0.42;
  pointer-events: none;
  animation: composer-edge 7s linear infinite;
  transition: opacity .25s ease;
}

.composer-box:focus-within::before {
  opacity: 1;
  animation-duration: 3.4s;
}

@keyframes composer-edge {
  to { --edge-angle: 360deg; }
}

/* Focus lifts the underlying border only part of the way to the accent. Taking
   it all the way made a solid red rectangle and the travelling light had
   nothing to travel against. */
.composer-box:focus-within { border-color: rgba(94, 106, 210, 0.38)!important; }

@media (prefers-reduced-motion: reduce) {
  .composer-box::before { animation: none; }
}

/* ---- The record, and printing it ------------------------------------------
   Printing is the export. A founder who wants to keep this should not need an
   account to read it later, and a PDF is the one format that outlives the
   programme without anything being built to serve it. */
.record-print {
  /* Positioning only. The material comes from .btn-glass, which this carries
     alongside. */
  align-self: flex-start;
  min-height: 34px;
}

/* Off the screen, on the page.

   The record repeated the reflections page above it almost line for line — the
   same four counts, the same theme list, the same closed decisions — and was
   the last thing a founder scrolled to. It stays complete, because a printed
   sheet does want the whole thing on one page, and it stays hidden here. */
.sprint-record { display: none; }

@media print {
  /* Only the record prints. Everything else on this page is navigation or
     something the founder can see any time they are signed in. */
  body * { visibility: hidden !important; }
  .sprint-record, .sprint-record * { visibility: visible !important; }
  .sprint-record {
    display: block !important;
    position: absolute;
    inset: 0 auto auto 0;
    width: 100%;
    border-top: none !important;
    padding: 0 !important;
    margin: 0 !important;
    color: #000 !important;
  }
  .sprint-record * { color: #000 !important; }
  .record-print { display: none !important; }
}


/* ---- Mobile actions -------------------------------------------------------
   Hidden entirely on anything wide enough to show the sidebar, which is where
   these two live properly. This is the phone fallback, not a second home. */
.context-strip {
  padding: 14px 132px 14px var(--col-pad-left, 24px);
}
@media (max-width: 700px) {
  /* No docked mascot on a phone, so nothing to clear. At 390px the desktop
     value left the line about 200px to wrap in, which is four lines of a
     one-line remark. */
  .context-strip { padding: 12px 14px; }
}

.mobile-actions { display: none; }
@media (max-width: 700px) {
  .mobile-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex-shrink: 0;
    padding: 10px 12px 10px 60px;
    border-bottom: 1px solid var(--line-strong);
    background: var(--card, rgba(255,255,255,0.03));
  }
  .mobile-actions-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
}
.mobile-actions-checkin {
  flex: 0 0 auto;
  min-height: 44px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: rgba(255,255,255,0.05);
  color: var(--ink);
  font: 700 13.5px/1 var(--font-family);
  cursor: pointer;
  white-space: nowrap;
}
.mobile-actions-done {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 12px;
  font: 600 13px/1 var(--font-family);
  color: #7CB893;
  white-space: nowrap;
}
.mobile-actions-next {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--line-strong);
  background: transparent;
  color: inherit;
  font: 500 13px/1.2 var(--font-family);
  cursor: pointer;
  text-align: left;
}
.mobile-actions-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mobile-actions-when { flex: 0 0 auto; font-weight: 700; font-size: 12px; opacity: .85; }
.mobile-actions-more { flex: 0 0 auto; font-size: 11.5px; opacity: .6; }
.mobile-actions-checkin:focus-visible,
.mobile-actions-next:focus-visible { outline: 2px solid var(--brand-accent); outline-offset: 2px; }
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
