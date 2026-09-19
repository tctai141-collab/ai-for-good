/**
 * The Aalto Founder Sprint working-style assessment.
 *
 * Six types, forty-two statements, each rated on a five-point frequency scale.
 * The six-type model is Patrick Lencioni's (The 6 Types of Working Genius, The
 * Table Group). The model is his; every statement and every word of result copy
 * in this file is ours, because the official instrument is a licensed product
 * we do not have a licence for. Nothing here is copied or paraphrased from it.
 *
 * Why this is a rating scale and not a forced choice, as of afs-4:
 *
 * The cohort's word for the previous bank was "black and white", and they were
 * describing it accurately. Thirty items, each pitting two types against each
 * other, with one click per item. That design bought a complete comparison
 * graph — every pair asked twice — and it cost the ability to say "both of
 * these, often" or "neither of these, ever", which is the true answer for a lot
 * of people on a lot of items.
 *
 * The forced choice was also buying less than it looked. Its scores are purely
 * ipsative: wins summed to exactly thirty for everybody by construction, so the
 * numbers carried no information about how much of any of it a person actually
 * does. The literature on this is unsentimental — forced choice and rating
 * scales carry equivalent information once there are enough items, and forced
 * choice's advantage over rating scales holds mainly for mixed-polarity blocks
 * in quantities we will never reach with a cohort of nineteen.
 *
 * So: forty-two statements, seven per type, rated 1-5 from never to
 * constantly.
 *
 * The scoring is the part that matters more than the format. A rating scale
 * fails in a specific way — almost everybody rates themselves four or five on
 * nearly everything, the six means bunch together, and the split into bands
 * ends up resting on noise. So the ranking is not built on the raw means. Each
 * type is scored against that person's own average across all forty-two, which
 * measures relative pull rather than general enthusiasm, and absorbs the
 * acquiescence that a rating scale otherwise carries. It is the reason single
 * polarity is safe here: no statement is reverse-worded, because reverse items
 * add noise this sample size cannot model out.
 *
 * Both numbers are kept and both are shown. The raw level says how much of this
 * you do at all; the centred score is what decides the bands. A founder reading
 * "frustration" next to a type they do fairly often deserves to see both rather
 * than be told, flatly, that it drains them.
 *
 * One consequence, stated rather than hidden: centred scores are ipsative, and
 * ipsative scores do not support comparing one person's level against another's.
 * They rank types within a person. The team map is therefore a map of who
 * leans where, and never a claim that one founder out-wonders another.
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

/** One point on the frequency scale a founder answers with. */
export type WorkingGeniusScalePoint = { value: 1 | 2 | 3 | 4 | 5; label: string };

/**
 * Never to constantly, five points, no numbers on screen.
 *
 * Frequency rather than agreement, because "how often is this you" is a
 * question about behaviour and "do you agree that this is you" is a question
 * about self-image, and the whole bank is written to ask the first one.
 *
 * The midpoint is named and meant. A founder who genuinely does something half
 * the time should land in the middle rather than be pushed to a side, which is
 * the complaint that produced this version.
 */
export const WORKING_GENIUS_SCALE: readonly WorkingGeniusScalePoint[] = [
  { value: 1, label: "Never" },
  { value: 2, label: "Rarely" },
  { value: 3, label: "Sometimes" },
  { value: 4, label: "Often" },
  { value: 5, label: "Constantly" },
] as const;

export type WorkingGeniusItem = {
  /** Stable id, `<type>-<n>`. Persisted with the response. */
  id: string;
  /** The type this statement measures. Never shown to the founder. */
  type: WorkingGeniusId;
  statement: string;
};

/**
 * Seven statements per type, describing what somebody does rather than what
 * they are good at.
 *
 * The rules the previous bank was written under are kept, because the reason
 * for each one survived the change of format:
 *
 * Every statement is a behaviour, in the present tense, that a person could
 * notice themselves doing this week. None asks whether they are good at
 * something: people answer that with their job description. The model's claim
 * is that a genius is energising, not merely something you are competent at.
 *
 * Banned outright, because each one invites the person somebody would like to
 * be rather than the one they are: "would rather", "prefer", "ideally",
 * "wish", "want to", "would choose", "good at". There is a test.
 *
 * Polarity never flips. Every statement is worded so that more of it means
 * more of that type; none is reverse-scored. Reverse items would buy a little
 * protection against straight-lining and cost more in noise than nineteen
 * people can absorb. Centring each person on their own mean is what handles
 * straight-lining instead.
 *
 * Presentation order interleaves the six types in rotating blocks of six, so
 * no two statements about the same type are ever adjacent and no type sits in
 * the same position twice. A founder cannot see the pattern and answer to it.
 */
