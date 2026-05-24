export type SprintEvent = {
  day: string;
  time: string;
  title: string;
  notes: string;
};

export type SprintWeek = {
  week: number;
  sprint: string;
  title: string;
  milestones: string[];
  events: SprintEvent[];
};

export type SelfDevTheme = {
  personal: string[];
  leadership: string[];
};

export const SPRINT_WEEKS: SprintWeek[] = [
  {
    week: 1,
    sprint: "Trend Research",
    title: "Orientation & Kick-off",
    milestones: [
      "Define research framework",
      "Define max 3 sub-sectors within automation & robotics to focus on",
      "Clarify roles and tasks",
    ],
    events: [
      { day: "Tue W1", time: "9:30–11:30", title: "Team meeting — Intro to Sprint, onboarding", notes: "" },
      { day: "Tue W1", time: "11:30–13:00", title: "Team lunch", notes: "" },
      { day: "Wed W1", time: "13:00–15:00", title: "Intro to research topic + workshop", notes: "Chief Economist at Startup Foundation" },
      { day: "Thu W1", time: "16:00–18:00", title: "Fun activity & cohort photos", notes: "" },
      { day: "Fri–Sun W1", time: "", title: "Team cottage weekend", notes: "Space for 20 people" },
    ],
  },
  {
    week: 2,
    sprint: "Trend Research",
    title: "Deep Dive Research & Report Structure",
    milestones: [
      "Identify and schedule potential interview targets",
      "Draft interview guide with 15–20 core questions",
      "Start researching chosen trends",
      "Submit: Draft structure",
    ],
    events: [
      { day: "Tue W2", time: "10:00–11:30", title: "Team meeting", notes: "" },
      { day: "Tue W2", time: "10:00–11:00", title: "How to run an interview", notes: "" },
      { day: "Wed W2", time: "13:00–15:00", title: "Sales experience — interviewing customers vs. road to $1M", notes: "Founder-CEO session" },
      { day: "Thu W2", time: "16:00–18:00", title: "VC language & investment thesis", notes: "VC guest session" },
    ],
  },
  {
    week: 3,
    sprint: "Trend Research",
    title: "Fieldwork & Interviews",
    milestones: [
      "Complete most interviews",
      "Develop future scenarios / startup opportunities",
      "Create initial data visualizations",
      "Submit outline of full report structure",
    ],
    events: [
      { day: "Tue W3", time: "10:00–11:30", title: "Team meeting", notes: "" },
      { day: "Wed W3", time: "13:00–15:00", title: "Guest speaker session", notes: "" },
      { day: "Thu W3", time: "16:00–18:00", title: "Investor session — VC perspective", notes: "" },
    ],
  },
  {
    week: 4,
    sprint: "Trend Research",
    title: "Ideation & Opportunity Mapping",
    milestones: [
      "Complete final interviews",
      "Validate insights with 3–5 stakeholders",
      "Complete startup opportunities section",
      "90% of report done",
      "Executive summary + presentation deck",
    ],
    events: [
      { day: "Tue W4", time: "10:00–11:30", title: "Team meeting — How to give feedback session", notes: "" },
      { day: "Tue W4", time: "17:00–18:00", title: "Coaching hour", notes: "" },
      { day: "Wed W4", time: "13:00–15:00", title: "Communications strategy", notes: "CMO / Co-founder guest session" },
      { day: "Thu W4", time: "16:00–18:00", title: "VC investment thesis + workshop", notes: "VC guest session" },
    ],
  },
  {
    week: 5,
    sprint: "Trend Research",
    title: "Report Synthesis & Presentation",
    milestones: [
      "100% complete — final report published",
      "Presentation deck complete (15–20 slides)",
      "Deliver final presentation",
    ],
    events: [
      { day: "Tue W5", time: "10:00–11:30", title: "Team meeting", notes: "" },
      { day: "Tue W5", time: "17:00–18:00", title: "Pitch Finland — 10 startups pitching to angels", notes: "" },
      { day: "Wed W5", time: "13:00–15:00", title: "Final Presentation + Intro to Sprint 2", notes: "Jury" },
      { day: "Thu W5", time: "16:00–18:00", title: "Founder Talks", notes: "" },
    ],
  },
  {
    week: 6,
    sprint: "Product Sprint",
    title: "Validation Before Creation",
    milestones: [
      "Split into teams — continue from Sprint 1 themes or pick new",
      "Set up user interviews with clear problem statement",
      "Low-fidelity mockups",
    ],
    events: [
      { day: "Tue W6", time: "10:00–11:30", title: "Team meeting", notes: "" },
      { day: "Wed W6", time: "13:00–15:00", title: "From Guess to Evidence", notes: "Guest session" },
      { day: "Thu W6", time: "16:00–18:00", title: "Idea validation", notes: "Partner organization session" },
    ],
  },
  {
    week: 7,
    sprint: "Product Sprint",
    title: "Design Something to Show",
    milestones: [
      "High-fidelity mockups, click-through prototypes, storyboards",
      "Landing page & UI mockups in front of real users",
      "Conduct user interviews",
    ],
    events: [
      { day: "Tue W7", time: "10:00–11:30", title: "Pitching workshop", notes: "Guest session" },
      { day: "Tue W7", time: "11:30–12:30", title: "Coaching hour", notes: "" },
      { day: "Thu W7", time: "16:00–18:00", title: "Design & UX session", notes: "Guest session" },
    ],
  },
  {
    week: 8,
    sprint: "Product Sprint",
    title: "User Interviews",
    milestones: [
      "Feedback from users",
      "Iterating, pivoting, testing different designs",
    ],
    events: [
      { day: "Mon W8", time: "11:30–12:30", title: "Founder lunch & chat", notes: "" },
      { day: "Tue W8", time: "10:00–11:30", title: "Quality check session (Antler)", notes: "" },
      { day: "Wed W8", time: "13:00–15:00", title: "ASUC Demo Day — cohort demos", notes: "" },
      { day: "Thu W8", time: "16:00–18:00", title: "User interview session with VC guests", notes: "" },
    ],
  },
  {
    week: 9,
    sprint: "Product Sprint",
    title: "MVP Definition",
    milestones: [
      "Based on user interviews: what could the team build that people want?",
      "Decide what the MVP would be if we built it",
    ],
    events: [
      { day: "Tue W9", time: "10:00–10:45", title: "Session block A", notes: "" },
      { day: "Tue W9", time: "10:45–11:30", title: "Team meeting", notes: "" },
      { day: "Tue W9", time: "17:00–18:00", title: "Coaching hour", notes: "" },
      { day: "Wed W9", time: "13:00–15:00", title: "Founders House session — Wave Ventures CEO", notes: "" },
      { day: "Thu W9", time: "16:00–18:00", title: "Technical / product development session", notes: "Guest session" },
    ],
  },
  {
    week: 10,
    sprint: "Product Sprint",
    title: "MVP Definition: Pivot or Persevere?",
    milestones: [
      "Final week of Sprint 2",
      "Pivot-or-persevere decision",
    ],
    events: [
      { day: "Tue W10", time: "10:00–11:30", title: "Mental resilience in high-pressure environments", notes: "Guest session" },
      { day: "Wed W10", time: "13:00–15:00", title: "Founder mentality session", notes: "Guest session" },
      { day: "Thu W10", time: "16:00–18:00", title: "Founder Talks", notes: "Guest founder speaker" },
    ],
  },
  {
    week: 11,
    sprint: "Study Trip",
    title: "Ecosystem Excursion to Munich",
    milestones: [
      "Visit local startups, VCs, CDTM",
      "Learn from the local ecosystem",
      "Team bonding",
    ],
    events: [
      { day: "Mon W11", time: "", title: "Flights to Munich", notes: "" },
      { day: "Tue W11", time: "10:00–11:30", title: "Team meeting", notes: "" },
      { day: "Tue W11", time: "17:00–18:00", title: "Coaching / networking session", notes: "" },
      { day: "Wed W11", time: "13:00–15:00", title: "Ecosystem visits", notes: "" },
      { day: "Thu W11", time: "", title: "Flights back to Helsinki", notes: "" },
    ],
  },
  {
    week: 12,
    sprint: "Business & Strategy",
    title: "Fundraising",
    milestones: [
      "Intro to Sprint 3: agenda and goals",
      "Angel, VC, and public funding landscape",
      "Go-to-market (GTM) overview",
    ],
    events: [
      { day: "Tue W12", time: "10:00–11:30", title: "Team meeting", notes: "" },
      { day: "Wed W12", time: "13:00–14:00", title: "Tips for talking to investors", notes: "Guest session" },
      { day: "Wed W12", time: "14:00–15:00", title: "VC sandbox", notes: "" },
      { day: "Thu W12", time: "16:00–18:00", title: "Industry guest session", notes: "TBC" },
    ],
  },
  {
    week: 13,
    sprint: "Business & Strategy",
    title: "Team, Culture & Storytelling",
    milestones: [
      "How to build a team and company culture",
      "Storytelling for founders",
      "Pitch practice",
    ],
    events: [
      { day: "Tue W13", time: "10:00–11:30", title: "Team meeting", notes: "" },
      { day: "Tue W13", time: "10:00–11:30", title: "Go-to-market session", notes: "Guest session" },
      { day: "Tue W13", time: "17:00–18:00", title: "Coaching hour", notes: "" },
      { day: "Wed W13", time: "13:00–15:00", title: "⅓ final pitching session", notes: "At VC office" },
      { day: "Thu W13", time: "16:00–18:00", title: "BabyVC session", notes: "" },
    ],
  },
  {
    week: 14,
    sprint: "Business & Strategy",
    title: "Finding a Co-Founder",
    milestones: [
      "Founder mindset deep dive",
      "What investors look for — frameworks and red/green flags",
      "Team culture workshop",
    ],
    events: [
      { day: "Tue W14", time: "10:00–12:00", title: "Founder mindset — ByFounders framework", notes: "VC guest session" },
      { day: "Wed W14", time: "13:00–15:00", title: "Team culture session", notes: "Guest CEO session" },
      { day: "Thu W14", time: "16:00–18:00", title: "Founder Talks", notes: "" },
    ],
  },
  {
    week: 15,
    sprint: "Business & Strategy",
    title: "Final Week",
    milestones: [
      "Rewrite working with me document",
      "Working Genius team assessment and reflection",
      "Final Presentation to Lifeline Ventures",
      "Graduation",
    ],
    events: [
      { day: "Tue W15", time: "10:00–11:30", title: "Team meeting", notes: "" },
      { day: "Tue W15", time: "17:00–18:00", title: "Coaching hour", notes: "" },
      { day: "Tue W15", time: "16:00–18:00", title: "Guest founder session", notes: "" },
      { day: "Wed W15", time: "15:00–17:00", title: "Final Presentation — Lifeline Ventures", notes: "" },
      { day: "Thu W15", time: "16:00–18:00", title: "Private Graduation", notes: "" },
    ],
  },
];

