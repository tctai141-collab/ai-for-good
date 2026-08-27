import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The first-run walkthrough.
 *
 * Stepping through it is checked in the browser. What is pinned here is the
 * copy, which is a set of promises to the cohort, and the handful of decisions
 * that are silent when they go wrong.
 */

const onb = readFileSync("src/components/Onboarding.tsx", "utf-8");
const app = readFileSync("src/components/App.tsx", "utf-8");
const css = readFileSync("src/pages/index.astro", "utf-8");
const code = onb.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("who sees what", () => {
  test("founders and the operating team get different walkthroughs", () => {
    expect(onb).toContain("const FOUNDER: Step[]");
    expect(onb).toContain("const ORGANIZER: Step[]");
    /* Founder or not, rather than organizer or not: a mentor is shown the
       operating-team walkthrough, which describes what the dashboard is and
       what stays private — the parts about adding people simply do not apply
       to them, and a third set of copy for one person is worse than a
       paragraph they skip. */
    expect(code).toContain('role === "founder" ? FOUNDER : ORGANIZER');
  });

  test("it is raised on signing in, not on every visit", () => {
    /*
     * Hung off `enter` it would fire on every page load, since that also runs
     * when an existing session is restored.
     */
    const login = app.slice(app.indexOf("const handleLogin"), app.indexOf("if (splashing)"));
    expect(login).toContain("if (!hasOnboarded(data.user.email)) setOnboarding(true)");
    const restore = app.slice(app.indexOf("const enter ="), app.indexOf("}, []);", app.indexOf("const enter =")));
    expect(restore).not.toContain("setOnboarding");
  });

  test("the flag is per account, not per browser", () => {
    // Two people sharing a laptop should each get it once.
    expect(onb).toContain("`sprintbuddy.onboarded.${email}`");
  });

  test("storage being unavailable shows it again rather than throwing", () => {
    /*
     * Private browsing can deny localStorage entirely. Showing four paragraphs
     * twice is a much better failure than an exception on the way into the app.
     */
    const reads = code.slice(code.indexOf("export function hasOnboarded"));
    expect(reads).toContain("catch");
    expect(reads).toContain("return false");
  });
});

describe("the promises it makes", () => {
  test("the founder is told the team cannot read this", () => {
    // The single most important thing anyone can be told on first sight of a
    // box they are invited to think out loud in.
    expect(onb).toContain("Nothing you write is read by the team unless you deliberately share a conversation.");
  });

  test("the organizer is told the same thing from the other side", () => {
    /* The promise, not its punctuation: the sentence grew to cover check-in
       text and the assistant, and pinning the full stop failed on an
       improvement. */
    expect(onb).toContain("Founders' conversations are private");
    expect(onb).toContain("never what anybody wrote");
    expect(onb).toContain("tells them it was read, once");
    // The assistant reads the same briefing and no more; say so here too.
    expect(onb).toContain("The assistant sees exactly the same and nothing more.");
  });

  test("it describes features that exist", () => {
    /*
     * Onboarding is the first thing twenty founders read, and it had drifted:
     * it promised a one-tap check-in that was removed, and a "What's on" panel
     * that no longer exists. Copy about a screen nobody can find is worse than
     * no copy.
     */
    expect(onb).not.toContain("One tap");
    expect(onb).not.toContain("What's on");
    for (const real of ["Deadlines in the left panel", "Programme is the whole schedule", "Ask for something"]) {
      expect(onb).toContain(real);
    }
  });

  test("the deadline schedule matches what the mailer actually sends", () => {
    // three days, two days, ten hours, and the morning after.
    expect(onb).toContain("three days out, two days out, ten hours out, and once the morning after");
  });
});

describe("the dialog", () => {
  test("it brought no dependencies with it", () => {
    /*
     * The supplied version needs @radix-ui/react-dialog, react-icons,
     * react-slot, class-variance-authority and Tailwind. A native <dialog>
     * gives the focus trap, Escape, the inert background and ::backdrop for
     * free, which is most of what that package exists to reimplement.
     */
    const imports = [...onb.matchAll(/^\s*import[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]!);
    expect(imports).toEqual(["react"]);
    expect(code).toContain("dialog.showModal()");
    expect(css).toContain(".onb::backdrop");
  });

  test("focus lands on the primary action, not on Skip", () => {
    /*
     * showModal() focuses the first focusable child, which is Skip, and
     * React's autoFocus sets the attribute after mount, too late to be read.
     * Left alone the default keyboard action is to leave.
     */
    expect(code).toContain("nextRef.current?.focus()");
    expect(code).not.toContain("autoFocus");
  });

  test("escape counts as having seen it", () => {
    // Otherwise it reappears on the next sign-in for someone who has already
    // read it and pressed escape.
    expect(code).toContain('dialog.addEventListener("cancel", onCancel)');
    expect(code).toContain("event.preventDefault()");
  });

  test("no image is loaded from anywhere", () => {
    // The demo pulls a PNG from originui.com; this app's CSP is default-src
    // 'self' and would block it.
    expect(code).not.toContain("originui.com");
    expect(code).not.toContain("<img");
  });

  test("each step is announced rather than read once and forgotten", () => {
    expect(onb).toContain('<p className="onb-text" key={step}>');
    expect(onb).toContain('aria-labelledby="onb-title"');
  });
});