export const WORKING_GENIUS_ITEMS: readonly WorkingGeniusItem[] = [
  { id: "wonder-1", type: "wonder", statement: "I catch myself turning over a question that has no obvious answer." },
  { id: "invention-1", type: "invention", statement: "I start from a blank page rather than adapt something that exists." },
  { id: "discernment-1", type: "discernment", statement: "I can tell an idea will not work before I can explain why." },
  { id: "galvanizing-1", type: "galvanizing", statement: "I keep putting an idea in front of people until they engage with it." },
  { id: "enablement-1", type: "enablement", statement: "I drop what I am doing to help someone who needs it." },
  { id: "tenacity-1", type: "tenacity", statement: "I push a task through to done after the interesting part is over." },
  { id: "invention-2", type: "invention", statement: "Ideas arrive faster than I can write them down." },
  { id: "discernment-2", type: "discernment", statement: "I read a plan and the weak part stands out immediately." },
  { id: "galvanizing-2", type: "galvanizing", statement: "I get other people excited about something I believe in." },
  { id: "enablement-2", type: "enablement", statement: "I notice a teammate is stuck and step in." },
  { id: "tenacity-2", type: "tenacity", statement: "I keep a list of what is unfinished and work it down." },
  { id: "wonder-2", type: "wonder", statement: "I notice something is off about how we work before anyone else names it." },
  { id: "discernment-3", type: "discernment", statement: "I am the one people bring their thinking to before they commit to it." },
  { id: "galvanizing-3", type: "galvanizing", statement: "I ask people to do things, repeatedly, without feeling awkward about it." },
  { id: "enablement-3", type: "enablement", statement: "I say yes to a request for help before I know what it involves." },
  { id: "tenacity-3", type: "tenacity", statement: "I chase the last details standing between us and shipping." },
  { id: "wonder-3", type: "wonder", statement: "I lose time asking why a thing is the way it is." },
  { id: "invention-3", type: "invention", statement: "I have a possible answer before the person describing the problem has finished." },
  { id: "galvanizing-4", type: "galvanizing", statement: "I am the one who turns a decision into a group actually moving." },
  { id: "enablement-4", type: "enablement", statement: "I make myself useful to something somebody else has started." },
  { id: "tenacity-4", type: "tenacity", statement: "I get something out of closing a thing out, beyond being rid of it." },
  { id: "wonder-4", type: "wonder", statement: "In the middle of a plan, I ask out loud what problem we are really solving." },
  { id: "invention-4", type: "invention", statement: "I enjoy starting the part of a thing that does not exist yet." },
  { id: "discernment-4", type: "discernment", statement: "I change someone's idea slightly and it gets noticeably better." },
  { id: "enablement-5", type: "enablement", statement: "I find it satisfying to be the person who makes someone else's work possible." },
  { id: "tenacity-5", type: "tenacity", statement: "I hold to the standard when everyone else is ready to call it finished." },
  { id: "wonder-5", type: "wonder", statement: "I sit with an unease about a decision instead of shaking it off." },
  { id: "invention-5", type: "invention", statement: "I come up with several ways to do something, then pick between them." },
  { id: "discernment-5", type: "discernment", statement: "I go with a gut reaction on a decision and it turns out to be right." },
  { id: "galvanizing-5", type: "galvanizing", statement: "I talk a room into something it walked in indifferent about." },
  { id: "tenacity-6", type: "tenacity", statement: "I stay on something past the point where it stopped being fun." },
  { id: "wonder-6", type: "wonder", statement: "I come back to the same big question days later, unprompted." },
  { id: "invention-6", type: "invention", statement: "I offer an idea nobody asked me for." },
  { id: "discernment-6", type: "discernment", statement: "I spot the hole in an argument that everyone else has accepted." },
  { id: "galvanizing-6", type: "galvanizing", statement: "I follow up with people to keep a thing moving." },
  { id: "enablement-6", type: "enablement", statement: "I ask people what they need rather than what they have decided." },
  { id: "wonder-7", type: "wonder", statement: "I ask whether there is a better way to do something that already works." },
  { id: "invention-7", type: "invention", statement: "I redesign something in my head while I am using it." },
  { id: "discernment-7", type: "discernment", statement: "I weigh two options and know which one is right without working it out on paper." },
  { id: "galvanizing-7", type: "galvanizing", statement: "I enjoy the moment a group commits to something." },
  { id: "enablement-7", type: "enablement", statement: "I pick up the part nobody has claimed so the thing can move." },
  { id: "tenacity-7", type: "tenacity", statement: "I check that a thing actually got done, not just that it was agreed." },
] as const;