export const SELF_DEV_THEMES: SelfDevTheme = {
  personal: [
    "Practicing vulnerability and openness to build trust",
    "Being part of a new team and committing to the team's success",
    "Admitting fault, ignorance, or insufficiency",
    "Seeing something positive in every team member",
    "Understanding the motivations of a person you don't respect",
    "Doing something new and scary",
    "Learning a new skill far outside one's existing domain",
    "Taking the Jung Myers-Briggs test and reflecting on the results",
    "Taking the Working Genius test and reflecting on the results",
    "Killing a darling — letting go of an idea, a conviction, control, or a role",
    "Removing a blind spot in one's professional profile",
    "Overcoming fear of rejection",
    "Regulating emotional reactions",
    "Learning not to blame people or circumstances",
    "Turning cynicism and negativity into something productive",
    "Celebrating success — small and large",
    "Being present in the moment and seeing the person first, the matter second",
    "Personal grounding: staying sane amid the madness",
    "Managing stress and avoiding burnout",
    "Rising again after failure",
    "Finding purpose behind the grind",
    "Selflessness",
  ],
  leadership: [
    "Learning to listen to understand, not to respond",
    "Making sure everyone gets their voice heard in a team",
    "Delivering uncomfortable feedback to a team member",
    "Delivering genuine and substantive praise to a team member",
    "Learning to run productive meetings",
    "Learning to move faster",
    "GSD — never missing a task deadline",
    "The humility–confidence contrast: maximizing humility without losing drive",
    "The decisive–non-judgmental contrast: making quick decisions without judging people",
    "Learning to delegate tasks effectively",
    "Learning to say no",
    "Learning to set priorities",
    "Learning the method of asking seven Whys",
    "Selling an idea to another person",
    "Bringing positive energy to every interaction",
    "Holding someone accountable",
    "Seeing problems around the corner before they happen",
    "Solving a conflict with another person",
    "Learning to express oneself clearly and kindly",
  ],
};

