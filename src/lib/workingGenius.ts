/**
 * The Aalto Founder Sprint working-style assessment.
 *
 * Six types, thirty forced-choice items, a full ranking split into three bands
 * of two. The six-type model is Patrick Lencioni's (The 6 Types of Working
 * Genius, The Table Group). The model is his; every item and every word of
 * result copy in this file is ours, because the official instrument is a
 * licensed product we do not have a licence for. Nothing here is copied from
 * it. See workflows/working_genius.md.
 *
 * What the first version of this got wrong, and why the shape below is what it
 * is:
 *
 *   Six items, each pitting two types against each other, produced one
 *   "primary" type. Only five of the fifteen possible pairs were ever asked and
 *   one of those was asked twice, so enablement and tenacity were compared to
 *   each other and to nothing else: their two scores always summed to exactly
 *   2 regardless of who was answering. Max score per type was 2, which made
 *   ties at the top the normal case rather than the edge case, and ties were
 *   resolved by object insertion order, which handed most of them to wonder.
 *
 * So: all fifteen pairs, each asked twice with different wording. Every type
 * meets every other type twice, which makes the comparison graph complete and
 * the scores meaningful (0..10, summing to 30 across the six). Asking each pair
 * twice also buys a reliability signal for free: if someone answers the same
 * pair two different ways we can say so instead of pretending the result is
 * crisp.
 */

export type WorkingGeniusId =
  | "wonder"
  | "invention"
  | "discernment"
  | "galvanizing"
  | "enablement"
  | "tenacity";

export type WorkingGeniusBand = "genius" | "competency" | "frustration";

/** The model's own order: W-I-D-G-E-T, ideation through implementation. */
export const WIDGET_ORDER: readonly WorkingGeniusId[] = [
  "wonder",
  "invention",
  "discernment",
  "galvanizing",
  "enablement",
  "tenacity",
] as const;

export type WorkingGeniusStage = "ideation" | "activation" | "implementation";

export type WorkingGeniusType = {
  id: WorkingGeniusId;
  label: string;
  letter: string;
  /** Two-word handle used in the UI where the full description will not fit. */
  vibe: string;
  stage: WorkingGeniusStage;
  /** Neutral description of the activity itself, independent of any band. */
  activity: string;
  /** How the type reads in each band. Written for founders, not for managers. */
  asGenius: string;
  asCompetency: string;
  asFrustration: string;
};

export const WORKING_GENIUS_TYPES: readonly WorkingGeniusType[] = [
  {
    id: "wonder",
    label: "Wonder",
    letter: "W",
    vibe: "Curious starter",
    stage: "ideation",
    activity: "Sitting with the bigger question and the possibility nobody has named yet.",
    asGenius:
      "You are pulled towards the unasked question. Ambiguity reads as opportunity rather than as mess, and you are usually the first to notice that the team is solving the wrong problem.",
    asCompetency:
      "You can hold an open question when the work needs it, and you do not find it draining. It is just not where you go first.",
    asFrustration:
      "Open-ended speculation costs you energy. You would rather be handed the question than spend the morning looking for it.",
  },
  {
    id: "invention",
    label: "Invention",
    letter: "I",
    vibe: "Idea shaper",
    stage: "ideation",
    activity: "Making something new from a blank page, with little to work from.",
    asGenius:
      "A problem with no obvious answer is the fun part. You generate original approaches readily and you would rather build a new option than pick between existing ones.",
    asCompetency:
      "You can come up with something new when asked, and it will be decent. You just do not need to be the one who does.",
    asFrustration:
      "The blank page is a cost, not a thrill. Give you a starting point and you are fine; ask you to conjure one and the energy goes.",
  },
  {
    id: "discernment",
    label: "Discernment",
    letter: "D",
    vibe: "Signal finder",
    stage: "activation",
    activity: "Reading, by instinct as much as analysis, whether an idea or plan actually holds up.",
    asGenius:
      "You have a good gut and it is usually right. You can tell which of five plausible options is the live one without needing a full dataset, and people bring you things to sanity-check.",
    asCompetency:
      "You form sound judgments when you have to. You may want more evidence than a natural does before you trust the read.",
    asFrustration:
      "Being asked to evaluate something on instinct is uncomfortable. You would rather test it, build it, or hand the call to someone else.",
  },
  {
    id: "galvanizing",
    label: "Galvanizing",
    letter: "G",
    vibe: "Momentum maker",
    stage: "activation",
    activity: "Rallying people and getting them to actually move on something.",
    asGenius:
      "You turn a decision into movement. You are comfortable pushing, repeating yourself, and generating the urgency a group needs to stop circling.",
    asCompetency:
      "You can rally people when the moment calls for it. It works, it just is not the thing you reach for unprompted.",
    asFrustration:
      "Persuading and chasing drains you. You would rather do the work than spend the day getting other people to do theirs.",
  },
  {
    id: "enablement",
    label: "Enablement",
    letter: "E",
    vibe: "Support engine",
    stage: "implementation",
    activity: "Giving people the help, cover, and unblocking they need to get on with it.",
    asGenius:
      "You respond to a call for help without needing to be asked twice. You are often the reason a team holds together, and you probably undersell this as merely being agreeable.",
    asCompetency:
      "You pitch in readily enough when someone needs it. You would just rather it did not become your whole role.",
    asFrustration:
      "Open-ended support work wears you down, especially when it has no clear end. You would rather own a piece outright than assist on everybody else's.",
  },
  {
    id: "tenacity",
    label: "Tenacity",
    letter: "T",
    vibe: "Finisher",
    stage: "implementation",
    activity: "Pushing something all the way to done, including the unglamorous last stretch.",
    asGenius:
      "You get satisfaction from the last ten percent that most people find tedious. You track what is outstanding and you are hard to distract before it is closed.",
    asCompetency:
      "You finish what you start. You just do not get a particular charge out of the closing stretch.",
    asFrustration:
      "The endgame is where your interest drops. You are strongest early, and the final grind is the part you have to force.",
  },
] as const;

