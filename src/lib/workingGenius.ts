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
 * Every item names a concrete situation and asks what actually happens.
 *
 * It used to ask what the founder "would rather" do. A cohort tester stalled on
 * exactly the ambiguity that creates: "I might rather be able to rally them,
 * but I'm not good at rallying people so in reality I do option 2." The phrase
 * reads two ways, as the thing you wish you did and as the thing you do, and
 * those give opposite answers from the same person.
 *
 * The intent behind it was right and is kept: the model's claim is that a
 * genius is energising, not merely something you are competent at, and people
 * answer "what are you good at" with their job description. So the items still
 * never ask which one you do better. They ask which one you actually reach for,
 * lose track of time inside, or do without being asked, which gets at energy
 * without inviting the fantasy self.
 *
 * Banned outright, because each one reopens the ambiguity: "would rather",
 * "prefer", "ideally", "wish", "want to", "would choose". There is a test.
 *
 * Both options are written to be attractive. An item where one side is
 * obviously the virtuous answer measures self-image, not behaviour.
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
    prompt: "A free afternoon, nothing booked. What do you do with it?",
    options: [
      { id: "wonder", label: "Sit with a question that has been nagging me." },
      { id: "invention", label: "Come up with something new." },
    ],
  },
  {
    id: "wd-a",
    round: "a",
    prompt: "Someone hands you a finished plan. What do you do first?",
    options: [
      { id: "wonder", label: "I ask what problem it is really for." },
      { id: "discernment", label: "I look for the parts that will not work." },
    ],
  },
  {
    id: "wg-a",
    round: "a",
    prompt: "The room goes quiet on something hard. What do you do?",
    options: [
      { id: "wonder", label: "I say the question nobody has asked." },
      { id: "galvanizing", label: "I get people moving again." },
    ],
  },
  {
    id: "we-a",
    round: "a",
    prompt: "A teammate says they are stuck. What do you do?",
    options: [
      { id: "wonder", label: "I help them work out what they are really solving." },
      { id: "enablement", label: "I take part of it off their hands." },
    ],
  },
  {
    id: "wt-a",
    round: "a",
    prompt: "An open question, and a job to finish. Which do you pick up?",
    options: [
      { id: "wonder", label: "The question." },
      { id: "tenacity", label: "The job." },
    ],
  },
  {
    id: "id-a",
    round: "a",
    prompt: "Three rough ideas are on the table. What do you add?",
    options: [
      { id: "invention", label: "I add a fourth, different from all of them." },
      { id: "discernment", label: "I say which of the three is any good." },
    ],
  },
  {
    id: "ig-a",
    round: "a",
    prompt: "Everyone likes the idea. What do you do next?",
    options: [
      { id: "invention", label: "Make it better." },
      { id: "galvanizing", label: "Get people behind it." },
    ],
  },
  {
    id: "ie-a",
    round: "a",
    prompt: "The build is going slowly. What do you do?",
    options: [
      { id: "invention", label: "I look for a better way to do it." },
      { id: "enablement", label: "I get people what they need to keep going." },
    ],
  },
  {
    id: "it-a",
    round: "a",
    prompt: "Two jobs, and you can only take one. Which do you take?",
    options: [
      { id: "invention", label: "Working out what to build." },
      { id: "tenacity", label: "Getting it shipped." },
    ],
  },
  {
    id: "dg-a",
    round: "a",
    prompt: "The team is split and the meeting is nearly over. What do you do?",
    options: [
      { id: "discernment", label: "I work out which option is right." },
      { id: "galvanizing", label: "I get everyone behind one so it moves." },
    ],
  },
  {
    id: "de-a",
    round: "a",
    prompt: "A plan arrives from someone else. What is your first move?",
    options: [
      { id: "discernment", label: "I check whether it holds up." },
      { id: "enablement", label: "I ask what they need to make it work." },
    ],
  },
  {
    id: "dt-a",
    round: "a",
    prompt: "Late in a project, things are ragged. Which job do you end up in?",
    options: [
      { id: "discernment", label: "I catch what is wrong before it ships." },
      { id: "tenacity", label: "I push it over the line." },
    ],
  },
  {
    id: "ge-a",
    round: "a",
    prompt: "Momentum has died halfway through. What do you do?",
    options: [
      { id: "galvanizing", label: "I get everyone going again." },
      { id: "enablement", label: "I clear whatever is blocking them." },
    ],
  },
  {
    id: "gt-a",
    round: "a",
    prompt: "Two weeks to the demo and it is not ready. What do you do?",
    options: [
      { id: "galvanizing", label: "I rally the team." },
      { id: "tenacity", label: "I finish the missing pieces myself." },
    ],
  },
  {
    id: "et-a",
    round: "a",
    prompt: "The last ten percent, and everyone is tired. What happens?",
    options: [
      { id: "enablement", label: "I back whoever is carrying it." },
      { id: "tenacity", label: "I carry it." },
    ],
  },
];

