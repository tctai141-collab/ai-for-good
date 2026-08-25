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
   * The configured origin, when there is one, *and* the host the browser
   * actually addressed.
   *
   * A previous version made PUBLIC_BASE_URL the only answer, on the reasoning
   * that also trusting the request's own headers makes the check circular:
   * anyone who can set both Origin and X-Forwarded-Host passes trivially.
   * That reasoning is true and it does not matter, which is the point worth
   * writing down.
   *
   * CSRF is about a *browser* being made to send a request with credentials it
   * already holds. A browser sets Origin and Host itself and script cannot
   * change either, so the ordinary same-origin comparison is exactly the check
   * that is wanted. Someone who can forge both headers is not a browser and is
   * not carrying anybody's session cookie; there is nothing for them to ride.
   *
   * Excluding the request's own host, meanwhile, has a cost that already came
   * due. This service answers on its custom domain and on its onrender.com
   * address, and with only the configured host accepted, every state-changing
   * request from the second one was rejected — chat, check-in, deadlines and
   * sign-in — with a 403 that no log recorded. That is the regression the
   * "second hostname" test exists for.
   *
   * It matters more now than it did: setup links are built only from
   * PUBLIC_BASE_URL, so that variable has to be set on this deployment. If
   * setting it also silently narrowed the CSRF check to one hostname, fixing
   * the link would break the site.
   */
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured) {
    try {
      add(new URL(configured).host);
    } catch {
      // Misconfigured; the request's own view below still gives the
      // same-origin comparison.
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
