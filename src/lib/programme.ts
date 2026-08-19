import { getProgrammeWeek } from "../db/index";
import { weekForDate, TOTAL_WEEKS } from "./sprint-calendar";

/**
 * What the advisor is told about the programme.
 *
 * This replaces a hardcoded TypeScript file that caused a real incident: a
 * founder asked how to do market validation and was told about "the automation
 * and robotics space you are looking at". Three faults produced that, and this
 * module exists to make each one impossible rather than unlikely.
 *
 *   IT WAS THE WRONG COHORT. The file still held the previous cohort's research
 *   theme months later, because changing it meant a code change and a deploy.
 *   The content now lives in the database and is edited from /admin.
 *
 *   IT READ AS A FACT ABOUT THE FOUNDER. Milestones were handed over with no
 *   framing, so a cohort-wide research topic was taken as a statement about one
 *   person's company. The block below says what it is, in the text itself, and
 *   says plainly that it describes the programme and not the founder.
 *
 *   IT CLAIMED A WEEK THAT HAD NOT STARTED. The week number was clamped into
 *   range, so three weeks before the sprint began it announced "Week 1 of 15".
 *   This uses weekForDate, which returns null outside the programme, and says
 *   nothing at all rather than guessing.
 *
 * Silence is the default everywhere: no start date, outside the programme, or
 * nothing entered for the current week all produce an empty string.
 */
export function buildProgrammeContext(now = new Date()): string {
  const week = weekForDate(now);
  if (week === null) return "";

  const row = getProgrammeWeek(week);
  if (!row) return "";

  const lines = (value: string) =>
    value.split("\n").map((l) => l.trim()).filter(Boolean);

  const milestones = lines(row.milestones);
  const sessions = lines(row.sessions);

  const heading = [row.phase, row.title].filter(Boolean).join(" — ");

  const parts = [
    "PROGRAMME — the cohort's shared schedule",
    "",
    `This describes what the Aalto Founder Sprint is running this week. It is not a`,
    `description of this founder's company, their sector, or what they are building.`,
    `Never infer any of that from it — ask them. Use it only to know where the`,
    `programme is and what is coming up, and only state what appears below.`,
    "",
    `Week ${week} of ${TOTAL_WEEKS}${heading ? `: ${heading}` : ""}`,
  ];

  if (milestones.length > 0) {
    parts.push("", "What the programme asks of the cohort this week:");
    parts.push(...milestones.map((m) => `- ${m}`));
  }

  if (sessions.length > 0) {
    parts.push("", "Sessions this week:");
    parts.push(...sessions.map((e) => `- ${e}`));
  }

  return parts.join("\n");
}
