import type { APIRoute } from "astro";
import { advisorReplyStream, type ChatMessage } from "../../../lib/ai";
import { ADMIN_ASSISTANT_SYSTEM, buildAdminContext } from "../../../lib/admin-context";
import { getSessionUser } from "../../../lib/auth";
import { reportError } from "../../../lib/errors";
import { capHistory, chatLimiter, readJsonBody } from "../../../lib/limits";

/**
 * The operating team's assistant.
 *
 * Organizers only, and not because mentors are untrusted: the briefing it
 * answers from is the whole cohort's state — every founder's attention score,
 * who is behind on what — and a mentor's view of this app is deliberately
 * narrower than that. Widening it through a chat box would be a strange way to
 * make that decision.
 *
 * The briefing is rebuilt on every message rather than cached with the
 * conversation. It is small, it changes as the day goes on, and an assistant
 * answering "who is behind" from a snapshot taken an hour ago is worse than
 * one that takes a moment longer.
 *
 * What is in that briefing, and the line it does not cross, is in
 * lib/admin-context.ts. The short version: exactly what an organizer can
 * already read on /admin, and nothing a founder wrote in private.
 */

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const session = getSessionUser(cookies);
    if (!session) return json({ error: "Not signed in." }, 401);
    if (session.role !== "organizer") return json({ error: "Organizers only." }, 403);

    const read = await readJsonBody<{ messages?: unknown; briefing?: unknown }>(request);
    if (!read.ok) return read.response;

    /*
     * "Show me what you can see."
     *
     * An assistant that claims a privacy boundary should be able to prove it.
     * This returns the exact text the model is given, so an organizer can read
     * it and check for themselves that no founder's writing is in there rather
     * than taking the claim on faith. It also makes the boundary testable
     * without spending anything at the model.
     */
    if (read.value.briefing === true) {
      return json({ text: buildAdminContext().text });
    }

    const raw = Array.isArray(read.value.messages) ? read.value.messages : [];
    const messages: ChatMessage[] = raw
      .filter((m): m is ChatMessage =>
        Boolean(m) && typeof (m as ChatMessage).role === "string" && typeof (m as ChatMessage).content === "string")
      .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

    if (!messages.some((m) => m.role === "user")) {
      return json({ error: "Nothing to answer." }, 400);
    }

    /* Same limiter as the founder chat. This costs the same money, and an
       organizer holding down enter is the same problem. */
    const limited = chatLimiter.check(session.email);
    if (limited) {
      return json(
        { error: "You are sending messages very quickly. Give it a moment." },
        429,
      );
    }

    const snapshot = buildAdminContext();

    return new Response(
      advisorReplyStream({
        persona: ADMIN_ASSISTANT_SYSTEM,
        system: `THE BRIEFING\n\n${snapshot.text}`,
        messages: capHistory(messages),
        maxTokens: 1200,
      }),
      {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      },
    );
  } catch (error) {
    reportError(error, { where: "admin.assistant.POST" });
    return json({ error: "The assistant is unavailable right now." }, 500);
  }
};
