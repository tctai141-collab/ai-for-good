import type { APIRoute } from "astro";
import { listKnowledge, recordAdminAction, setKnowledgeStatus, upsertKnowledge } from "../../db/index";
import { getSessionUser } from "../../lib/auth";
import { reportError } from "../../lib/errors";
import { assembleKnowledge, KNOWLEDGE_BUDGET_CHARS, PERSONA } from "../../lib/knowledge";
import { cap } from "../../lib/limits";

/**
 * What Sprint Buddy knows, editable by organizers.
 *
 * Organizer-only both ways. Founders never read this: the pack reaches them
 * inside the advisor's reply, and exposing the whole thing over an API would
 * publish the operating team's working notes to the cohort.
 */

const PERSONAS = new Set([PERSONA]);
const MAX_TOPIC = 120;
const MAX_BODY = 8_000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function guard(cookies: Parameters<APIRoute>[0]["cookies"]) {
  const session = getSessionUser(cookies);
  if (!session) return { error: json({ error: "Not signed in." }, 401) };
  if (session.role !== "organizer") return { error: json({ error: "Organizers only." }, 403) };
  return { session };
}

export const GET: APIRoute = async ({ cookies, request }) => {
  try {
    const { error } = guard(cookies);
    if (error) return error;

    const persona = new URL(request.url).searchParams.get("persona") ?? PERSONA;
    if (!PERSONAS.has(persona)) return json({ error: "Unknown persona." }, 400);

    const assembled = assembleKnowledge(persona);
    return json({
      persona,
      entries: listKnowledge(persona, true),
      // Surfaced so the team can see the pack growing rather than discover the
      // ceiling by hitting it.
      size: {
        chars: assembled.chars,
        approxTokens: Math.round(assembled.chars / 3.6),
        budgetChars: KNOWLEDGE_BUDGET_CHARS,
        truncated: assembled.truncated,
      },
    });
  } catch (err) {
    reportError(err, { where: "knowledge.GET" });
    return json({ error: "Could not load the knowledge base." }, 500);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const { session, error } = guard(cookies);
    if (error) return error;

    let body: { action?: string; id?: unknown; persona?: unknown; topic?: unknown; body?: unknown; position?: unknown; source?: unknown; status?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Malformed request." }, 400);
    }

    const persona = typeof body.persona === "string" && PERSONAS.has(body.persona) ? body.persona : PERSONA;

    if (body.action === "archive" || body.action === "restore") {
      if (typeof body.id !== "string" || !body.id) return json({ error: "id required." }, 400);
      const status = body.action === "archive" ? "archived" : "active";
      if (!setKnowledgeStatus(body.id, status)) return json({ error: "No such entry." }, 404);
      recordAdminAction(session!.email, `knowledge:${body.action}`, null, body.id);
      return json({ ok: true });
    }

    if (body.action === "save") {
      const topic = cap(body.topic, MAX_TOPIC).trim();
      const text = cap(body.body, MAX_BODY).trim();
      if (!text) return json({ error: "The entry needs some text." }, 400);

      const position = Number(body.position);
      const id = upsertKnowledge({
        id: typeof body.id === "string" && body.id ? body.id : undefined,
        persona,
        topic,
        body: text,
        position: Number.isFinite(position) ? Math.trunc(position) : 0,
        source: cap(body.source, MAX_TOPIC).trim(),
      });
      recordAdminAction(session!.email, "knowledge:save", null, `${id} ${topic}`.slice(0, 120));
      return json({ ok: true, id });
    }

    return json({ error: `Unknown action: ${String(body.action)}` }, 400);
  } catch (err) {
    reportError(err, { where: "knowledge.POST" });
    return json({ error: "That did not save. Nothing was changed." }, 500);
  }
};
