import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createFounder, createOrganizer, get, startServer, type Harness, type Session } from "./helpers/harness";

/**
 * Sessions are stored as SHA-256 of the cookie value, so a test poking at the
 * row has to hash the same way production does. If this drifts, the tests
 * silently match nothing and pass for the wrong reason.
 */
function sessionKey(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

/**
 * Signing out must actually end the session.
 *
 * It did not, in production, for the entire life of the deployment. The client
 * sent `fetch("/api/session", { method: "DELETE" })` with no body and so no
 * Content-Type, and Astro's CSRF guard treats a request with no content type as
 * a form submission. The guard then compares the Origin header against the URL
 * the server believes it is serving — which behind Render's TLS-terminating
 * proxy is http:// while the browser sends https:// — so it answered 403 before
 * the route ran. The client swallowed the error and rendered the login screen
 * anyway, so it looked like it had worked until you opened a new tab and were
 * still signed in.
 *
 * These tests therefore send the header shape a browser behind that proxy
 * sends, including the mismatched Origin. Without it, a local run matches
 * origins and passes while production keeps failing — which is precisely the
 * gap that let this ship.
 */

let h: Harness;
let organizer: Session;
let founder: Session;

/**
 * The headers Render's proxy leaves a request carrying: the browser's real
 * https origin, and a forwarded host that does not match the internal one the
 * server is actually listening on. Reproducing that mismatch is the point —
 * without it a local run passes while production keeps failing, which is the
 * gap that let this ship.
 */
const proxied = (cookie: string) => ({
  cookie,
  origin: "https://aaltofoundersprint.com",
  referer: "https://aaltofoundersprint.com/",
  "x-forwarded-host": "aaltofoundersprint.com",
  "x-forwarded-proto": "https",
});

async function signOut(cookie: string) {
  return fetch(`${h.url}/api/session`, {
    method: "DELETE",
    // Exactly what the client sends. If this drifts, the test stops covering it.
    headers: { ...proxied(cookie), "Content-Type": "application/json" },
  });
}

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
  founder = await createFounder(h, organizer, "founder@example.test", "Aino", "founder-password-11");
});

afterAll(() => h?.stop());

describe("the session cookie survives the app being closed", () => {
  test("it carries both Max-Age and Expires", async () => {
    /*
     * A founder signed into the installed iOS app, force-quit it, reopened it
     * and was asked to sign in again — the behaviour of a session cookie, not
     * of one with a fortnight on it.
     *
     * RFC 6265 says Max-Age wins where both are present, so on a browser that
     * follows the spec Expires changes nothing. It is here for WebKit, which
     * has a history of mishandling Max-Age-only cookies in home-screen web
     * apps. Honestly labelled: a mitigation, not a confirmed diagnosis — the
     * other suspect is iOS not flushing the cookie before the kill.
     *
     * Pinned because it looks redundant, and the next person to tidy it away
     * would have no way of knowing why it was added.
     */
    const h2 = await startServer();
    try {
      await createOrganizer(h2, "cookie@example.test");
      const res = await fetch(`${h2.url}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: h2.url },
        body: JSON.stringify({
          action: "login",
          email: "cookie@example.test",
          password: "organizer-password-1",
        }),
      });
      const raw = (res.headers.getSetCookie?.() ?? []).join(";");
      expect(raw).toMatch(/Max-Age=\d+/i);
      expect(raw).toMatch(/Expires=/i);
      // Both must describe the same fortnight, or one of them is a lie.
      const maxAge = Number(raw.match(/Max-Age=(\d+)/i)![1]);
      expect(maxAge).toBe(14 * 24 * 60 * 60);
      const expires = Date.parse(raw.match(/Expires=([^;]+)/i)![1]!);
      const drift = Math.abs(expires - (Date.now() + maxAge * 1000));
      expect(drift).toBeLessThan(60_000);
    } finally {
      h2.stop();
    }
  });

  test("and is still HttpOnly, Secure and Lax", async () => {
    // The attributes that make it worth having. Asserted alongside the two
    // above so a change to the expiry cannot quietly drop one of these.
    const h2 = await startServer();
    try {
      await createOrganizer(h2, "attrs@example.test");
      const res = await fetch(`${h2.url}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: h2.url },
        body: JSON.stringify({
          action: "login",
          email: "attrs@example.test",
          password: "organizer-password-1",
        }),
      });
      const raw = (res.headers.getSetCookie?.() ?? []).join(";");
      expect(raw).toContain("HttpOnly");
      expect(raw).toContain("Secure");
      expect(raw).toContain("SameSite=Lax");
      expect(raw).toContain("Path=/");
    } finally {
      h2.stop();
    }
  });
});

