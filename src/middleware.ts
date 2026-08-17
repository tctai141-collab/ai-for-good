import { defineMiddleware } from "astro:middleware";
import { startBackupScheduler } from "./lib/backup";

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
export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();

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

  return response;
});
