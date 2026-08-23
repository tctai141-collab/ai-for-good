import type { APIRoute } from "astro";

/**
 * Render's liveness probe.
 *
 * The probe used to hit /api/session, which is the authentication endpoint: it
 * reads a cookie, touches the sessions table, and answers with whatever it
 * knows about the caller. Pointing infrastructure at it meant an unauthenticated
 * request every few seconds against the one route where getting the answer
 * wrong matters most, and it made the endpoint's logs useless for spotting
 * anything real.
 *
 * This says nothing but "the process is up". No version, no commit, no
 * database contents — a health check is read by anyone who finds it, and
 * version strings are how an attacker picks which advisory to try.
 */
export const GET: APIRoute = () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