const ITEMS_ROUND_B: WorkingGeniusItem[] = [
  {
    id: "wi-b",
    round: "b",
    prompt: "A blank page and an hour. What do you do with it?",
    options: [
      { id: "invention", label: "I fill it with something new." },
      { id: "wonder", label: "I think about what is worth putting on it." },
    ],
  },
  {
    id: "wd-b",
    round: "b",
    prompt: "You read the same page twice. What were you doing?",
    options: [
      { id: "discernment", label: "I was weighing whether it is any good." },
      { id: "wonder", label: "It opened a question I am still chasing." },
    ],
  },
  {
    id: "wg-b",
    round: "b",
    prompt: "Monday morning, nothing in the calendar. What do you do?",
    options: [
      { id: "galvanizing", label: "I get the team pointed the same way." },
      { id: "wonder", label: "I think about what we are missing." },
    ],
  },
  {
    id: "we-b",
    round: "b",
    prompt: "A week you finished feeling good about. What had you been doing?",
    options: [
      { id: "enablement", label: "Helping someone else get their thing done." },
      { id: "wonder", label: "Noticing something nobody else had." },
    ],
  },
  {
    id: "wt-b",
    round: "b",
    prompt: "It is Friday. What has to have happened for the week to feel worth it?",
    options: [
      { id: "tenacity", label: "Something got finished." },
      { id: "wonder", label: "Something interesting opened up." },
    ],
  },
  {
    id: "id-b",
    round: "b",
    prompt: "In a review, what do you end up contributing?",
    options: [
      { id: "discernment", label: "A call on what will work and what will not." },
      { id: "invention", label: "An idea nobody had put forward." },
    ],
  },
  {
    id: "ig-b",
    round: "b",
    prompt: "You lose track of time. What were you doing?",
    options: [
      { id: "galvanizing", label: "Getting people excited about an idea." },
      { id: "invention", label: "Having the idea." },
    ],
  },
  {
    id: "ie-b",
    round: "b",
    prompt: "People come to you. What for?",
    options: [
      { id: "enablement", label: "Help getting past something." },
      { id: "invention", label: "A different way to do it." },
    ],
  },
  {
    id: "it-b",
    round: "b",
    prompt: "Three hours gone without noticing. What were you doing?",
    options: [
      { id: "tenacity", label: "Finishing the last details." },
      { id: "invention", label: "Making something that was not there this morning." },
    ],
  },
  {
    id: "dg-b",
    round: "b",
    prompt: "A decision got made in a meeting. What had you contributed?",
    options: [
      { id: "galvanizing", label: "I got it moving." },
      { id: "discernment", label: "I said what was true." },
    ],
  },
  {
    id: "de-b",
    round: "b",
    prompt: "Something worked. What do you feel best about?",
    options: [
      { id: "enablement", label: "That I helped make it happen." },
      { id: "discernment", label: "That I called it right." },
    ],
  },
  {
    id: "dt-b",
    round: "b",
    prompt: "A hard project. Which do you take on?",
    options: [
      { id: "tenacity", label: "Making sure it gets finished." },
      { id: "discernment", label: "Making sure the calls are right." },
    ],
  },
  {
    id: "ge-b",
    round: "b",
    prompt: "A team you helped. What had you done?",
    options: [
      { id: "enablement", label: "Cleared things out of their way." },
      { id: "galvanizing", label: "Brought the energy." },
    ],
  },
  {
    id: "gt-b",
    round: "b",
    prompt: "Week six of eight on a long push. What do you do?",
    options: [
      { id: "tenacity", label: "I am still at it." },
      { id: "galvanizing", label: "I am getting the energy back up." },
    ],
  },
  {
    id: "et-b",
    round: "b",
    prompt: "It is finished. What do you check first?",
    options: [
      { id: "tenacity", label: "That it got done." },
      { id: "enablement", label: "That everyone had what they needed." },
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

/**
 * Shown above the first item.
 *
 * The ambiguity the rewrite removes from the wording is worth saying out loud
 * once as well: someone who has met an instrument like this before arrives
 * expecting to be asked what they are good at.
 */
export const INSTRUMENT_PREAMBLE =
  "Answer for how you actually behave, not how you would like to. There are no better or worse answers here.";

/**
 * Bumped whenever the item bank or the scoring changes, so old rows stay
 * readable.
 *
 * afs-1: the first thirty-item bank.
 * afs-2: every item rewritten from "you would rather" to a concrete situation
 *        and what actually happens. The pairings, the ids and the presentation
 *        order are untouched, so afs-1 rows still score identically and remain
 *        comparable; what changed is what the founder was asked, which is
 *        enough to make the two banks different instruments.
 * afs-3: the same items in plainer words. afs-2 read as written rather than
 *        spoken — "circling a question you have not had time to sit with",
 *        "something sharper and stranger" — and twenty of its thirty prompts
 *        opened with some version of "what do you actually do", which is a tic
 *        rather than a question. The behavioural framing afs-2 exists for is
 *        kept, because a tester read the bank before it as aspirational and
 *        answered for the person they would like to be; it is carried by
 *        "what do you do" and "what were you doing" now instead of by the word
 *        actually. Pairings, ids and order untouched again, so afs-1 and afs-2
 *        rows still score identically.
 */
export const INSTRUMENT_VERSION = "afs-3";

/* ---------------------------------------------------------------- scoring -- */

/**
 * One founder's answer to one item.
 *
 * The instrument is a forced choice and stays one, because that is what makes
 * the comparison graph complete. But a cohort tester was right that some people
 * do neither, do both, or do something conditional, and forcing them to click
 * one of two wrong answers puts noise in the score and tells us nothing.
 *
 * So there is an escape hatch, and it is deliberately the third option rather
 * than a required box on every item: if every question demands typing,
 * completion craters and what comes back is the word "both", which is less
 * informative than a forced choice.
 */
export type WorkingGeniusAnswer = {
  /** What they clicked. "neither" is the escape hatch. */
  choice: WorkingGeniusId | "neither";
  /** What they typed, either instead of choosing or as context alongside one. */
  text?: string;
  /**
   * What the free text was read as, resolved once at submission and stored.
   *
   * Not recomputed at scoring time. Scoring is a pure function over stored
   * data, so re-scoring a row a year from now gives the same answer it gave on
   * the day; if this were an LLM call inside the scorer, a founder's profile
   * could move between two reads of the same row. Storing the classification
   * beside the raw text also makes it auditable and correctable, which a live
   * call is not.
   */
  resolved?: WorkingGeniusId | "neither";
};

/**
 * Item id to answer.
 *
 * A bare type id is the afs-1 shape and is still read: those rows are on disk
 * and must keep scoring identically. Everything below normalises through
 * `readAnswer` rather than branching at each use.
 */
export type WorkingGeniusResponses = Record<string, WorkingGeniusId | WorkingGeniusAnswer>;

const TYPE_IDS = new Set<string>(WIDGET_ORDER);

const isTypeId = (v: unknown): v is WorkingGeniusId =>
  typeof v === "string" && TYPE_IDS.has(v);

export type ReadAnswer = {
  /** The type this answer counts a win for, or null if it abstains. */
  effective: WorkingGeniusId | null;
  choice: WorkingGeniusId | "neither" | null;
  text: string;
  /** True when the text was read as a different type than the one clicked. */
  overrode: boolean;
};

/**
 * Normalises either stored shape into one thing.
 *
 * Where the two disagree, the text wins. A click is a nearest-fit against two
 * options someone else wrote; the text is unprompted and specific, and it is
 * the only place a founder can say what actually happens. The disagreement is
 * kept rather than smoothed over: `overrode` is surfaced in the result and in
 * the report, because a founder who clicked one thing and described another has
 * told us something worth naming.
 */
export function readAnswer(raw: WorkingGeniusId | WorkingGeniusAnswer | undefined): ReadAnswer {
  if (raw === undefined) return { effective: null, choice: null, text: "", overrode: false };
  if (isTypeId(raw)) return { effective: raw, choice: raw, text: "", overrode: false };
  if (typeof raw !== "object" || raw === null) {
    return { effective: null, choice: null, text: "", overrode: false };
  }

  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  const choice = raw.choice === "neither" || isTypeId(raw.choice) ? raw.choice : null;
  const resolved =
    raw.resolved === "neither" || isTypeId(raw.resolved) ? raw.resolved : undefined;

  // Text present and read as a type: that is the answer, whatever was clicked.
  if (text && isTypeId(resolved)) {
    return {
      effective: resolved,
      choice,
      text,
      overrode: isTypeId(choice) && choice !== resolved,
    };
  }
  // Read as genuinely neither, or not read at all: abstain.
  if (choice === "neither") return { effective: null, choice, text, overrode: false };
  return { effective: isTypeId(choice) ? choice : null, choice, text, overrode: false };
}

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
   * How many items each type actually contested.
   *
   * Ten each for a complete set. An abstention removes an item from both of its
   * types, so without this a type that was asked eight times and won six looks
   * weaker than one asked ten times and won seven, which is backwards.
   */
  contests: Record<WorkingGeniusId, number>;
  /** Wins over contests entered, 0..1. This is what the ranking sorts on. */
  rates: Record<WorkingGeniusId, number>;
  /** Item ids where the founder answered "neither" and the text agreed. */
  abstentions: string[];
  /** Items where the free text was read as a different type than was clicked. */
  overrides: Array<{ itemId: string; clicked: WorkingGeniusId; resolved: WorkingGeniusId }>;
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
  const contests = emptyCounts();
  const abstentions: string[] = [];
  const overrides: Array<{ itemId: string; clicked: WorkingGeniusId; resolved: WorkingGeniusId }> = [];
  const h2h = new Map<string, number>();
  const key = (a: WorkingGeniusId, b: WorkingGeniusId) => `${a}>${b}`;

  for (const item of items) {
    const answer = readAnswer(responses[item.id]);
    const [left, right] = item.options;

    if (answer.choice === "neither" && answer.effective === null) {
      abstentions.push(item.id);
      continue;
    }
    const chosen = answer.effective;
    if (!chosen) continue;

    const other = item.options.find((o) => o.id !== chosen);
    if (!item.options.some((o) => o.id === chosen) || !other) continue;

    if (answer.overrode && answer.choice && answer.choice !== "neither") {
      overrides.push({ itemId: item.id, clicked: answer.choice, resolved: chosen });
    }

    counts[chosen] += 1;
    /* Both sides of the item entered this contest. An abstention above skips
       the increment for both, which is what keeps the rate honest. */
    contests[left.id] += 1;
    contests[right.id] += 1;
    h2h.set(key(chosen, other.id), (h2h.get(key(chosen, other.id)) ?? 0) + 1);
  }

  /*
   * Rate, not raw wins, is what the ranking sorts on.
   *
   * With no abstentions every type contests exactly ten items and rate is
   * count/10, so the order is identical to sorting on counts and the
   * validation anchor is unaffected. The two only diverge once somebody
   * abstains, which is precisely when raw counts stop being comparable.
   */
  const rates = emptyCounts();
  for (const t of WIDGET_ORDER) {
    rates[t] = contests[t] === 0 ? 0 : counts[t] / contests[t];
  }

  const beats = (a: WorkingGeniusId, b: WorkingGeniusId) => h2h.get(key(a, b)) ?? 0;
  const widgetIndex = (t: WorkingGeniusId) => WIDGET_ORDER.indexOf(t);

  const contested: Array<[WorkingGeniusId, WorkingGeniusId]> = [];
  const ranking: WorkingGeniusId[] = [];

  /* Keyed on the rate, rounded, because floating point division produces
     values that are equal in every sense that matters here and unequal as map
     keys: 6/8 and 3/4 must land in the same group. */
  const rateKey = (t: WorkingGeniusId) => Math.round(rates[t] * 1e6);
  const byCount = new Map<number, WorkingGeniusId[]>();
  for (const t of WIDGET_ORDER) {
    const group = byCount.get(rateKey(t)) ?? [];
    group.push(t);
    byCount.set(rateKey(t), group);
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
    /*
     * Compared on the effective answer, so a click on one asking and a
     * free-text answer on the other still count as agreeing when they land on
     * the same type. A pair where either side abstained is not counted at all:
     * it neither agrees nor disagrees, and scoring it as disagreement would
     * punish the founder for using the escape hatch honestly.
     */
    const ra = readAnswer(responses[a.id]).effective;
    const rb = readAnswer(responses[b.id]).effective;
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
    contests,
    rates,
    abstentions,
    overrides,
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
 *
 * These are F26's dates and a new cohort has to replace them. If they are left
 * behind, every window sits in the past and each founder gets one take and then
 * "Last one taken" for the rest of the sprint, silently. There is a test
 * asserting each window falls inside the sprint SPRINT_START_DATE describes, so
 * a forgotten update fails the build rather than the cohort.
 */
export const RETAKE_WINDOWS: readonly string[] = ["2026-10-08", "2026-11-08", "2026-12-01"];

/**
 * A date this schedule can reason about.
 *
 * The windows are compared as strings, which is exact for ISO dates and
 * nonsense for anything else. Rows written by the six-item quiz this replaced
 * hold a display date like "Aug 23, 2026", and "2026-10-08" > "Aug 23, 2026" is
 * false, so every window looked as though it had already passed and the founder
 * was locked out of retaking for good. Anything that is not a plain ISO date is
 * treated as no usable take, which is also the right answer on the merits: a
 * six-item-quiz row is not one of this instrument's four takes.
 */
function usableDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/**
 * The next date this founder may retake, or null when they are done.
 *
 * Keyed off the last take rather than off a count, which is what makes a late
 * joiner work correctly: somebody whose first take is on 20 October has already
 * passed the October window, so their next one is November, not a window that
 * opened before they existed.
 */
export function nextRetakeDate(lastTakenOn: string | null): string | null {
  const last = usableDate(lastTakenOn);
  if (!last) return null;
  return RETAKE_WINDOWS.find((d) => d > last) ?? null;
}

/** True when `today` has reached the founder's next window. */
export function retakeOpen(lastTakenOn: string | null, today: string): boolean {
  const last = usableDate(lastTakenOn);
  if (!last) return true;
  const next = nextRetakeDate(last);
  return next !== null && today >= next;
}

/** Whole days from `today` to `date`, never negative. */
export function daysUntil(date: string, today: string): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}
