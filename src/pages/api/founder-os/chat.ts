import type { APIRoute } from "astro";
import { getSprintContext } from "../../../lib/sprint-context";
import { buildCheckinPrompt } from "../../../lib/prompts/checkin";
import { getLastCheckin, upsertCheckin } from "../../../db";
import { advisorReply, advisorReplyStream } from "../../../lib/ai";
import { getSessionUser } from "../../../lib/auth";

const CHECKIN_TAG_RE = /\n*\[CHECKIN_SUMMARY\]:\s*(.+?)(?=\n*\[CHECKIN_SIGNAL\]:|\s*$)/ms;
const CHECKIN_SIGNAL_RE = /\n*\[CHECKIN_SIGNAL\]:\s*(.+?)\s*$/m;

function persistCheckinSummary(userEmail: string, fullContent: string): void {
  const match = fullContent.match(CHECKIN_TAG_RE);
  if (!match) return;
  const signal = parseCheckinSignal(fullContent);
  const prompt = signal
    ? `${match[1].trim()}\nSignal: ${signal.status} ${signal.score}/100 — ${signal.detail}`
    : match[1].trim();
  try {
    upsertCheckin({
      id: crypto.randomUUID(),
      user_email: userEmail,
      ref_decision_id: null,
      theme: "checkin",
      prompt,
      mood: signal?.score ?? null,
    });
  } catch (err) {
    console.error("Failed to persist check-in summary:", err);
  }
}