export const ITEMS_PER_TYPE = 7;

/**
 * Shown above the first statement.
 *
 * Someone who has met an instrument like this before arrives expecting to be
 * asked what they are good at, so it is worth saying once what is actually
 * being asked.
 */
export const INSTRUMENT_PREAMBLE =
  "Answer for how often this is actually you, not how you would like to be. There are no better or worse answers here.";

/**
 * Bumped whenever the item bank or the scoring changes, so old rows stay
 * readable.
 *
 * afs-1: the first thirty-item forced-choice bank.
 * afs-2: every item rewritten from "you would rather" to a concrete situation
 *        and what actually happens. Pairings, ids and order untouched, so
 *        afs-1 rows still scored identically.
 * afs-3: the same items in plainer words. Pairings, ids and order untouched
 *        again.
 * afs-4: forty-two statements on a five-point frequency scale, scored against
 *        each person's own mean. A different instrument, not a rewording of
 *        the last one: nothing an afs-3 row contains can be scored by it, and
 *        nothing it produces is comparable point-to-point with one. Rows
 *        written by afs-1 to afs-3 keep the result they were given on the day
 *        — scoring has always been a pure function over stored answers, and
 *        their stored profiles are read, never recomputed.
 */
export const INSTRUMENT_VERSION = "afs-4";

/* ---------------------------------------------------------------- scoring -- */

/** Item id to the point on the scale the founder chose. */
export type WorkingGeniusResponses = Record<string, number>;

export type WorkingGeniusResult = {
  version: string;
  /** Points per type, 7..35 for a complete set. */
  counts: Record<WorkingGeniusId, number>;
  /** All six, strongest first. */
  ranking: WorkingGeniusId[];
  bands: Record<WorkingGeniusBand, WorkingGeniusId[]>;
  /**
   * How steadily the seven statements for each type agreed with one another,
   * 0..1, averaged across the six.
   *
   * Seven answers that scatter from never to constantly describe somebody the
   * instrument has not understood, and the report says so rather than
   * presenting the profile as crisp.
   */
  consistency: number;
  /** How many of each type's statements were answered. Seven for a full set. */
  contests: Record<WorkingGeniusId, number>;
  /**
   * The raw level, 0..1, from the mean answer for that type.
   *
   * How much of this you do at all, independent of everybody else and of your
   * other five types. Shown alongside the bands; not what they are decided on.
   */
  rates: Record<WorkingGeniusId, number>;
  /**
   * The mean for that type minus this person's mean across all forty-two,
   * in scale points, roughly -2..+2.
   *
   * This is what the ranking sorts on. Somebody who answers "often" to
   * everything and "constantly" to invention is telling us about invention;
   * the raw means would say they are strong at all six, which is not a finding.
   */
  relative: Record<WorkingGeniusId, number>;
  /** Ids of statements left unanswered. Empty for a complete submission. */
  abstentions: string[];
  /** Kept so readers written for afs-1..3 rows keep working. Always empty here. */
  overrides: Array<{ itemId: string; clicked: WorkingGeniusId; resolved: WorkingGeniusId }>;
  /**
   * Types that finished level on the centred score, so the order between them
   * came from a fallback rather than from the answers.
   */
  contested: Array<[WorkingGeniusId, WorkingGeniusId]>;
  /**
   * The gap in centred score across each band boundary, in scale points. A gap
   * near zero means the split was all but a coin toss, which the UI says out
   * loud.
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

/** A point on the scale, or null for anything that is not one. */
export function readAnswer(raw: unknown): number | null {
  const value = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isInteger(value)) return null;
  return value >= 1 && value <= 5 ? value : null;
}

