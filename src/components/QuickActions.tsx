import { useEffect, useRef, useState } from "react";
import GlassFilter from "./GlassFilter";

/**
 * The six things an organizer does over and over, one tap from anywhere.
 *
 * It lives in two places and behaves differently in each:
 *
 *   On /admin it switches tab in place, and focuses the first field of the
 *   panel it opened. Without the focus it is only a second tab bar, and that
 *   page already has one.
 *
 *   On the founder-side app it is a link. An organizer working in the chat
 *   should be able to pick "Add deadline" and land in the deadline form, not
 *   on the admin page's front door with the form four tabs away. It navigates
 *   to /admin?go=…&focus=…, which the admin page reads on arrival and treats
 *   exactly as if the item had been clicked there.
 *
 * One component rather than two, because the alternative was the same 130
 * lines of arc geometry in two stylesheets that would drift the first time
 * either was touched. It ships its own CSS for the same reason.
 *
 * Everything it owns is prefixed qa-. It mounts on a page that also carries
 * SprintBuddy's global stylesheet, and the obvious names collided: the check-in
 * strip called its caption .quick-label too, and whichever <style> mounted
 * second silently won.
 *
 * Server-rendered by design (`client:load`, not `client:only`): the markup is
 * then in the served HTML where the tests can read it, and there is no corner
 * of the page that pops in a frame late.
 */

/** Each item names a tab and the first field inside it. */
const ITEMS = [
  {
    tab: "deadlines",
    focus: "dl-title",
    label: "Add deadline",
    path: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2.5" />
        <path d="M3 10h18M8 3v4M16 3v4" />
        <path d="M12 13v3l2 1.4" />
      </>
    ),
  },
  {
    tab: "broadcast",
    focus: "bc-subject",
    label: "Send announcement",
    path: (
      <>
        <path d="M4 9.5v5a1.5 1.5 0 0 0 1.5 1.5H8l7 4V5.5l-7 4H5.5A1.5 1.5 0 0 0 4 11z" />
        <path d="M18 9a4 4 0 0 1 0 6" />
      </>
    ),
  },
  {
    tab: "people",
    focus: "add-name",
    label: "Add a founder",
    path: (
      <>
        <circle cx="10" cy="8" r="3.2" />
        <path d="M4 19a6 6 0 0 1 12 0" />
        <path d="M18.5 8.5v5M16 11h5" />
      </>
    ),
  },
  {
    tab: "programme",
    focus: "pr-phase",
    label: "Set the week",
    path: (
      <>
        <circle cx="5" cy="6.5" r="1.6" />
        <circle cx="5" cy="12" r="1.6" />
        <circle cx="5" cy="17.5" r="1.6" />
        <path d="M10 6.5h10M10 12h10M10 17.5h6" />
      </>
    ),
  },
  {
    tab: "knowledge",
    focus: "kb-topic",
    label: "Add knowledge",
    path: (
      <>
        <path d="M12 6.8C10.6 5.6 8.7 5 6 5H3.5v12H6c2.7 0 4.6.6 6 1.8" />
        <path d="M12 6.8C13.4 5.6 15.3 5 18 5h2.5v12H18c-2.7 0-4.6.6-6 1.8z" />
      </>
    ),
  },
  {
    tab: "library",
    focus: "bk-title",
    label: "Add a book",
    /* A closed book, not the open one above: "Add knowledge" is already a
       two-page spread, and at 19px two open books are one icon.
       The second path is the page block sitting proud of the cover — without
       it the first is a rounded rectangle and reads as a blank document. */
    path: (
      <>
        <path d="M5 18.5v-13A2.5 2.5 0 0 1 7.5 3H19v18H7.5A2.5 2.5 0 0 1 5 18.5z" />
        <path d="M5 18.5A2.5 2.5 0 0 1 7.5 16H19" />
      </>
    ),
  },
] as const;

/** What /admin listens for. Kept here so both halves name it once. */
export const QUICK_ACTION_EVENT = "sprintbuddy:quick-action";

type Props = {
  /**
   * "inline" switches tab on the page it is already on; "navigate" leaves for
   * /admin carrying the same instruction in the query string.
   */
  mode: "inline" | "navigate";
};