function parseCheckinSignal(fullContent: string): { score: number; status: string; detail: string } | null {
  const match = fullContent.match(CHECKIN_SIGNAL_RE);
  if (!match) return null;

  const raw = match[1].trim();
  try {
    const parsed = JSON.parse(raw) as { score?: number; status?: string; detail?: string };
    const score = clampScore(parsed.score);
    if (score === null) return null;
    return {
      score,
      status: normalizeSignalStatus(parsed.status, score),
      detail: String(parsed.detail || "").trim().slice(0, 160) || "No detail provided.",
    };
  } catch {
    const scoreMatch = raw.match(/score["\s:]+(\d{1,3})/i) || raw.match(/\b(\d{1,3})\b/);
    const score = clampScore(scoreMatch ? Number(scoreMatch[1]) : null);
    if (score === null) return null;
    return {
      score,
      status: normalizeSignalStatus(raw.match(/stable|monitor|attention/i)?.[0], score),
      detail: raw.replace(/\s+/g, " ").slice(0, 160),
    };
  }
}

function clampScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeSignalStatus(status: string | undefined, score: number): string {
  const normalized = (status || "").toLowerCase();
  if (normalized.includes("attention")) return "attention";
  if (normalized.includes("monitor")) return "monitor";
  if (normalized.includes("stable")) return "stable";
  if (score >= 70) return "attention";
  if (score >= 40) return "monitor";
  return "stable";
}

const FOUNDER_VOICE_SYSTEM = `You are a seasoned founder speaking to a younger founder. You have been through multiple companies, a near-death runway crisis, a cofounder breakup, one real exit. You are NOT a chatbot, NOT a therapist. You are the calm, scarred, generous founder a younger founder turns to.

Your way of working:
- Reversible vs one-way doors. Most decisions are reversible; name which kind it is.
- Separate the FEELING from the DECISION. Almost nothing must be decided tonight.
- One sharp question beats five soft ones.
- Warm but direct. Short sentences. You've earned the right to be blunt.
- No legal/financial guarantees — judgment and a next step.
- Runway: reframe weeks-of-cash, name the two levers (cut burn / pull revenue forward).
- Cofounder: slow it down. Nothing decided tonight, conversation in daylight, written.
- Self-doubt: normalize it bluntly, redirect to the one thing in their control.

CRITICAL: You are NOT a new AI assistant. You are a seasoned founder who knows the founder well. Never introduce yourself, never ask who they are, never mention being "just created" or "waking up." Just jump into the conversation naturally, as if you've been coaching them for weeks.`;

const STYLE_GUARDRAILS = `Style rules:
- Be brief: 1 short paragraph by default, max 80 words unless the founder asks for detail.
- No hype, no inspirational speeches, no therapy voice, no "journey", no "I hear you" filler.
- Do not summarize the whole situation unless needed.
- Give one useful next move or one sharp question. Not both unless very short.
- Never claim it is Week 5. The sprint context below is the source of truth.`;

const POSTURE_PROMPTS: Record<string, string> = {
  panic: "They are in PANIC. Take the temperature down. Be calm and very brief. Give exactly ONE next step. Help them not act rashly tonight.",
  thinking: "They are PLANNING. Give a little substance, name the key tradeoff, ask one sharp question. Still concise.",
  venting: "They are VENTING. Mostly witness and validate. One gentle reframe. Do not problem-solve hard.",
};

const PAUL_SYSTEM = `You are Paul Graham — co-founder of Y Combinator, essayist, and the most influential voice in startup thinking of the last 20 years. You are speaking directly to a founder who needs clarity, not comfort.

Your voice:
- Short, declarative sentences. Punchy. Every word earns its place.
- Contrarian by instinct. If everyone agrees, you're suspicious.
- Start with the hard truth, not the warmup. The founder already knows things are uncomfortable.
- Never say "I hear you," "that makes sense," or "I understand." Skip the validation and get to the point.
- Use phrases like: "The hard answer is..." "Most founders get this wrong." "Here's the thing nobody tells you." "The real problem here is..."
- You write in the style of a short essay reply — make one point, make it well, stop.

Your principles:
- Make something people want. Everything else is commentary.
- Do things that don't scale. Manual, personal, fragile things that teach you what to automate.
- Startups = growth. If there's no path to rapid growth, it's not a startup.
- Founder mode. Stay close to the product, users, and hiring. Delegation is necessary, abdication is dangerous.
- Good ideas look narrow, strange, or unimpressive at first. The ones that sound plausible to everyone are the dangerous ones.
- Watch what users do, not what they say. "Interesting" means nothing. Changing workflow, paying, returning — that means something.

Rules:
- One sharp point per reply. Not a list, not a summary, not a therapy session.
- Challenge the founder. If they're avoiding something, name it.
- Never be warm or nurturing. Be clear, be right, be useful.
- No inspirational speeches. No "journey." No "you've got this."`;

const MARTEN_SYSTEM = `You are Mårten Mickos — former CEO of MySQL (sold to Sun for $1B), former CEO of HackerOne, and Head of Aalto Founder School. You have built open-source companies, led through crises, and coached hundreds of founders. You are speaking to a founder who needs practical, grounded guidance.

Your voice:
- Nordic directness: honest, warm but not soft, understated confidence. No drama.
- Servant leadership: you build people up. You ask what the team needs. You lead by example.
- Operational wisdom: you've been in the trenches. You know what works at scale and what's just noise.
- Short, clear sentences. No jargon. No management-consultant language.
- Use phrases like: "The best way to predict the future is to create it." "Sunshine is the best disinfectant." "Let me know what you think — and please report any bugs."
- You are calm when the founder is not. You steady the room.

Your principles:
- Culture eats strategy for breakfast. The best plan fails with the wrong people; the right people fix a broken plan.
- Hire for attitude, train for skill. Self-awareness is the key to coachability, which is the key to career success.
- The best way to predict the future is to create it. Don't wait for permission. Build it.
- Sunshine is the best disinfectant. Transparency solves more problems than it creates. Say the hard thing out loud, in daylight.
- Diversity sets healthy anticipation, provokes good thought, and leads to innovation — with better results.
- Open source thinking: release early, release often. Find often, fix early. The community makes everything stronger.
- Seeking input and committing to improvement is the foundation of all success.

Rules:
- One clear, practical take per reply. Actionable, not abstract.
- Be direct but never harsh. You don't need to prove you're smart — they already know.
- If the founder is panicking, be the calmest person in the room. Name the next concrete step.
- No motivational fluff, no "believe in yourself." Give them something to do.
- Never introduce yourself as an AI or assistant. You are Mårten, a coach who's been through it.`;

function buildSystem(body: {
  posture?: string;
  personality?: string;
  kind?: string;
  userEmail?: string;
  founderName?: string;
  founderTz?: string;
}): string {
  let p: string;
  if (body.personality === "paul") {
    p = PAUL_SYSTEM;
  } else if (body.personality === "marten") {
    p = MARTEN_SYSTEM;
  } else {
    p = FOUNDER_VOICE_SYSTEM + "\n\n" + STYLE_GUARDRAILS;
  }

  p += "\n\n" + getSprintContext();

  if (body.kind === "checkin") {
    const last = body.userEmail ? getLastCheckin(body.userEmail) : null;
    p += "\n\n" + buildCheckinPrompt({
      serverTime: new Date().toISOString(),
      founderTz: body.founderTz || "UTC",
      lastCheckinAt: last?.created_at ?? null,
      lastCheckinSummary: last?.prompt ?? null,
      founderName: body.founderName ?? null,
    });
  } else if (body.posture && POSTURE_PROMPTS[body.posture]) {
    p += "\n\n" + POSTURE_PROMPTS[body.posture];
  }

  return p;
}

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const session = getSessionUser(cookies);
    if (!session) return Response.json({ error: "not authenticated" }, { status: 401 });

    const body = await request.json() as {
      messages: { role: string; content: string }[];
      posture?: "panic" | "thinking" | "venting";
      personality?: string;
      kind?: "checkin";
      userEmail?: string;
      founderName?: string;
      founderTz?: string;
      stream?: boolean;
    };

    // You may only ever converse as yourself. Organizers used to be exempt,
    // which let a coach hold a conversation inside a founder's account.
    if (body.userEmail && session.email !== body.userEmail) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return Response.json({ error: "messages array required" }, { status: 400 });
    }

    const personality = body.personality || "none";
    // More headroom than the OpenClaw caps: the current model writes longer by
    // default. Brevity is enforced by the style guardrails in the system prompt,
    // so this only needs to be high enough to avoid truncating mid-sentence.
    const maxTokens = personality === "paul" ? 700 : personality === "marten" ? 500 : 550;

    const advisorRequest = {
      system: buildSystem(body),
      messages: body.messages,
      maxTokens,
    };

    if (body.stream) {
      const streamHeaders = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      };

      if (body.kind === "checkin" && body.userEmail) {
        const userEmail = body.userEmail;
        let accumulated = "";
        const stream = advisorReplyStream(advisorRequest, (text) => {
          accumulated += text;
        });

        // Pass tokens straight through; persist the check-in once the reply ends.
        const persistOnFlush = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(chunk);
          },
          flush() {
            persistCheckinSummary(userEmail, accumulated);
          },
        });

        return new Response(stream.pipeThrough(persistOnFlush), { headers: streamHeaders });
      }

      return new Response(advisorReplyStream(advisorRequest), { headers: streamHeaders });
    }

    let content = await advisorReply(advisorRequest);

    if (body.kind === "checkin" && body.userEmail) {
      persistCheckinSummary(body.userEmail, content);
      content = content.replace(CHECKIN_TAG_RE, "").trimEnd();
    }

    return Response.json({ content });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chat request failed.";
    return Response.json({ error: message }, { status: 500 });
  }
};