export function getSprintContext(): string {
  const now = new Date();
  const currentWeek = Number(Bun.env.SPRINT_WEEK || "1");

  const week = SPRINT_WEEKS.find((w) => w.week === currentWeek);
  if (!week) return "";
  const nextWeek = SPRINT_WEEKS.find((w) => w.week === currentWeek + 1);

  const today = now.toLocaleDateString("en-US", { weekday: "long" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const todaysEvents = week.events.filter((e) => e.day.toLowerCase().includes(today.slice(0, 3).toLowerCase()));
  const upcomingEvents = week.events.filter((e) => {
    const dayPrefix = e.day.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i)?.[1]?.toLowerCase() || "";
    const dayIndex = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(dayPrefix);
    const todayIndex = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(today.toLowerCase());
    return dayIndex >= 0 && dayIndex > todayIndex;
  });

  return [
    `## Sprint S26 Context`,
    `Today is ${today}, ${now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} · Current time: ${timeStr}`,
    ``,
    `**You are now in Week ${currentWeek} of 15:** ${week.sprint} — "${week.title}"`,
    `**Current milestones:** ${week.milestones.join("; ")}`,
    ``,
    todaysEvents.length > 0 ? `**Today's sessions:**\n${todaysEvents.map((e) => `- ${e.time} — ${e.title}${e.notes ? ` (${e.notes})` : ""}`).join("\n")}` : "",
    upcomingEvents.slice(0, 3).length > 0 ? `\n**Coming up this week:**\n${upcomingEvents.slice(0, 3).map((e) => `- ${e.day}: ${e.title}`).join("\n")}` : "",
    nextWeek ? `\n**Next week:** Week ${nextWeek.week} — ${nextWeek.sprint}: ${nextWeek.title}. Milestones: ${nextWeek.milestones.slice(0, 3).join("; ")}.` : "",
    ``,
    `**This week's self-dev focus (pick one):**`,
    `- Personal: ${pickOne(SELF_DEV_THEMES.personal)}`,
    `- Leadership: ${pickOne(SELF_DEV_THEMES.leadership)}`,
    ``,
    `When appropriate, nudge the founder about today's sessions, upcoming sessions, and current sprint milestones. For daily check-ins, briefly remind them what the program expects this week before asking the first question. Talk as Mårten would — direct, warm, brief.`,
  ].filter(Boolean).join("\n");
}

function pickOne(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}