export function typeById(id: WorkingGeniusId): WorkingGeniusType {
  const found = WORKING_GENIUS_TYPES.find((t) => t.id === id);
  if (!found) throw new Error(`unknown working genius type: ${id}`);
  return found;
}

export function bandCopy(type: WorkingGeniusType, band: WorkingGeniusBand): string {
  if (band === "genius") return type.asGenius;
  if (band === "competency") return type.asCompetency;
  return type.asFrustration;
}

/* ------------------------------------------------------------------ items -- */

export type WorkingGeniusOption = { id: WorkingGeniusId; label: string };

export type WorkingGeniusItem = {
  /** Stable id, `<letters>-<round>`, e.g. "wi-a". Persisted with the response. */
  id: string;
  round: "a" | "b";
  prompt: string;
  /** Exactly two, and the pair is unique per round. */
  options: [WorkingGeniusOption, WorkingGeniusOption];
};

/**
 * Every item asks which option the founder would rather do, never which they
 * are better at. The model's whole claim is that genius is gifted *and*
 * energising, and people answer "what am I good at" with their job description.
 *
 * Both options are written to be attractive. An item where one side is
 * obviously the virtuous answer measures self-image, not preference.
 *
 * Polarity never flips: every item is "which of these two pulls you". Mixing in
 * reverse-scored items ("which do you dread") would add noise we have no sample
 * size to model out.
 *
 * Round A puts the earlier WIDGET type first, round B puts the later one first,
 * so each type appears in each screen position exactly five times and position
 * bias cancels out.
 */
