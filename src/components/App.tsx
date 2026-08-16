import React, { useState, useCallback, useEffect } from "react";
import SprintBuddyCube from "./SprintBuddyCube";
import FounderOS from "./FounderOS";
import { loadUserData, initUser, type UserData } from "../lib/persistence";

type Role = "founder" | "organizer";

/**
 * Who the server says you are. The browser no longer holds any account list or
 * checks any password — it did both before, which meant the credentials shipped
 * to everyone who loaded the page.
 */
type SessionUser = {
  email: string;
  name: string;
  role: Role;
};

const STARTUP_TIPS = [
  "If your roadmap needs a legend, it is not a roadmap. It is a treasure map with burn rate.",
  "Talk to one customer before adding one feature. The feature will wait. The customer may not.",
  "A tiny launch beats a perfect secret. Secrets do not compound.",
  "If the metric only goes up in slides, it is probably a decorative metric.",
  "Write the awkward email while the coffee is still hot. Momentum has a short attention span.",
  "Your cofounder cannot read your mind. This is unfortunate, but currently still true.",
  "Do the boring distribution work. The product fairy has limited office hours.",
  "If everyone is aligned except reality, invite reality to the next standup.",
  "Aalti note: vibes are not a financing instrument.",
  "The best MVP is embarrassing in the exact places customers do not care about.",
  "If a feature needs a meeting to explain why it matters, it is applying for deletion.",
  "Replace one strategy document with one uncomfortable user call.",
  "Your pitch deck is not traction. It is traction cosplay with nicer fonts.",
  "The customer who sends a calendar invite is worth ten who say 'interesting'.",
  "A deadline without an owner is just a calendar decoration.",
  "If you cannot name the riskiest assumption, the riskiest assumption is you.",
  "The fastest way to settle a debate is to let reality vote by Friday.",
  "Never confuse a prettier mockup with a stronger signal.",
  "If the answer is 'we need more data', ask what decision the data would actually change.",
  "Your users are not hiding in the Notion doc. Tragic, but actionable.",
  "If nobody is slightly annoyed by the scope cut, you probably did not cut enough.",
  "Investor feedback is useful. Customer behavior is evidence.",
  "Sleep is not a vanity metric.",
  "The meeting starts when someone says the uncomfortable sentence.",
  "If the launch plan depends on everyone remembering everything, Aalti has concerns.",
  "Good founder energy: stubborn about the mission, suspicious of the current plan.",
  "Aalti's favorite KPI is things learned the hard way before spending money.",
  "A roadmap is a hypothesis wearing office clothes.",
  "If a channel only works when the founder personally begs, congratulations, you found the starting point.",
  "The market does not owe your clever idea a standing ovation.",
  "Aalti checked: the user still has not read the onboarding copy.",
  "A beautiful dashboard cannot rescue a confused customer.",
  "One paying user is louder than twenty polite compliments.",
  "If the problem is urgent, someone has already hacked together a bad workaround. Go find it.",
  "Aalti recommends fewer promises and more receipts.",
  "The best cofounder conversation is the one you stop rehearsing and actually have.",
  "If your product only works in the demo, your demo is the product. Awkward.",
  "Cut the feature that sounds impressive but changes no behavior.",
];

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [buddyStage, setBuddyStage] = useState<"login" | "docked">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  /** Loads a signed-in user's data and drops them into the app. */
  const enter = useCallback(async (signedIn: SessionUser) => {
    try {
      await initUser();
      if (signedIn.role === "founder") {
        setUserData(await loadUserData(signedIn.email));
      }
    } catch {
      // Their data can be re-fetched; don't block sign-in on it.
    }
    setUser(signedIn);
    setBuddyStage("docked");
  }, []);

  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json())
      .then(async (data: { user: SessionUser | null }) => {
        if (data.user) await enter(data.user);
        setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [enter]);

  const handleSignOut = useCallback(async () => {
    setUser(null);
    setUserData(null);
    setBuddyStage("login");
    fetch("/api/session", { method: "DELETE" }).catch(() => {});
  }, []);

  const handleLogin = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setLoginError(null);

    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await response.json() as { user?: SessionUser; error?: string };

      // The server decides. A rejected login must never fall through to the
      // app — the previous version signed you in anyway when this failed.
      if (!response.ok || !data.user) {
        setLoginError(data.error || "Could not sign you in. Try again.");
        setLoading(false);
        return;
      }

      setPassword("");
      await enter(data.user);
    } catch {
      setLoginError("Could not reach the server. Check your connection.");
    }

    setLoading(false);
  }, [email, password, enter]);

  if (checking) {
    return (
      <main className="login-screen" aria-busy="true">
        <div className="login-panel" style={{ display: "grid", placeItems: "center", minHeight: "60vh", margin: "auto" }}>
          <div className="pulse-dot" style={{ width: 12, height: 12, borderRadius: 12, background: "var(--brand-blue)" }} />
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <>
        <main className="login-screen">
          <section className="login-hero" aria-label="Sprint Buddy login">
            <div className="login-mascot-panel" aria-hidden="true">
              <div className="login-halo" />
              <div className="login-mascot login-mascot-anchor" />
            </div>
            <div className="login-panel" aria-labelledby="login-title">
              <h1 id="login-title" className="login-title">
                <span className="login-title-line login-title-line--buddy">Sprint Buddy</span>
                <span className="login-title-divider" aria-hidden="true">x</span>
                <span className="login-title-line login-title-line--os">Founder OS</span>
              </h1>
              <p style={{ margin: "-8px 0 18px", color: "var(--ink-sub)", fontSize: 14, lineHeight: 1.5 }}>
                Meet Aalti!
              </p>

              <form className="login-form" onSubmit={handleLogin}>
                <label className="login-field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                  />
                </label>
                <label className="login-field">
                  <span>Password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </label>
                <div className="login-meta">
                  <button
                    className="login-forgot"
                    type="button"
                    onClick={() => setLoginError("Ask the Sprint team to send you a new setup link.")}
                  >
                    Forgot password?
                  </button>
                </div>
                {loginError && <p className="login-error" role="alert">{loginError}</p>}
                <button className="login-submit" type="submit" disabled={loading}>
                  {loading ? "Loading..." : "Continue"}
                </button>
              </form>
            </div>
          </section>
        </main>
        <PersistentBuddy stage={buddyStage} />
      </>
    );
  }

  if (user.role === "organizer") {
    return (
      <>
        <FounderOS persona="coach" userEmail={user.email} onSignOut={handleSignOut} />
        <a
          href="/admin"
          style={{
            position: "fixed",
            top: 18,
            // Clear of the docked mascot, which sits in the top-right corner.
            right: 130,
            zIndex: 40,
            fontSize: 13,
            padding: "6px 12px",
            borderRadius: 9,
            border: "1px solid rgba(255,255,255,0.14)",
            color: "var(--ink-sub)",
            background: "rgba(14,15,18,0.85)",
            textDecoration: "none",
          }}
        >
          Cohort admin
        </a>
        <PersistentBuddy stage={buddyStage} />
      </>
    );
  }

  return (
    <>
      <FounderOS
        key={user.email}
        persona="founder"
        userEmail={user.email}
        initialData={userData || undefined}
        onSignOut={handleSignOut}
      />
      <PersistentBuddy stage={buddyStage} />
    </>
  );
}