/** Population standard deviation. Zero for a single answer, by definition. */
function spread(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Scores a complete or partial response set.
 *
 * Pure, and deliberately so: re-scoring a stored row a year from now returns
 * the profile it returned on the day.
 */
export function scoreWorkingGenius(
  responses: WorkingGeniusResponses,
  completedAt: string,
  items: readonly WorkingGeniusItem[] = WORKING_GENIUS_ITEMS,
): WorkingGeniusResult {
  const counts = emptyCounts();
  const contests = emptyCounts();
  const rates = emptyCounts();
  const relative = emptyCounts();
  const answersByType: Record<WorkingGeniusId, number[]> = {
    wonder: [], invention: [], discernment: [], galvanizing: [], enablement: [], tenacity: [],
  };
  const abstentions: string[] = [];

  for (const item of items) {
    const answer = readAnswer(responses[item.id]);
    if (answer === null) {
      abstentions.push(item.id);
      continue;
    }
    counts[item.type] += answer;
    contests[item.type] += 1;
    answersByType[item.type].push(answer);
  }

  const answered = WIDGET_ORDER.flatMap((t) => answersByType[t]);
  /* The person's own centre. With nothing answered there is nothing to centre
     on, and 3 — the midpoint of the scale — is the only defensible stand-in. */
  const personMean = answered.length ? answered.reduce((sum, v) => sum + v, 0) / answered.length : 3;

  for (const t of WIDGET_ORDER) {
    const own = answersByType[t];
    const mean = own.length ? own.reduce((sum, v) => sum + v, 0) / own.length : 1;
    /* 0..1, so a bar can be drawn from it without the UI knowing the scale. */
    rates[t] = (mean - 1) / 4;
    relative[t] = own.length ? mean - personMean : -Infinity;
  }

  /*
   * Ranking sorts on the centred score.
   *
   * Ties are real and common on a five-point scale with seven items, so the
   * fallback is chosen rather than incidental: the steadier answer set wins,
   * because seven answers that agree with each other describe the type better
   * than seven that scatter around the same average. WIDGET order breaks what
   * is still level, for determinism, and every tie at that point is reported
   * in `contested` rather than hidden.
   */
  const steadiness = (t: WorkingGeniusId) => spread(answersByType[t]);
  const widgetIndex = (t: WorkingGeniusId) => WIDGET_ORDER.indexOf(t);
  const scoreKey = (t: WorkingGeniusId) => Math.round(relative[t] * 1e6);

  const ranking = [...WIDGET_ORDER].sort((a, b) => {
    const byScore = scoreKey(b) - scoreKey(a);
    if (byScore !== 0) return byScore;
    const bySteadiness = steadiness(a) - steadiness(b);
    if (bySteadiness !== 0) return bySteadiness;
    return widgetIndex(a) - widgetIndex(b);
  });

  const contested: Array<[WorkingGeniusId, WorkingGeniusId]> = [];
  for (let i = 0; i < ranking.length - 1; i++) {
    const here = ranking[i];
    const next = ranking[i + 1];
    if (!here || !next) continue;
    if (scoreKey(here) === scoreKey(next) && steadiness(here) === steadiness(next)) {
      contested.push([here, next]);
    }
  }

  /*
   * Seven answers per type that agree with one another describe somebody the
   * instrument has understood. Spread is mapped against 2.0, the widest a set
   * of answers on a five-point scale can be, so 1 is perfect agreement and 0
   * is somebody answering never and constantly to the same type.
   */
  const spreads = WIDGET_ORDER.map((t) => (answersByType[t].length >= 2 ? spread(answersByType[t]) : null))
    .filter((v): v is number => v !== null);
  const consistency = spreads.length
    ? Math.max(0, Math.min(1, 1 - spreads.reduce((sum, v) => sum + v, 0) / spreads.length / 2))
    : 0;

  if (ranking.length !== WIDGET_ORDER.length) {
    throw new Error(`ranking produced ${ranking.length} types, expected ${WIDGET_ORDER.length}`);
  }
  const placed = ranking as [
    WorkingGeniusId, WorkingGeniusId, WorkingGeniusId,
    WorkingGeniusId, WorkingGeniusId, WorkingGeniusId,
  ];

  /** Never reports a gap of Infinity for a type nobody answered. */
  const gap = (higher: WorkingGeniusId, lower: WorkingGeniusId) => {
    const diff = relative[higher] - relative[lower];
    return Number.isFinite(diff) ? diff : 0;
  };

  return {
    version: INSTRUMENT_VERSION,
    counts,
    ranking,
    bands: {
      genius: ranking.slice(0, 2),
      competency: ranking.slice(2, 4),
      frustration: ranking.slice(4, 6),
    },
    consistency,
    contests,
    rates,
    relative,
    abstentions,
    overrides: [],
    contested,
    boundaryMargins: {
      geniusCompetency: gap(placed[1], placed[2]),
      competencyFrustration: gap(placed[3], placed[4]),
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
