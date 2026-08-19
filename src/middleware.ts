import { defineMiddleware } from "astro:middleware";
import { startBackupScheduler } from "./lib/backup";
import { MAX_BODY_BYTES } from "./lib/limits";
import { reportError } from "./lib/errors";

// Module scope runs once when the server boots, which is the only start hook
// Astro gives us. No-ops outside production and when no backup target is set.
startBackupScheduler();

/**
 * Security headers applied to every response.
 *
 * The app was already served over HTTPS and free of mixed content, but none of
 * these were set. The referrer policy is the one that matters most here:
 * account setup links carry a single-use token in the URL, and the default
 * browser behaviour would put that whole URL in the Referer header of any
 * outbound request from that page — handing the token to a third party.
 */
/** Methods that cannot change state, and so need no origin check. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Every host this deployment legitimately answers on.
 *
 * Render terminates TLS and forwards over plain HTTP, so the URL the server
 * sees is http:// on an internal host while the browser sent https:// on a
 * public one. Comparing full origins therefore never matches in production;
 * comparing hosts does, and the protocol adds nothing here because HSTS is set.
 *
 * The set matters as much as the comparison. An earlier version trusted only
 * PUBLIC_BASE_URL, which is correct for one domain and wrong for this service —
 * it also answers on its onrender.com address, and every state-changing request
 * from that host was rejected with a 403 that no log recorded. The security
 * property we actually want is the ordinary same-origin one: the Origin the
 * browser reports must match the host the browser addressed. A page on another
 * origin cannot forge either — it cannot set Host, and it cannot add
 * X-Forwarded-Host without triggering a preflight this app never approves.
 */
function acceptableHosts(request: Request): Set<string> {
  const hosts = new Set<string>();

  const add = (value: string | null | undefined) => {
    if (!value) return;
    const first = value.split(",")[0]!.trim().toLowerCase();
    if (first) hosts.add(first);
  };

  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured) {
    try {
      add(new URL(configured).host);
    } catch {
      // Misconfigured; the request's own headers still apply below.
    }
  }

  add(request.headers.get("x-forwarded-host"));
  add(request.headers.get("host"));

  return hosts;
}

/**
 * Rejects state-changing requests that did not come from this site.
 *
 * Stricter than what it replaces: it covers every unsafe method whatever the
 * content type, so the JSON endpoints this app is made of are actually
 * protected rather than skipped. The session cookie is already SameSite=Lax,
 * which is the primary defence; this is the second one.
 */
function crossSiteRequest(request: Request): boolean {
  if (SAFE_METHODS.has(request.method)) return false;

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const claimed = origin ?? referer;
  // A browser always sends Origin on an unsafe method. Nothing else legitimate
  // reaches these routes, so a request without either header is not ours.
  if (!claimed) return true;

  let claimedHost: string;
  try {
    claimedHost = new URL(claimed).host.toLowerCase();
  } catch {
    return true;
  }

  const allowed = acceptableHosts(request);
  if (allowed.size === 0) return true;
  return !allowed.has(claimedHost);
}

export const onRequest = defineMiddleware(async (context, next) => {
  if (crossSiteRequest(context.request)) {
    return new Response(JSON.stringify({ error: "Cross-site request rejected." }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Reject oversized bodies before any handler touches them. A 20 MB write was
  // accepted in 112 ms onto a 1 GB disk, so ~50 requests could fill it and take
  // the database down with the app.
  const declared = Number(context.request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    try {
      // Read the body to the end and throw it away before replying.
      //
      // Cancelling the stream is not enough through the node adapter: the
      // unread remainder stays in the socket and desynchronises the keep-alive
      // connection, so the *next* request on it is parsed as body bytes and
      // hangs. Draining costs a read we discard; nothing is ever written to
      // disk, which is what this limit exists to protect.
      const reader = context.request.body?.getReader();
      if (reader) {
        for (;;) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
    } catch {
      // Client hung up; nothing left to discard.
    }
    return new Response(
      JSON.stringify({ error: "That request is too large." }),
      {
        status: 413,
        headers: { "Content-Type": "application/json", Connection: "close" },
      },
    );
  }

  // Anything a route did not catch itself ends up here. Without this an
  // unexpected throw became an empty 500 with no record anywhere.
  let response: Response;
  try {
    response = await next();
  } catch (error) {
    reportError(error, {
      where: "unhandled",
      extra: { path: new URL(context.request.url).pathname, method: context.request.method },
    });
    response = new Response(
      JSON.stringify({ error: "Something went wrong. Please try again." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // Never leak a path — and therefore never a setup token — to another origin.
  response.headers.set("Referrer-Policy", "no-referrer");

  // After one visit over HTTPS, the browser refuses to try plain HTTP for this
  // host at all, so there is no unencrypted first request to intercept.
  // Only meaningful when already served over TLS.
  const proto =
    context.request.headers.get("x-forwarded-proto") ??
    new URL(context.request.url).protocol.replace(":", "");
  if (proto === "https") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000");
  }

  // Don't let a browser second-guess a declared content type.
  response.headers.set("X-Content-Type-Options", "nosniff");

  // Nothing here is meant to be embedded; refusing framing removes a
  // clickjacking route to the admin controls.
  response.headers.set("X-Frame-Options", "DENY");

  // Content Security Policy. 'unsafe-inline' is required for both styles and
  // scripts: the pages carry inline <style> blocks and Astro emits inline
  // module scripts, and React sets inline styles throughout. So this is not a
  // strong XSS defence — it is a backstop that still blocks the parts worth
  // blocking: no plugins, no framing, no form posts off-origin, and no
  // connections to anywhere but this origin and the font host.
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  );

  return response;
});
