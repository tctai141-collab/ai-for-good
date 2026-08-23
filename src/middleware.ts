import { defineMiddleware } from "astro:middleware";
import { crossSiteRequest } from "./lib/origin";
import { startBackupScheduler } from "./lib/backup";
import { startReminderScheduler } from "./lib/reminders";
import { MAX_BODY_BYTES } from "./lib/limits";
import { reportError } from "./lib/errors";

// Module scope runs once when the server boots, which is the only start hook
// Astro gives us. No-ops outside production and when no backup target is set.
startBackupScheduler();
startReminderScheduler();

/**
 * Security headers applied to every response.
 *
 * The app was already served over HTTPS and free of mixed content, but none of
 * these were set. The referrer policy is the one that matters most here:
 * account setup links carry a single-use token in the URL, and the default
 * browser behaviour would put that whole URL in the Referer header of any
 * outbound request from that page — handing the token to a third party.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  if (crossSiteRequest(context.request)) {
    /*
     * Log it. This rejection happens before any route runs, so nothing else
     * records it — and when the expected-host set was wrong, that silence cost
     * about forty minutes: chat was broken on one hostname while twenty-four
     * hours of server logs showed only deploys and backups. A refusal that
     * leaves no trace is indistinguishable from a network fault.
     *
     * The origin and host are the two values needed to tell "somebody is
     * probing" from "we are refusing our own traffic", which are opposite
     * problems with the same status code.
     */
    reportError(new Error("cross-site request rejected"), {
      where: "csrf",
      level: "warning",
      extra: {
        method: context.request.method,
        path: new URL(context.request.url).pathname,
        origin: context.request.headers.get("origin") ?? "(none)",
        forwardedHost: context.request.headers.get("x-forwarded-host") ?? "(none)",
        host: context.request.headers.get("host") ?? "(none)",
      },
    });

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
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    );
  }

  // Don't let a browser second-guess a declared content type.
  response.headers.set("X-Content-Type-Options", "nosniff");

  // Nothing here uses any of these, so none of them should be reachable — by
  // this page or by anything that manages to run inside it.
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  );

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