const ITEMS_ROUND_A: WorkingGeniusItem[] = [
  {
    id: "wi-a",
    round: "a",
    prompt: "An afternoon opens up with nothing scheduled. You spend it…",
    options: [
      { id: "wonder", label: "Sitting with the question nobody on the team has asked yet." },
      { id: "invention", label: "Sketching a solution that does not exist yet." },
    ],
  },
  {
    id: "wd-a",
    round: "a",
    prompt: "Someone drops a plan in front of you. Your first instinct is to…",
    options: [
      { id: "wonder", label: "Ask what bigger thing this is really about." },
      { id: "discernment", label: "Feel out which parts of it are off." },
    ],
  },
  {
    id: "wg-a",
    round: "a",
    prompt: "The room has gone quiet on something hard. You would rather…",
    options: [
      { id: "wonder", label: "Put the uncomfortable question on the table." },
      { id: "galvanizing", label: "Get people fired up about doing something." },
    ],
  },
  {
    id: "we-a",
    round: "a",
    prompt: "A teammate is stuck. You would rather…",
    options: [
      { id: "wonder", label: "Work out with them what they are actually solving for." },
      { id: "enablement", label: "Take some of the work off their plate." },
    ],
  },
  {
    id: "wt-a",
    round: "a",
    prompt: "There is an unanswered question and an unfinished task. You reach for…",
    options: [
      { id: "wonder", label: "The question." },
      { id: "tenacity", label: "The task." },
    ],
  },
  {
    id: "id-a",
    round: "a",
    prompt: "You are handed three half-baked concepts. You would rather…",
    options: [
      { id: "invention", label: "Add a fourth that is genuinely different." },
      { id: "discernment", label: "Say which of the three is actually ripe." },
    ],
  },
  {
    id: "ig-a",
    round: "a",
    prompt: "The idea is good. What do you want to do with it?",
    options: [
      { id: "invention", label: "Make it sharper and stranger." },
      { id: "galvanizing", label: "Get people behind it." },
    ],
  },
  {
    id: "ie-a",
    round: "a",
    prompt: "The team is mid-build. You would rather…",
    options: [
      { id: "invention", label: "Rethink the approach from scratch." },
      { id: "enablement", label: "Give people what they need to keep going." },
    ],
  },
  {
    id: "it-a",
    round: "a",
    prompt: "Two jobs, one of them yours. You take…",
    options: [
      { id: "invention", label: "Inventing the thing." },
      { id: "tenacity", label: "Shipping the thing." },
    ],
  },
  {
    id: "dg-a",
    round: "a",
    prompt: "The team is split between two options. You would rather…",
    options: [
      { id: "discernment", label: "Work out which one is right." },
      { id: "galvanizing", label: "Get everyone committed to one." },
    ],
  },
  {
    id: "de-a",
    round: "a",
    prompt: "A plan lands on your desk. First move…",
    options: [
      { id: "discernment", label: "Judge whether it holds up." },
      { id: "enablement", label: "Ask the person what they need to make it work." },
    ],
  },
  {
    id: "dt-a",
    round: "a",
    prompt: "Late in a project, you would rather be…",
    options: [
      { id: "discernment", label: "The one who spots what is off." },
      { id: "tenacity", label: "The one who drives it over the line." },
    ],
  },
  {
    id: "ge-a",
    round: "a",
    prompt: "The team has lost steam. You would rather…",
    options: [
      { id: "galvanizing", label: "Rally them." },
      { id: "enablement", label: "Quietly clear whatever is blocking them." },
    ],
  },
  {
    id: "gt-a",
    round: "a",
    prompt: "Two weeks to the demo. You would rather…",
    options: [
      { id: "galvanizing", label: "Get everyone aligned and moving." },
      { id: "tenacity", label: "Personally make sure it is finished." },
    ],
  },
  {
    id: "et-a",
    round: "a",
    prompt: "The last ten percent is all that is left. You would rather…",
    options: [
      { id: "enablement", label: "Support whoever is carrying it." },
      { id: "tenacity", label: "Carry it yourself." },
    ],
  },
];

