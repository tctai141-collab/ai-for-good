import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createOrganizer, get, post, startServer, tokenFromEmail, type Harness, type Session } from "./helpers/harness";

/**
 * Setting a password.
 *
 * Redeeming a setup link used to sign the founder straight in. Tai: it should
 * not let them into the page right away, just tell them it worked and send
 * them back to sign in.
 */

let h: Harness;
let organizer: Session;

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
});

afterAll(() => h?.stop());

/*
 * The token as the founder actually receives it, out of the dev mailbox.
 * `inviteToken` only knows the organizer's seeded one; invites are stored as
 * SHA-256, so a token issued through the admin API cannot be read back from a
 * row, which is the point of that change.
 */
const invite = async (email: string) => {
  const res = await post(
    h,
    "/api/admin/users",
    { action: "add", email, name: "New Founder", role: "founder" },
    organizer.cookie,
  );
  if (!res.ok) throw new Error(`could not create ${email}: ${await res.text()}`);
  const token = tokenFromEmail(h, email);
  if (!token) throw new Error(`no setup link emailed to ${email}`);
  return token;
};

describe("redeeming a setup link", () => {
  test("it sets the password without opening a session", async () => {
    /*
     * The safer shape as well as the one asked for. On a reset it means a
     * stolen live session cannot outlive the password change, and on first
     * setup it means the founder types the new password once before they
     * depend on it — the only moment anyone discovers that what their password
     * manager saved is not what they think it is.
     */
    const email = "nosession@example.test";
    const token = await invite(email);

    const res = await post(h, "/api/invite", { token, password: "a-good-long-password" });
    expect(res.status).toBe(200);

    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).not.toContain("sb_session=");
  });

  test("the password it set is the one that works", async () => {
    const email = "worksafter@example.test";
    const token = await invite(email);
    await post(h, "/api/invite", { token, password: "a-good-long-password" });

    const good = await post(h, "/api/session", {
      action: "login", email, password: "a-good-long-password",
    });
    expect(good.status).toBe(200);

    const bad = await post(h, "/api/session", { action: "login", email, password: "wrong-password-here" });
    expect(bad.status).not.toBe(200);
  });

  test("a reset kills every existing session", async () => {
    /*
     * This was already true and has to stay true now that nothing replaces
     * them: the account must not be left reachable by a session opened with
     * the password that was just changed.
     */
    const email = "resetter@example.test";
    const token = await invite(email);
    await post(h, "/api/invite", { token, password: "first-long-password" });
    const signedIn = await post(h, "/api/session", {
      action: "login", email, password: "first-long-password",
    });
    const cookie = (signedIn.headers.get("set-cookie") ?? "").split(";")[0]!;
    expect((await get(h, "/api/session", cookie)).status).toBe(200);

    await post(h, "/api/admin/users", { action: "reinvite", email }, organizer.cookie);
    const second = tokenFromEmail(h, email);
    if (!second) throw new Error("no reset link emailed");
    await post(h, "/api/invite", { token: second, password: "second-long-password" });

    const after = await get(h, "/api/session", cookie);
    const body = await after.json();
    expect(body.user).toBeNull();
  });
});

describe("the page", () => {
  const page = readFileSync("src/pages/setup.astro", "utf-8");
  const api = readFileSync("src/pages/api/invite.ts", "utf-8");
  const gradient = readFileSync("src/lib/animatedGradient.ts", "utf-8");

  test("it tells them it worked and points them back", async () => {
    expect(page).toContain("Password set");
    expect(page).toContain("Head back to the sign-in page and use it.");
    expect(page).toContain('id="done-link"');
  });

  test("it no longer redirects into the app", () => {
    expect(page).not.toContain('location.replace("/")');
    expect(api).not.toContain("startSession(cookies");
  });

  test("the spent link is taken out of the address bar", () => {
    // A setup link is a credential. Leaving it in the URL after use means the
    // back button can put it back on screen.
    expect(page).toContain('history.replaceState(null, "", location.pathname)');
  });

  test("the gradient is a backdrop, not a requirement", () => {
    /*
     * This is the page where a founder sets their password. If WebGL2 is
     * missing the mount returns null and the canvas is removed, rather than
     * leaving an empty element and a page that looks broken.
     */
    expect(page).toContain("if (canvas && !mountAnimatedGradient(canvas)) canvas.remove()");
    expect(gradient).toContain("if (!gl) return null");
    // The canvas is decoration; the markup is on the page, not in the module.
    expect(page).toContain('<canvas id="backdrop" aria-hidden="true">');
  });

  test("the shader is checked for compiling", () => {
    // A shader that fails to compile links into a program that draws nothing,
    // silently, and the page just looks blank.
    expect(gradient).toContain("gl.getShaderParameter(shader, gl.COMPILE_STATUS)");
    expect(gradient).toContain("gl.getProgramParameter(program, gl.LINK_STATUS)");
  });

  test("it stops when nothing is watching, and caps the pixel ratio", () => {
    // Raw devicePixelRatio on a 3x phone is nine times the fragments through a
    // loop of up to 30 swirl iterations.
    expect(gradient).toContain("Math.min(window.devicePixelRatio || 1, 2)");
    expect(gradient).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(gradient).toContain('window.matchMedia("(prefers-reduced-motion: reduce)").matches');
  });
});
