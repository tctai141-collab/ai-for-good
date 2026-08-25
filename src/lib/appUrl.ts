/**
 * The one place that decides what URL this deployment is reachable at.
 *
 * There were two answers before, and one of them was a vulnerability.
 *
 * `baseUrl()` in the admin users route preferred PUBLIC_BASE_URL and then fell
 * back to the request's own `X-Forwarded-Host` / `Host`. That URL is what a
 * setup link is built from, and a setup link is emailed to a founder carrying a
 * single-use token that sets their password. A request header is chosen by
 * whoever sent the request, so with PUBLIC_BASE_URL unset — and it is
 * `sync: false` in render.yaml, meaning somebody has to remember to set it —
 * the app would email founders an activation link pointing at a host it was
 * told to point at. The mail is genuinely from the programme and the token is
 * genuinely valid, which is what makes that worth phishing with.
 *
 * `appUrl()` in reminders picked the other answer: configured value, else a
 * hardcoded domain, never a header. That one was right.
 *
 * So: configured value or nothing. No header, and no guessed constant either —
 * a wrong constant sends the whole cohort somewhere that 404s, which is a
 * different kind of silent failure. Callers that put a URL in an email must
 * handle the null and say what is missing.
 */

/** The configured public origin, without a trailing slash, or null. */
export function configuredAppUrl(): string | null {
  const raw = process.env.PUBLIC_BASE_URL?.trim();
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  // Only the two schemes a browser will follow to a login form.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  return `${parsed.origin}`;
}

/** What an operator is told when it is missing. Same wording everywhere. */
export const APP_URL_UNSET =
  "PUBLIC_BASE_URL is not set, so links in outgoing email cannot be built. " +
  "Set it to this deployment's public address and try again.";