const ITEMS_ROUND_B: WorkingGeniusItem[] = [
  {
    id: "wi-b",
    round: "b",
    prompt: "The best part of a blank page is…",
    options: [
      { id: "invention", label: "Putting something new on it." },
      { id: "wonder", label: "Wondering what could go on it." },
    ],
  },
  {
    id: "wd-b",
    round: "b",
    prompt: "You get more out of…",
    options: [
      { id: "discernment", label: "Reading whether an answer is any good." },
      { id: "wonder", label: "Opening a question up." },
    ],
  },
  {
    id: "wg-b",
    round: "b",
    prompt: "A better use of your Monday…",
    options: [
      { id: "galvanizing", label: "Getting everyone moving in one direction." },
      { id: "wonder", label: "Thinking about what the team is missing." },
    ],
  },
  {
    id: "we-b",
    round: "b",
    prompt: "More satisfying…",
    options: [
      { id: "enablement", label: "Being the person who helped someone get it done." },
      { id: "wonder", label: "Noticing the opportunity nobody else saw." },
    ],
  },
  {
    id: "wt-b",
    round: "b",
    prompt: "The week feels good when…",
    options: [
      { id: "tenacity", label: "You closed something out completely." },
      { id: "wonder", label: "You opened up something worth chasing." },
    ],
  },
  {
    id: "id-b",
    round: "b",
    prompt: "In a review, you are the one who…",
    options: [
      { id: "discernment", label: "Senses what will and will not land." },
      { id: "invention", label: "Proposes the different approach." },
    ],
  },
  {
    id: "ig-b",
    round: "b",
    prompt: "More energising…",
    options: [
      { id: "galvanizing", label: "Selling the idea." },
      { id: "invention", label: "Coming up with the idea." },
    ],
  },
  {
    id: "ie-b",
    round: "b",
    prompt: "You would rather be known for…",
    options: [
      { id: "enablement", label: "Being genuinely useful to the people around you." },
      { id: "invention", label: "Thinking of things nobody else thought of." },
    ],
  },
  {
    id: "it-b",
    round: "b",
    prompt: "You lose track of time when…",
    options: [
      { id: "tenacity", label: "You are grinding out the last details." },
      { id: "invention", label: "You are making something up." },
    ],
  },
  {
    id: "dg-b",
    round: "b",
    prompt: "Your contribution to a decision is usually…",
    options: [
      { id: "galvanizing", label: "The push that makes it happen." },
      { id: "discernment", label: "The read on what is actually true." },
    ],
  },
  {
    id: "de-b",
    round: "b",
    prompt: "More rewarding…",
    options: [
      { id: "enablement", label: "Being the reason it worked." },
      { id: "discernment", label: "Being right about what would work." },
    ],
  },
  {
    id: "dt-b",
    round: "b",
    prompt: "Pick the role you want on a hard project…",
    options: [
      { id: "tenacity", label: "Making certain it gets finished." },
      { id: "discernment", label: "Making sure the judgment calls are good." },
    ],
  },
  {
    id: "ge-b",
    round: "b",
    prompt: "You help a team most by…",
    options: [
      { id: "enablement", label: "Removing friction." },
      { id: "galvanizing", label: "Creating urgency." },
    ],
  },
  {
    id: "gt-b",
    round: "b",
    prompt: "More natural to you…",
    options: [
      { id: "tenacity", label: "Sustaining the effort to the end." },
      { id: "galvanizing", label: "Inspiring the effort in the first place." },
    ],
  },
  {
    id: "et-b",
    round: "b",
    prompt: "At the end of it, you would rather be able to say…",
    options: [
      { id: "tenacity", label: "It actually got done." },
      { id: "enablement", label: "Everyone had what they needed." },
    ],
  },
];

/**
 * Presentation order. Round A entirely, then round B, each internally
 * scrambled so no two items about the same pair sit near each other and the
 * six types do not appear in a marching WIDGET pattern.
 *
 * Round B is round A rotated by ten rather than reordered freely. Free
 * scrambling kept putting some pair's two askings eight or nine items apart,
 * close enough for the founder to recognise the repeat and answer from memory
 * instead of from instinct, which is exactly the signal the second asking is
 * there to collect. A rotation of k guarantees a minimum gap of k for every
 * pair, so the spacing is a property of the construction rather than something
 * that has to be re-checked by hand each time an item is reworded.
 *
 * Fixed rather than shuffled per respondent: with 20 founders a fixed order
 * keeps results comparable and support questions answerable.
 */
const PRESENTATION_ORDER = [
  "ig-a", "we-a", "dt-a", "wi-a", "ge-a", "it-a", "wd-a", "et-a",
  "dg-a", "ie-a", "wt-a", "gt-a", "id-a", "wg-a", "de-a",
  "it-b", "wd-b", "et-b", "dg-b", "ie-b", "wt-b", "gt-b", "id-b",
  "wg-b", "de-b", "ig-b", "we-b", "dt-b", "wi-b", "ge-b",
];

function buildItems(): WorkingGeniusItem[] {
  const byId = new Map<string, WorkingGeniusItem>();
  for (const item of [...ITEMS_ROUND_A, ...ITEMS_ROUND_B]) byId.set(item.id, item);
  return PRESENTATION_ORDER.map((id) => {
    const item = byId.get(id);
    if (!item) throw new Error(`presentation order names a missing item: ${id}`);
    return item;
  });
}

