import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The first-run walkthrough, for founders and for the operating team.
 *
 * Built on the native <dialog> element rather than the supplied Radix one.
 * That is not a shortcut: showModal() gives the focus trap, the Escape key,
 * the inert background and the backdrop pseudo-element for free, all of which
 * @radix-ui/react-dialog exists to reimplement in userland. The supplied
 * version also needs @radix-ui/react-icons, @radix-ui/react-slot,
 * class-variance-authority and Tailwind, none of which are here.
 *
 * The demo's illustration is a PNG from originui.com. This app's CSP is
 * default-src 'self', so that image would be blocked outright; each step draws
 * its own mark instead.
 */

type Step = { title: string; body: string };

const FOUNDER: Step[] = [
  {
    title: "This is your space, not the team's",
    body:
      "Think out loud here. Sprint Buddy is software, not a person, and it carries what this programme's mentors teach. Nothing you write is read by the team unless you deliberately share a conversation.",
  },
  {
    title: "Check in when you have a minute",
    body:
      "Three questions, once a day. Over the sprint they become the record of what actually happened, which is worth more in December than any of it feels in September.",
  },
  {
    title: "Deadlines find you",
    body:
      "Deadlines in the left panel shows what is due and what is late. You also get an email three days out, two days out, ten hours out, and once the morning after. Tick something off and all of them stop.",
  },
  {
    title: "The programme, and asking for things",
    body:
      "Programme is the whole schedule, as a timeline or a calendar. Ask for something goes to the organisers or the mentors by name, and their reply comes back in the same place.",
  },
  {
    title: "Share a conversation on purpose",
    body:
      "If you want a coach to read one, the button at the top of the thread hands it over. You can take it back at any time, and you are told once it has been read.",
  },
];

const ORGANIZER: Step[] = [
  {
    title: "Two places, and they do different jobs",
    body:
      "This dashboard is for reading the cohort: the heatmap, the programme, and an assistant you can ask who to talk to this week. Cohort admin is for changing things: people, deadlines, the schedule, and what Sprint Buddy knows.",
  },
  {
    title: "What you can read, and what you cannot",
    body:
      "Founders' conversations are private, and so are the words of their check-ins. You see attention scores, themes and trends, never what anybody wrote, unless they hand a conversation over. Opening one of those tells them it was read, once. The assistant sees exactly the same and nothing more.",
  },
  {
    title: "Set deadlines and the schedule",
    body:
      "A deadline emails itself to whoever has not ticked it off. The Programme tab holds everything with a date on it, sessions and milestones and the trip, and that is what the cohort sees under Programme.",
  },
  {
    title: "Talk to the whole cohort",
    body:
      "Broadcast sends one message to everyone registered, addressed to each founder by name. It will not send until you have received that exact wording yourself. Use it for the things that would otherwise be twenty separate emails.",
  },
];

/*
 * The last step, appended for whoever can act on it, whatever their role: the
 * cohort and the operating team both read this on a phone.
 *
 * It is here rather than in a banner of its own because there is no good later
 * moment. Safari has no install prompt — Add to Home Screen is three taps into
 * a share sheet — so if nobody says it, almost nobody finds it, and a banner
 * competing with this dialog on a founder's first minute is two pieces of
 * instructional UI where one will do.
 */
const INSTALL: Step = {
  title: "Put it on your home screen",
  body:
    "Open this in Safari or Chrome first if you tapped through from your email. Then choose Add to Home Screen \u2014 on iPhone it is under Share \u2014 and it opens like any other app. It will ask you to sign in once more: the installed app keeps its own login.",
};

/**
 * Can this person actually do what that step describes?
 *
 * Written out here rather than imported from a helper on purpose: this file's
 * test asserts it imports from "react" and nothing else, which is what keeps
 * the walkthrough free of the dependency stack the supplied dialog wanted.
 */
