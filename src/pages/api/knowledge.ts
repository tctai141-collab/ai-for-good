import type { APIRoute } from "astro";
import { readJsonBody } from "../../lib/limits";
import { archiveKnowledgeBySource, deleteKnowledge, listKnowledge, recordAdminAction, setKnowledgeStatus, upsertKnowledge } from "../../db/index";
import { getSessionUser } from "../../lib/auth";
import { reportError } from "../../lib/errors";
import { assembleKnowledge, KNOWLEDGE_BUDGET_CHARS, PERSONA } from "../../lib/knowledge";
import { AdvisorNotConfiguredError } from "../../lib/ai";
import { extractKnowledge, MAX_TRANSCRIPT_CHARS, nameLeaks } from "../../lib/extract";
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
/** One import is a session, not a library. */
const MAX_IMPORT_ENTRIES = 60;

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

    const read = await readJsonBody<{ action?: string; id?: unknown; persona?: unknown; topic?: unknown; body?: unknown; position?: unknown; source?: unknown; status?: unknown }>(request);
    if (!read.ok) return json({ error: read.error }, read.status);
    const body = read.value;

    const persona = typeof body.persona === "string" && PERSONAS.has(body.persona) ? body.persona : PERSONA;

    if (body.action === "archive" || body.action === "restore") {
      if (typeof body.id !== "string" || !body.id) return json({ error: "id required." }, 400);
      const status = body.action === "archive" ? "archived" : "active";
      if (!setKnowledgeStatus(body.id, status)) return json({ error: "No such entry." }, 404);
      recordAdminAction(session!.email, `knowledge:${body.action}`, null, body.id);
      return json({ ok: true });
    }

    if (body.action === "delete") {
      if (typeof body.id !== "string" || !body.id) return json({ error: "id required." }, 400);
      // Recorded before the row is gone, so the audit log keeps what was
      // removed. Afterwards there is nothing left to describe.
      const entry = listKnowledge(persona, true).find((row) => row.id === body.id);
      if (!deleteKnowledge(body.id)) return json({ error: "No such entry." }, 404);
      recordAdminAction(
        session!.email,
        "knowledge:delete",
        null,
        `${entry?.topic ?? "(unknown)"} — ${entry?.source || "no source"}`.slice(0, 120),
      );
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
      // A hand-typed body is not filtered — there is no reliable way to know
      // every name, and blocking a deliberate edit would be the wrong call
      // anyway. But if the entry repeats the source it was filed under, that
      // is almost certainly a slip, and it is the one case worth catching.
      const leaks = nameLeaks(`${topic} ${text}`, cap(body.source, MAX_TOPIC).trim());
      return json({ ok: true, id, ...(leaks.length ? { warning: leaks } : {}) });
    }

    if (body.action === "extract") {
      const transcript = cap((body as { transcript?: unknown }).transcript, MAX_TRANSCRIPT_CHARS);
      const speaker = cap(body.source, MAX_TOPIC).trim();
      if (!transcript.trim()) return json({ error: "Paste some transcript first." }, 400);
      try {
        const candidates = await extractKnowledge(transcript, speaker);
        // Flagged, not filtered. The prompt forbids naming the speaker and
        // mostly obeys; "mostly" is the wrong standard for something twenty
        // founders will read, so anything that slipped through is marked and
        // the operating team decides.
        const flagged = candidates.map((entry) => ({
          ...entry,
          leaks: nameLeaks(`${entry.topic} ${entry.body}`, speaker),
        }));
        // Deliberately not recorded as an admin action: nothing changed. The
        // audit log tracks writes, and a suggestion is not one until imported.
        return json({ ok: true, candidates: flagged });
      } catch (err) {
        if (err instanceof AdvisorNotConfiguredError) {
          return json({ error: "The API key is not set on this service." }, 503);
        }
        reportError(err, { where: "knowledge.extract" });
        return json({ error: "That piece could not be read. Nothing was saved." }, 502);
      }
    }

    if (body.action === "importBatch") {
      const entries = (body as { entries?: unknown }).entries;
      if (!Array.isArray(entries) || entries.length === 0) {
        return json({ error: "Nothing selected." }, 400);
      }
      if (entries.length > MAX_IMPORT_ENTRIES) {
        return json({ error: `That is more than ${MAX_IMPORT_ENTRIES} entries in one go.` }, 400);
      }
      const source = cap(body.source, MAX_TOPIC).trim();

      // New entries go after everything already there, so an import never
      // reshuffles the order the team has arranged.
      const existing = listKnowledge(persona, true);
      let position = existing.reduce((highest, row) => Math.max(highest, row.position), 0) + 10;

      let saved = 0;
      for (const raw of entries) {
        const entry = raw as { topic?: unknown; body?: unknown };
        const text = cap(entry.body, MAX_BODY).trim();
        if (!text) continue;
        upsertKnowledge({
          persona,
          topic: cap(entry.topic, MAX_TOPIC).trim(),
          body: text,
          position,
          source,
        });
        position += 10;
        saved += 1;
      }

      recordAdminAction(session!.email, "knowledge:import", null, `${saved} from ${source}`.slice(0, 120));
      return json({ ok: true, saved });
    }

    if (body.action === "archiveSource") {
      const source = cap(body.source, MAX_TOPIC).trim();
      if (!source) return json({ error: "Which source?" }, 400);
      const archived = archiveKnowledgeBySource(persona, source);
      recordAdminAction(session!.email, "knowledge:archiveSource", null, `${archived} from ${source}`.slice(0, 120));
      return json({ ok: true, archived });
    }

    return json({ error: `Unknown action: ${String(body.action)}` }, 400);
  } catch (err) {
    reportError(err, { where: "knowledge.POST" });
    return json({ error: "That did not save. Nothing was changed." }, 500);
  }
};