export const WORKING_GENIUS_ITEMS: readonly WorkingGeniusItem[] = buildItems();

/** Bumped whenever the item bank or the scoring changes, so old rows stay readable. */
export const INSTRUMENT_VERSION = "afs-1";

/* ---------------------------------------------------------------- scoring -- */

export type WorkingGeniusResponses = Record<string, WorkingGeniusId>;

export type WorkingGeniusResult = {
  version: string;
  /** Wins per type, 0..10. Always sums to 30 for a complete response set. */
  counts: Record<WorkingGeniusId, number>;
  /** All six, strongest first. */
  ranking: WorkingGeniusId[];
  bands: Record<WorkingGeniusBand, WorkingGeniusId[]>;
  /** Share of the 15 pairs answered the same way both times, 0..1. */
  consistency: number;
  /**
   * Pairs that finished level on both total wins and their head-to-head, so
   * the order between them came from a fallback rather than from the answers.
   */
  contested: Array<[WorkingGeniusId, WorkingGeniusId]>;
  /**
   * Win gap across each band boundary. Zero means the split between, say,
   * genius and competency was decided by a tie-break, which the UI says out
   * loud rather than presenting a coin toss as a finding.
   */
  boundaryMargins: { geniusCompetency: number; competencyFrustration: number };
  responses: WorkingGeniusResponses;
  /** Primary type, kept so existing rows and readers stay valid. */
  primary: WorkingGeniusId;
  completedAt: string;
};

function emptyCounts(): Record<WorkingGeniusId, number> {
  return { wonder: 0, invention: 0, discernment: 0, galvanizing: 0, enablement: 0, tenacity: 0 };
}

/**
 * Scores a complete or partial response set.
 *
 * Ranking runs in two passes. Total wins first; then, inside any group of
 * types on the same total, a mini round-robin using only the head-to-head
 * results between the tied types. A single sort comparator cannot do this
 * safely because head-to-head is not transitive. A beats B, B beats C, C
 * beats A is a real outcome, and feeding a non-transitive comparator to
 * Array.sort gives an order that depends on the engine's sort internals.
 * Anything still level after the round-robin falls back to WIDGET order for
 * determinism and is reported in `contested` rather than hidden.
 */
