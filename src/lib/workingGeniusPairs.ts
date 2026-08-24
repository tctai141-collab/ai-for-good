import { WIDGET_ORDER, typeById, type WorkingGeniusId } from "./workingGenius";

/**
 * The fifteen pairings.
 *
 * Someone's top two together say more than either does alone, and this is the
 * page founders actually use on each other in a cohort session.
 *
 * Every name and every word here is written for this codebase. The published
 * version of this model has its own names for these combinations and they are
 * not used, not adapted, and not glanced at. If a name below ever starts to
 * sound familiar, that is the thing to change.
 *
 * Written for founders in a sprint, so each one says what the pairing is good
 * for in a founding team and how it characteristically fails. No praise, no
 * horoscope. A pairing is a shape, and every shape has a hole in it.
 */

export type Pairing = {
  /** Sorted WIDGET order, so lookup does not care which way round it arrives. */
  pair: [WorkingGeniusId, WorkingGeniusId];
  /** Ours. Short enough to say out loud in a session. */
  name: string;
  /** What the combination is like in practice. Second person. */
  inPractice: string;
  /** The conditions it needs. */
  thrives: string;
  /** What reliably grinds it down. */
  frustrates: string;
};

export const PAIRINGS: readonly Pairing[] = [
  {
    pair: ["wonder", "invention"],
    name: "The Open Field",
    inPractice:
      "You are at your best before anything has been decided. You find the question worth asking and then you answer it with something that did not exist, often in the same sitting. Founding teams get their first real idea from people built like this, and so do their second and third. What you produce is genuinely new rather than a rearrangement of what was already on the table.",
    thrives:
      "Unclaimed problems, an early stage, and someone downstream who will judge and finish what you start. You need the room to be genuinely open, not open as a formality with the answer already chosen.",
    frustrates:
      "Being handed a decided plan and asked to execute it. Also being asked, repeatedly, which of your own ideas is the right one: the choosing is not the part that gives you anything back, and left alone with it you will generate a fourth option rather than pick between three.",
  },
  {
    pair: ["wonder", "discernment"],
    name: "The Long Look",
    inPractice:
      "You see both what is missing and what is wrong, which makes you unusually hard to sell to and unusually valuable to sit next to. You ask the question the room has been avoiding, then you can tell whether the answer it produces is any good. Teams with you in them make fewer confident mistakes.",
    thrives:
      "Being brought in before the commitment rather than after it, and being asked what you think rather than asked to approve. You need someone nearby who generates and someone who finishes, or the good judgment has nothing to be applied to.",
    frustrates:
      "Speed for its own sake, and being read as negative. You are not slowing things down for the pleasure of it; you can see the thing everyone will discover in three weeks. Being asked to build out an idea you have already judged as wrong is the fastest way to lose you.",
  },
  {
    pair: ["wonder", "galvanizing"],
    name: "The Signal",
    inPractice:
      "You notice what matters and you can make other people care about it. That combination is rare and it moves rooms. In a founding team you are usually the one who names the thing everyone half-knew and then gets them moving on it before the feeling fades.",
    thrives:
      "An audience and a live question. You need people to talk to, and you need the thing you are rallying them towards to be something you actually believe, because you cannot fake this and it shows when you try.",
    frustrates:
      "Detail work in silence, and being asked to carry what you started. You will get a team excited about a direction and then find the follow-through has been left with you, which drains you faster than the original work ever energised you.",
  },
  {
    pair: ["wonder", "enablement"],
    name: "The Open Door",
    inPractice:
      "You notice what is going on with people and with the work, and your instinct is to help. You are usually the first to see that someone is stuck on the wrong problem, and the first to do something about it. Teams feel steadier with you in them, and often cannot say exactly why.",
    thrives:
      "Being close to the actual work and the actual people. You need enough slack to respond to what you notice, and you need someone to say out loud that the noticing is part of the job, because it does not show up in any output.",
    frustrates:
      "Being the last to know, and being handed a queue. You are responsive by design, and a fixed backlog with no room to react to what is actually happening turns the best part of how you work into an interruption.",
  },
  {
    pair: ["wonder", "tenacity"],
    name: "The Wide Finish",
    inPractice:
      "An unusual combination: you want to know what the real question is, and you want it done. You will open something up, sit with it properly, and then close it out yourself rather than hand it on. In a small founding team that is close to a whole pipeline in one person.",
    thrives:
      "Ownership from beginning to end, and few enough things in flight that you can actually finish them. You are at your worst spread thin, because the opening and the closing both need your full attention and they compete.",
    frustrates:
      "The middle. Generating options and building consensus are the two things you have to get through to reach the part you want, and being asked to spend most of your week in them is the version of this pairing that burns out.",
  },
  {
    pair: ["invention", "discernment"],
    name: "The Workbench",
    inPractice:
      "You make things and you can tell whether they are any good, which means your second version is usually better than most people's fifth. You need less outside feedback than others do, because you are already running it. In a founding team you are the one who quietly raises the standard of what gets shown.",
    thrives:
      "A clear problem and time to iterate on it. You need the problem handed to you, because finding it is not where your energy is, and you need enough runway to get past the first attempt, which you will already know is not it.",
    frustrates:
      "Shipping something you know is not ready, and open-ended exploration with nothing to judge yet. Also being made to explain your reasoning at every step: a lot of the judgment is fast and it is not less right for being fast.",
  },
  {
    pair: ["invention", "galvanizing"],
    name: "The Pitch",
    inPractice:
      "You come up with it and you can sell it, which is the combination most people mean when they say somebody is a founder. You will have the idea and have three people excited about it before the week is out. Early-stage momentum comes from people built this way.",
    thrives:
      "Early stage, a blank slate, and people to convince. You need permission to move before everything is proven, because waiting for certainty removes the thing you are good at.",
    frustrates:
      "Maintenance, and the gap between the pitch and the reality. This pairing sells things that do not exist yet, which is a strength right up until nobody is left to build them. Being asked to finish is the fastest way to drain you.",
  },
  {
    pair: ["invention", "enablement"],
    name: "The Second Pair of Hands",
    inPractice:
      "You solve other people's problems, and you do it by making something rather than by advising. Someone describes what is in their way and you build the thing that removes it. Teams find this enormously useful and frequently forget to credit it, because the output shows up as their progress.",
    thrives:
      "Being asked. You are responsive rather than self-directing, and you do your best work in service of somebody with a concrete problem. A clear request and the freedom to answer it your own way is all you need.",
    frustrates:
      "Vague demand and no thanks. Also having to fight for your own idea: you will offer something better and let it go rather than campaign for it, which means teams with you in them lose good ideas quietly.",
  },
  {
    pair: ["invention", "tenacity"],
    name: "The Builder",
    inPractice:
      "You think of it and then you actually make it exist, which is rarer than it sounds. Most people who can do the first cannot face the second. You will take something from nothing to finished without needing a team, which in the first months of a company is close to the whole job.",
    thrives:
      "Ownership, few interruptions, and a scope you can hold in your head. You are one of the few pairings that does not need much from anyone else, which is a strength and also how you end up carrying things alone.",
    frustrates:
      "Committees, consultation, and having to bring people along. You will have finished it while the meeting about it was still being scheduled, and being asked to slow down to get buy-in reads to you as pure waste.",
  },
  {
    pair: ["discernment", "galvanizing"],
    name: "The Verdict",
    inPractice:
      "You work out what is right and then you get people behind it, which makes you unusually persuasive: you are not selling, you are reporting a conclusion you actually reached. Teams follow this because it is not enthusiasm, it is enthusiasm with a reason underneath it.",
    thrives:
      "A real decision to make and a room that has to move afterwards. You need to be in the conversation early enough that your judgment shapes the choice rather than ratifying one already made.",
    frustrates:
      "Generating the options in the first place, and finishing what you have set moving. You can tell which of five things is right; being asked to produce the five is a different job and it costs you.",
  },
  {
    pair: ["discernment", "enablement"],
    name: "The Steady Hand",
    inPractice:
      "You can tell what is off and your instinct is to help rather than to criticise, which makes you one of the few people whose feedback lands without a fight. Founders bring things to you before they bring them to anyone else. That is worth more in a young team than almost anything on the org chart.",
    thrives:
      "Trust and proximity. You need to be close enough to the work to see it early, and you need the team to understand that you are giving them a read rather than a verdict.",
    frustrates:
      "Being asked to originate, and being asked to push. Neither the blank page nor the rallying speech is yours, and a role that is mostly either one will quietly wear you down while you keep doing it well.",
  },
  {
    pair: ["discernment", "tenacity"],
    name: "The Closer",
    inPractice:
      "You know what good looks like and you will stay with it until it is that. Things that pass through you are finished properly, which in a sprint is the difference between a demo that holds and one that falls over. You are usually the reason the last ten percent actually happens.",
    thrives:
      "A defined thing to finish and the authority to say when it is done. You need the standard to be yours, because being made to ship something you have judged as not ready is genuinely painful rather than merely annoying.",
    frustrates:
      "The front of the process. Wondering and inventing feel like circling to you, and a week spent in them with nothing to judge or close is a week you finish with nothing to show and no energy left.",
  },
  {
    pair: ["galvanizing", "enablement"],
    name: "The Engine Room",
    inPractice:
      "You get people moving and then you help them keep going, which is the combination that makes teams actually function. You are rarely the one whose name is on the idea, and the thing would not have happened without you. In a founding team this is the person who turns three individuals into something that works.",
    thrives:
      "People. This pairing needs a team to act on and does not do well alone. You also need someone else generating and judging, because you will happily mobilise around an idea nobody has checked.",
    frustrates:
      "Solitary work, and being asked to be the one who decides. You can move a room towards a decision far better than you can make one, and being left holding the choice is the position this pairing likes least.",
  },
  {
    pair: ["galvanizing", "tenacity"],
    name: "The Push",
    inPractice:
      "You get it started and you get it finished, which means things around you land. You will rally the team on Monday and be the one still going on Friday. Sprints run on people built like this, and so do the last two weeks before any deadline that actually gets met.",
    thrives:
      "A goal, a date, and a team. You need something concrete to push towards; this pairing is not fussy about whose idea it is and does not need to have thought of it.",
    frustrates:
      "Ambiguity and second-guessing. Being asked to explore, or to reconsider something already in motion, reads as going backwards. The characteristic failure is finishing the wrong thing extremely well because nobody upstream was asked whether it was right.",
  },
  {
    pair: ["enablement", "tenacity"],
    name: "The Backbone",
    inPractice:
      "You support the work and you complete it, and you do both without needing to be seen doing either. Teams with you in them deliver, and often cannot point at why. In a founding team you are the reason things that were promised actually exist.",
    thrives:
      "Clear priorities and people who tell you what they need. You are responsive and you finish, which is an unusually low-maintenance combination, and it means you are easy to overload without anyone noticing.",
    frustrates:
      "Being the one asked what the plan should be. Neither the question nor the idea is where your energy is, and a role that keeps asking you to originate will exhaust you long before the workload does. The failure mode is silence: you will absorb far too much and not say so.",
  },
] as const;

const key = (a: WorkingGeniusId, b: WorkingGeniusId) => {
  const [x, y] = [a, b].sort(
    (p, q) => WIDGET_ORDER.indexOf(p) - WIDGET_ORDER.indexOf(q),
  );
  return `${x}+${y}`;
};

const BY_KEY = new Map(PAIRINGS.map((p) => [key(p.pair[0], p.pair[1]), p]));

/** Order-insensitive lookup. Throws rather than returning a wrong pairing. */
export function pairingFor(a: WorkingGeniusId, b: WorkingGeniusId): Pairing {
  const found = BY_KEY.get(key(a, b));
  if (!found) throw new Error(`no pairing for ${a} + ${b}`);
  return found;
}

/** "Wonder and Invention", for headings. */
export function pairingTypes(p: Pairing): string {
  return `${typeById(p.pair[0]).label} and ${typeById(p.pair[1]).label}`;
}