function installable(): boolean {
  try {
    /* Already installed, in which case the step is describing something they
       have done. iOS answers on navigator; everyone else on the media query. */
    if ((navigator as { standalone?: boolean }).standalone === true) return false;
    if (window.matchMedia("(display-mode: standalone)").matches) return false;
    /* A phone or a tablet. On a laptop there is no share sheet and no install
       item, so the step would be about somebody else's device.

       This asks about the device when the real question is the browser, and
       the gap is a live one here rather than a hypothetical: founders arrive
       through an emailed setup link, which on a phone opens inside the mail
       client's own webview, where the pointer is coarse and Add to Home Screen
       does not exist. Sniffing for those webviews is a losing game, so the
       copy opens by telling them to move to Safari or Chrome first, which is
       true advice in that case and harmless in every other. */
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    /* Nothing here is worth falling over for. One step fewer is the safe
       direction, the same way an unreadable localStorage shows the walkthrough
       again rather than throwing. */
    return false;
  }
}

/** localStorage key. Per account, so two people sharing a laptop each get it. */
const seenKey = (email: string) => `sprintbuddy.onboarded.${email}`;

export function hasOnboarded(email: string): boolean {
  try {
    return localStorage.getItem(seenKey(email)) === "1";
  } catch {
    /* Private browsing with storage denied. Better to show the walkthrough
       again than to throw on the way into the app. */
    return false;
  }
}

export default function Onboarding({
  email,
  role,
  onClose,
}: {
  email: string;
  role: "founder" | "organizer" | "mentor";
  onClose: () => void;
}) {
  /* A mentor is shown the operating-team walkthrough. It describes what the
     dashboard is and what is private, which is exactly what they need; the
     parts about adding people simply do not apply to them, and writing a
     third set of copy for one person is worse than a paragraph they skip. */
  const base = role === "founder" ? FOUNDER : ORGANIZER;
  /* Read once, on mount, not at module scope: at module scope this file is
     evaluated before there is a window to ask, and the answer would be the
     same for every device that ever loads the bundle. */
  const [canInstall] = useState(installable);
  const steps = canInstall ? [...base, INSTALL] : base;
  const [step, setStep] = useState(0);
  const ref = useRef<HTMLDialogElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const finish = useCallback(() => {
    try {
      localStorage.setItem(seenKey(email), "1");
    } catch {
      /* Nothing to do: they will see it again, which is the safe direction. */
    }
    onClose();
  }, [email, onClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    /* showModal() picks the first focusable child, which is Skip. React sets
       the autofocus attribute after mount, too late to be consulted. Focus the
       primary action explicitly, or the default keyboard action is to leave. */
    nextRef.current?.focus();

    /* Escape and the backdrop both close a native dialog, and both should
       count as having seen it rather than leaving it to reappear next time. */
    const onCancel = (event: Event) => {
      event.preventDefault();
      finish();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, [finish]);

  const current = steps[step]!;
  const last = step === steps.length - 1;

  return (
    <dialog className="onb" ref={ref} aria-labelledby="onb-title">
      <div className="onb-mark" aria-hidden="true">
        <span>{step + 1}</span>
      </div>

      <div className="onb-body">
        <h2 className="onb-title" id="onb-title">{current.title}</h2>
        {/* Keyed so a screen reader announces each step as it changes rather
            than reading the first one and going quiet. */}
        <p className="onb-text" key={step}>{current.body}</p>

        <div className="onb-foot">
          <ol className="onb-dots" aria-label={`Step ${step + 1} of ${steps.length}`}>
            {steps.map((s, i) => (
              <li key={s.title} className={i === step ? "is-on" : ""} aria-hidden="true" />
            ))}
          </ol>

          <div className="onb-actions">
            {!last && (
              <button type="button" className="onb-skip" onClick={finish}>
                Skip
              </button>
            )}
            <button
              type="button"
              className="onb-next"
              onClick={() => (last ? finish() : setStep((s) => s + 1))}
              ref={nextRef}
            >
              {last ? "Start" : "Next"}
              {!last && (
                <svg viewBox="0 0 24 24" className="onb-arrow" aria-hidden="true" focusable="false">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