function PersistentBuddy({ stage }: { stage: "login" | "docked" }) {
  const [tipIndex, setTipIndex] = useState(0);
  const [tipVisible, setTipVisible] = useState(false);
  const [reaction, setReaction] = useState<"wink" | "look-down" | "look-up" | null>(null);
  const isDocked = stage === "docked";

  useEffect(() => {
    if (!tipVisible) return;
    const timeout = window.setTimeout(() => setTipVisible(false), 7500);
    return () => window.clearTimeout(timeout);
  }, [tipVisible, tipIndex]);

  const showTip = useCallback(() => {
    setTipIndex((current) => tipVisible ? (current + 1) % STARTUP_TIPS.length : current);
    setTipVisible(true);
    setReaction((current) => current === "wink" ? "look-up" : "wink");
  }, [tipVisible]);

  return (
    <div className={`persistent-buddy persistent-buddy--${stage}`} aria-hidden={isDocked ? undefined : "true"}>
      {isDocked && tipVisible && (
        <div className="buddy-tip" role="status">
          <span className="buddy-tip-arrow" aria-hidden="true" />
          <p>{STARTUP_TIPS[tipIndex]}</p>
        </div>
      )}
      <SprintBuddyCube
        compact={isDocked}
        size="var(--buddy-size)"
        onTip={isDocked ? showTip : undefined}
        reaction={reaction}
      />
    </div>
  );
}
