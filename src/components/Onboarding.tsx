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
    title: "Check in when it is quick",
    body:
      "One tap for how the day is going, or a longer check-in when there is more to say. Over the sprint these become the record of what actually happened, which is worth more in December than any of it feels in September.",
  },
  {
    title: "Deadlines find you",
    body:
      "What the cohort owes and when is in the left panel. You get an email three days out, two days out, ten hours out, and once the morning after. Tick something off and all of them stop.",
  },
  {
    title: "Share a conversation on purpose",
    body:
      "If you want a coach to read one, the button at the top of the thread hands it over. You can take it back at any time, and you are told once it has been read.",
  },
];

const ORGANIZER: Step[] = [
  {
    title: "You run the cohort from here",
    body:
      "Cohort admin holds the people, the deadlines, the programme week by week, and the knowledge Sprint Buddy answers from. Everything the founders see comes from there.",
  },
  {
    title: "What you can read, and what you cannot",
    body:
      "Founders' conversations are private. You see themes and trends, never raw transcripts, unless a founder shares a specific conversation with you. Opening a shared one tells them it was read, once.",
  },
  {
    title: "Set deadlines and the week's shape",
    body:
      "A deadline emails itself to whoever has not ticked it off. The programme panel fills in what is on each week, which is what founders see under What's on.",
  },
  {
    title: "Talk to the whole cohort",
    body:
      "Broadcast sends one message to everyone registered, addressed to each founder by name. Use it for the things that would otherwise be twenty separate emails.",
  },
];

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
  role: "founder" | "organizer";
  onClose: () => void;
}) {
  const steps = role === "organizer" ? ORGANIZER : FOUNDER;
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