export function scoreWorkingGenius(
  responses: WorkingGeniusResponses,
  completedAt: string,
  items: readonly WorkingGeniusItem[] = WORKING_GENIUS_ITEMS,
): WorkingGeniusResult {
  const counts = emptyCounts();
  const h2h = new Map<string, number>();
  const key = (a: WorkingGeniusId, b: WorkingGeniusId) => `${a}>${b}`;

  for (const item of items) {
    const chosen = responses[item.id];
    if (!chosen) continue;
    const other = item.options.find((o) => o.id !== chosen);
    if (!item.options.some((o) => o.id === chosen) || !other) continue;
    counts[chosen] += 1;
    h2h.set(key(chosen, other.id), (h2h.get(key(chosen, other.id)) ?? 0) + 1);
  }

  const beats = (a: WorkingGeniusId, b: WorkingGeniusId) => h2h.get(key(a, b)) ?? 0;
  const widgetIndex = (t: WorkingGeniusId) => WIDGET_ORDER.indexOf(t);

  const contested: Array<[WorkingGeniusId, WorkingGeniusId]> = [];
  const ranking: WorkingGeniusId[] = [];

  const byCount = new Map<number, WorkingGeniusId[]>();
  for (const t of WIDGET_ORDER) {
    const group = byCount.get(counts[t]) ?? [];
    group.push(t);
    byCount.set(counts[t], group);
  }

  for (const count of [...byCount.keys()].sort((a, b) => b - a)) {
    const group = byCount.get(count)!;
    const [only] = group;
    if (group.length === 1 && only) {
      ranking.push(only);
      continue;
    }
    // Round-robin restricted to the tied types.
    const miniWins = new Map<WorkingGeniusId, number>();
    for (const a of group) {
      let wins = 0;
      for (const b of group) if (a !== b) wins += beats(a, b);
      miniWins.set(a, wins);
    }
    const ordered = [...group].sort((a, b) => {
      const diff = (miniWins.get(b) ?? 0) - (miniWins.get(a) ?? 0);
      return diff !== 0 ? diff : widgetIndex(a) - widgetIndex(b);
    });
    for (let i = 0; i < ordered.length - 1; i++) {
      const here = ordered[i];
      const next = ordered[i + 1];
      if (!here || !next) continue;
      if ((miniWins.get(here) ?? 0) === (miniWins.get(next) ?? 0)) {
        contested.push([here, next]);
      }
    }
    ranking.push(...ordered);
  }

  // Reliability: for each pair asked twice, did both askings agree?
  let pairsAnswered = 0;
  let pairsAgreed = 0;
  for (const a of ITEMS_ROUND_A) {
    const b = ITEMS_ROUND_B.find((x) => x.id.slice(0, 2) === a.id.slice(0, 2));
    if (!b) continue;
    const ra = responses[a.id];
    const rb = responses[b.id];
    if (!ra || !rb) continue;
    pairsAnswered += 1;
    if (ra === rb) pairsAgreed += 1;
  }

  /*
   * Every type in WIDGET_ORDER lands in exactly one count group and every
   * group is pushed, so this is always six. Checked rather than assumed: the
   * bands and both boundary margins below are read positionally, and a ranking
   * that came up short would produce a profile that looks entirely plausible
   * and is wrong. Throwing is the right failure here because there is no
   * partial result worth showing a founder.
   */
  if (ranking.length !== WIDGET_ORDER.length) {
    throw new Error(
      `ranking produced ${ranking.length} types, expected ${WIDGET_ORDER.length}`,
    );
  }
  const placed = ranking as [
    WorkingGeniusId,
    WorkingGeniusId,
    WorkingGeniusId,
    WorkingGeniusId,
    WorkingGeniusId,
    WorkingGeniusId,
  ];

  return {
    version: INSTRUMENT_VERSION,
    counts,
    ranking,
    bands: {
      genius: ranking.slice(0, 2),
      competency: ranking.slice(2, 4),
      frustration: ranking.slice(4, 6),
    },
    consistency: pairsAnswered === 0 ? 0 : pairsAgreed / pairsAnswered,
    contested,
    boundaryMargins: {
      geniusCompetency: counts[placed[1]] - counts[placed[2]],
      competencyFrustration: counts[placed[3]] - counts[placed[4]],
    },
    responses,
    primary: placed[0],
    completedAt,
  };
}

export function bandOf(result: WorkingGeniusResult, id: WorkingGeniusId): WorkingGeniusBand {
  if (result.bands.genius.includes(id)) return "genius";
  if (result.bands.competency.includes(id)) return "competency";
  return "frustration";
}

/* ---------------------------- retake schedule ----------------------------- */

/**
 * When a founder may take this again.
 *
 * The instrument measures where energy goes, and that does not move week to
 * week. Letting somebody retake it the morning after a bad session would
 * measure the session, not them, and would turn a profile into a mood ring.
 *
 * So: the first take is available whenever they arrive, and each retake opens
 * on a fixed date the whole cohort shares. Three fixed points across the sprint
 * is enough to see movement and few enough that each one is worth sitting down
 * for.
 *
 * Dates are Helsinki calendar days, matching everything else the cohort runs on.
 */
export const RETAKE_WINDOWS: readonly string[] = ["2026-10-08", "2026-11-08", "2026-12-01"];

/**
 * The next date this founder may retake, or null when they are done.
 *
 * Keyed off the last take rather than off a count, which is what makes a late
 * joiner work correctly: somebody whose first take is on 20 October has already
 * passed the October window, so their next one is November, not a window that
 * opened before they existed.
 */
export function nextRetakeDate(lastTakenOn: string | null): string | null {
  if (!lastTakenOn) return null;
  return RETAKE_WINDOWS.find((d) => d > lastTakenOn) ?? null;
}

/** True when `today` has reached the founder's next window. */
export function retakeOpen(lastTakenOn: string | null, today: string): boolean {
  if (!lastTakenOn) return true;
  const next = nextRetakeDate(lastTakenOn);
  return next !== null && today >= next;
}

/** Whole days from `today` to `date`, never negative. */
export function daysUntil(date: string, today: string): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}
