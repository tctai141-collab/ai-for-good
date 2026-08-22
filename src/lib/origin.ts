/**
 * Is this state-changing request coming from somewhere else?
 *
 * Lives here rather than in middleware.ts because that file imports
 * `astro:middleware`, a virtual module that only exists inside Astro's build —
 * so nothing in it can be reached from `bun test`. The origin check is the
 * single most security-relevant branch in the request path and it was
 * therefore the least testable thing in the app, which is the wrong way round.
 * No behaviour changed in the move.
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

  /*
   * When the origin is configured, it is the only answer.
   *
   * This used to add the request's own `X-Forwarded-Host` and `Host` on top,
   * which is the shape that makes a CSRF check circular: a caller who can set
   * both the Origin and the forwarded host passes trivially. A browser cannot
   * set either, so this was never exploitable from a victim's tab — but a
   * check that only works because of a property it does not verify is not
   * worth keeping in that form.
   */
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured) {
    try {
      add(new URL(configured).host);
      return hosts;
    } catch {
      // Misconfigured. Fall through to the request's own view, which still
      // gives the ordinary same-origin comparison.
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
export function crossSiteRequest(request: Request): boolean {
  if (SAFE_METHODS.has(request.method)) return false;

  /*
   * Sec-Fetch-Site is decided by the browser and cannot be set by script, so
   * when it is present it is the most trustworthy signal available. It is
   * checked first and on its own terms: `cross-site` is refused outright
   * rather than being weighed against a header the page could influence.
   */
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return true;

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