describe("signing out", () => {
  test("is accepted from a browser behind a TLS-terminating proxy", async () => {
    const session = await createFounder(h, organizer, "proxy@example.test", "Proxy", "proxy-password-11");
    const response = await signOut(session.cookie);
    // A 403 here is the original bug: the CSRF guard rejecting a same-site
    // sign-out because the proxy makes the origins look different.
    expect(response.status).toBe(200);
  });

  test("kills the token, not just the cookie in the browser", async () => {
    const session = await createFounder(h, organizer, "gone@example.test", "Gone", "gone-password-112");

    expect((await get(h, "/api/session", session.cookie)).status).toBe(200);
    const before = (await (await get(h, "/api/session", session.cookie)).json()) as { user: unknown };
    expect(before.user).not.toBeNull();

    await signOut(session.cookie);

    // The cookie a closed tab still holds must no longer identify anyone. This
    // is the user-visible symptom: sign out, close the tab, reopen the URL,
    // and be signed straight back in.
    const after = (await (await get(h, "/api/session", session.cookie)).json()) as { user: unknown };
    expect(after.user).toBeNull();
  });

  test("locks the old cookie out of protected routes", async () => {
    const session = await createFounder(h, organizer, "locked@example.test", "Locked", "locked-password-11");
    expect((await get(h, "/api/deadlines", session.cookie)).status).toBe(200);

    await signOut(session.cookie);

    expect((await get(h, "/api/deadlines", session.cookie)).status).toBe(401);
  });

  test("deletes the row rather than leaving it to expire", async () => {
    const session = await createFounder(h, organizer, "row@example.test", "Row", "row-password-1122");
    const token = session.cookie.split("=")[1]!;

    const db = h.db();
    try {
      const before = db.query("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = $token").get({ $token: sessionKey(token) }) as { n: number };
      expect(before.n).toBe(1);

      await signOut(session.cookie);

      const after = db.query("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = $token").get({ $token: sessionKey(token) }) as { n: number };
      expect(after.n).toBe(0);
    } finally {
      db.close();
    }
  });

  test("clears the cookie in the response as well", async () => {
    const session = await createFounder(h, organizer, "cookie@example.test", "Cookie", "cookie-password-11");
    const response = await signOut(session.cookie);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("sb_session=");
    // An expiry in the past is how a cookie is removed.
    expect(setCookie.toLowerCase()).toContain("expires=thu, 01 jan 1970");
  });

  test("does not depend on the client sending a Content-Type", async () => {
    /*
     * The original bug in one line. The client sent no body and therefore no
     * content type, and that alone was enough to be rejected. Sign-out must not
     * be fragile to a header a bodyless request has no reason to carry, so this
     * sends the shape that used to fail.
     */
    const session = await createFounder(h, organizer, "bare@example.test", "Bare", "bare-password-1122");
    const response = await fetch(`${h.url}/api/session`, {
      method: "DELETE",
      headers: proxied(session.cookie),
    });
    expect(response.status).toBe(200);

    const after = (await (await get(h, "/api/session", session.cookie)).json()) as { user: unknown };
    expect(after.user).toBeNull();
  });

  test("leaves other people's sessions alone", async () => {
    // Signing out of a laptop must not sign you out of a phone, and must
    // certainly not sign out anybody else.
    const other = await createFounder(h, organizer, "other@example.test", "Other", "other-password-112");
    await signOut(other.cookie);

    const stillIn = (await (await get(h, "/api/session", founder.cookie)).json()) as { user: { email: string } | null };
    expect(stillIn.user?.email).toBe("founder@example.test");
  });
});
