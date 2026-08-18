import type { APIRoute } from "astro";
import { getSprintContext } from "../../../lib/sprint-context";
import { buildCheckinPrompt } from "../../../lib/prompts/checkin";
import { getLastCheckin, upsertCheckin } from "../../../db";
import { advisorReply, advisorReplyStream } from "../../../lib/ai";
import { getSessionUser } from "../../../lib/auth";
import { capHistory, chatLimiter } from "../../../lib/limits";
import { reportError } from "../../../lib/errors";
import {
  CONTRARIAN_SYSTEM,
  FOUNDER_VOICE_SYSTEM,
  MARTEN_SYSTEM,
  POSTURE_PROMPTS,
  STYLE_GUARDRAILS,
} from "../../../lib/personas";

const CHECKIN_TAG_RE = /\n*\[CHECKIN_SUMMARY\]:\s*(.+?)(?=\n*\[CHECKIN_SIGNAL\]:|\s*$)/ms;
const CHECKIN_SIGNAL_RE = /\n*\[CHECKIN_SIGNAL\]:\s*(.+?)\s*$/m;

function persistCheckinSummary(userEmail: string, fullContent: string): void {
  const match = fullContent.match(CHECKIN_TAG_RE);

  // The model is asked to end a check-in with a [CHECKIN_SUMMARY] tag. When it
  // does not, this used to return having recorded nothing at all — so the
  // founder had a complete conversation, and the organizer's dashboard showed
  // a missing week that reads as "gone quiet". Silence from a founder is the
  // single most important signal on that dashboard, and this manufactured it.
  //
  // A check-in still gets recorded, with a null score: the founder turned up,
  // we just have no reading. And the miss is logged, because a model that
  // stops emitting the tag should be visible rather than slowly degrading the
  // dashboard.
  if (!match) {
    console.warn(`[checkin] no [CHECKIN_SUMMARY] tag in the reply for ${userEmail}; recording an unscored check-in`);
    try {
      upsertCheckin({
        id: crypto.randomUUID(),
        user_email: userEmail,
        ref_decision_id: null,
        theme: "checkin",
        prompt: "Check-in completed, but no summary was produced.",
        mood: null,
      });
    } catch (err) {
      console.error("Failed to persist unscored check-in:", err);
    }
    return;
  }

  const summary = (match[1] ?? "").trim();
  const signal = parseCheckinSignal(fullContent);
  const prompt = signal
    ? `${summary}\nSignal: ${signal.status} ${signal.score}/100 — ${signal.detail}`
    : summary;
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

  const raw = (match[1] ?? "").trim();
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
    // Legacy wire value; the persona is no longer a named person.
    p = CONTRARIAN_SYSTEM;
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

    // Every call here costs money on a metered API, and any authenticated
    // founder could previously make them without limit.
    const limited = chatLimiter.check(session.email);
    if (limited) {
      return Response.json(
        { error: "You are sending messages very quickly. Give it a moment." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
      );
    }

    const personality = body.personality || "none";
    // More headroom than the OpenClaw caps: the current model writes longer by
    // default. Brevity is enforced by the style guardrails in the system prompt,
    // so this only needs to be high enough to avoid truncating mid-sentence.
    const maxTokens = personality === "paul" ? 700 : personality === "marten" ? 500 : 550;

    const advisorRequest = {
      system: buildSystem(body),
      // Trimmed to the most recent turns under a character budget. A 500
      // message / ~1 MB history was forwarded upstream verbatim before this.
      messages: capHistory(body.messages),
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
    // The upstream error used to be relayed verbatim, which returned raw
    // provider and CDN detail (a full Cloudflare 502 HTML page, in one case)
    // straight to the browser.
    reportError(err, { where: "chat" });
    return Response.json(
      { error: "The advisor is unavailable right now. Please try again." },
      { status: 502 },
    );
  }
};