export default function QuickActions({ mode }: Props) {
  const [open, setOpen] = useState(false);
  /* Nothing on screen until this component is running. Without JS the buttons
     do nothing, and six dead circles in the corner are worse than none. */
  const [ready, setReady] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => setReady(true), []);

  useEffect(() => {
    if (!open) return;
    first.current?.focus();

    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (tab: string, focus: string) => {
    setOpen(false);
    if (mode === "navigate") {
      window.location.href = `/admin?go=${tab}&focus=${focus}`;
      return;
    }
    window.dispatchEvent(
      new CustomEvent(QUICK_ACTION_EVENT, { detail: { tab, focus } }),
    );
  };

  return (
    <div
      ref={root}
      className={`qa${open ? " is-open" : ""}${mode === "navigate" ? " qa--floating" : ""}`}
      id="qa"
      hidden={!ready}
    >
      <style>{CSS}</style>
      {/* Its own id. SVG filter ids are global to the document, and both pages
          this mounts on already define others. */}
      <GlassFilter id="qa-glass" />

      <div className="qa-items" id="qa-items">
        {ITEMS.map((item, i) => (
          <button
            key={item.tab}
            ref={i === 0 ? first : undefined}
            type="button"
            className="qa-item"
            data-go={item.tab}
            data-focus={item.focus}
            /* Out of the tab order while parked, or six invisible buttons sit
               between the page and whatever comes after it. */
            tabIndex={open ? 0 : -1}
            onClick={() => pick(item.tab, item.focus)}
          >
            <span aria-hidden="true">
              <svg viewBox="0 0 24 24">{item.path}</svg>
            </span>
            <span className="qa-label">{item.label}</span>
          </button>
        ))}
      </div>

      <button
        ref={trigger}
        type="button"
        className="qa-trigger"
        id="qa-trigger"
        aria-expanded={open}
        aria-controls="qa-items"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="qa-trigger-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
        <span className="qa-sr">Quick actions</span>
      </button>
    </div>
  );
}

/*
 * Self-contained, and deliberately not written against either page's tokens:
 * /admin calls its ink --text and its rule --border, the founder app calls the
 * same two --ink and --line, and this mounts on both. Both grounds are
 * near-black, so the literals below hold on either.
 */
const CSS = `
.qa {
  position: fixed;
  right: 26px;
  bottom: 26px;
  z-index: 40;
  width: 56px;
  height: 56px;
  font-family: inherit;
}

/* The glass material, shared by the trigger and the five circles: no fill at
   all, a rim built entirely from layered inset shadows, and the page behind
   refracted through the filter above. */
.qa-trigger, .qa-item {
  border: 0;
  background: none;
  color: #f4f4f5;
  cursor: pointer;
  backdrop-filter: url("#qa-glass");
  -webkit-backdrop-filter: url("#qa-glass");
  box-shadow:
    0 0 8px rgba(0, 0, 0, 0.03),
    0 2px 6px rgba(0, 0, 0, 0.08),
    inset 3px 3px 0.5px -3.5px rgba(255, 255, 255, 0.09),
    inset -3px -3px 0.5px -3.5px rgba(255, 255, 255, 0.85),
    inset 1px 1px 1px -0.5px rgba(255, 255, 255, 0.6),
    inset -1px -1px 1px -0.5px rgba(255, 255, 255, 0.6),
    inset 0 0 6px 6px rgba(255, 255, 255, 0.12),
    inset 0 0 2px 2px rgba(255, 255, 255, 0.06),
    0 0 12px rgba(0, 0, 0, 0.15);
}
.qa-trigger:focus-visible, .qa-item:focus-visible {
  outline: 2px solid var(--brand-accent, var(--accent, #5e6ad2));
  outline-offset: 3px;
}

.qa-trigger {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  border-radius: 999px;
  transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}
.qa-trigger svg {
  width: 22px; height: 22px; display: block;
  fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round;
}
/* The plus becomes a cross. One element, one rotation, no icon swap. */
.qa.is-open .qa-trigger { transform: rotate(135deg); }

/* The items are circles, not labelled pills. Labelled pills on this arc
   overlap: six labels up to 160px wide cannot sit 53px apart. The label
   appears beside the circle on hover and focus instead, and stays in the DOM
   the whole time so it is the button's accessible name. */
.qa-item {
  position: absolute;
  /* Centred on the trigger, which is 56px: 5 + 23 = 28 from each edge. */
  right: 5px;
  bottom: 5px;
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  padding: 0;
  border-radius: 999px;
  opacity: 0;
  pointer-events: none;
  transform: translate(0, 0) scale(0.5);
  transition:
    transform 320ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 180ms ease;
}
.qa-item svg {
  width: 19px; height: 19px; display: block;
  fill: none; stroke: currentColor; stroke-width: 1.9;
  stroke-linecap: round; stroke-linejoin: round;
}

/* Sits to the left of its circle. Solid rather than glass: a frosted chip over
   a frosted circle is two rims and no text. Non-interactive, so it never gets
   between the pointer and the button it names. */
.qa-label {
  position: absolute;
  right: calc(100% + 10px);
  padding: 6px 11px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: rgba(12, 13, 16, 0.97);
  color: #f4f4f5;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transform: translateX(6px);
  transition: opacity 140ms ease, transform 140ms ease;
}
.qa-item:hover .qa-label,
.qa-item:focus-visible .qa-label { opacity: 1; transform: translateX(0); }
/* Above its neighbours, or a long label is clipped by the next circle. */
.qa-item:hover, .qa-item:focus-visible { z-index: 1; }

.qa.is-open .qa-item { opacity: 1; pointer-events: auto; }
/* A quarter arc at radius 169, from straight up round to straight left.
   Quarter rather than the half a fan usually draws: in a corner, half of a
   full circle is off-screen. The radius is set by the circles, not by taste —
   six of them over 90 degrees sit 2·169·sin(9°) = 53px apart, which is a 7px
   gap at 46px across. It was 136 for five, where the step was 22.5° and the
   same 53px; a sixth at that radius closes the gap to 43px and the circles
   touch, so the radius grows rather than the fan tightening. */
.qa.is-open .qa-item:nth-child(1) { transform: translate(0, -169px) scale(1); }
.qa.is-open .qa-item:nth-child(2) { transform: translate(-52px, -161px) scale(1); }
.qa.is-open .qa-item:nth-child(3) { transform: translate(-99px, -137px) scale(1); }
.qa.is-open .qa-item:nth-child(4) { transform: translate(-137px, -99px) scale(1); }
.qa.is-open .qa-item:nth-child(5) { transform: translate(-161px, -52px) scale(1); }
.qa.is-open .qa-item:nth-child(6) { transform: translate(-169px, 0) scale(1); }
/* Opening runs first to last; closing runs last to first, so the fan collapses
   back the way a hand of cards does. */
.qa-item:nth-child(1) { transition-delay: 125ms; }
.qa-item:nth-child(2) { transition-delay: 100ms; }
.qa-item:nth-child(3) { transition-delay: 75ms; }
.qa-item:nth-child(4) { transition-delay: 50ms; }
.qa-item:nth-child(5) { transition-delay: 25ms; }
.qa-item:nth-child(6) { transition-delay: 0ms; }
.qa.is-open .qa-item:nth-child(1) { transition-delay: 0ms; }
.qa.is-open .qa-item:nth-child(2) { transition-delay: 25ms; }
.qa.is-open .qa-item:nth-child(3) { transition-delay: 50ms; }
.qa.is-open .qa-item:nth-child(4) { transition-delay: 75ms; }
.qa.is-open .qa-item:nth-child(5) { transition-delay: 100ms; }
.qa.is-open .qa-item:nth-child(6) { transition-delay: 125ms; }

/* On a narrow screen the arc runs off the left edge. Stack it instead, and pin
   the labels open, since there is no hover on a phone. */
@media (max-width: 760px) {
  .qa { right: 16px; bottom: 16px; }
  .qa.is-open .qa-item:nth-child(1) { transform: translate(0, -60px) scale(1); }
  .qa.is-open .qa-item:nth-child(2) { transform: translate(0, -116px) scale(1); }
  .qa.is-open .qa-item:nth-child(3) { transform: translate(0, -172px) scale(1); }
  .qa.is-open .qa-item:nth-child(4) { transform: translate(0, -228px) scale(1); }
  .qa.is-open .qa-item:nth-child(5) { transform: translate(0, -284px) scale(1); }
  .qa.is-open .qa-item:nth-child(6) { transform: translate(0, -340px) scale(1); }
  .qa.is-open .qa-label { opacity: 1; transform: translateX(0); }
  /* The founder-side app puts its own action bar and composer along the bottom
     of a phone screen. A floating trigger there covers the thing the founder
     is actually typing into, and the admin page it leads to is not usable at
     that width anyway. */
  .qa--floating { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .qa-trigger, .qa-item, .qa-label { transition: none; }
  .qa-item { transition-delay: 0ms !important; }
}

.qa-sr {
  position: absolute;
  width: 1px; height: 1px;
  margin: -1px; padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
`;
