import { dueInstant } from "./deadlines";

/**
 * The working-style assessment is closed until the cohort is in the room.
 *
 * Asked for: open it on Tuesday 8 September 2026 at 09:00, which is the
 * morning the sprint starts. Thirty either-or questions answered cold, before
 * anybody has explained what the six types are or what the result is for, is
 * thirty guesses — and the result is kept and shown on the team map, so a bad
 * first take is not a private mistake.
 *
 * Deliberately a separate module from checkin-window rather than a shared
 * "feature windows" abstraction. Both are temporary holds on unrelated things
 * with different dates, and each should come out by deleting one file and the
 * handful of places that read it. A common module would make removing one of
 * them a change to the other.
 */

/** 09:00 as the room reads a clock, which is Helsinki. */
export const WORKING_GENIUS_OPENS_ON = "2026-09-08";
export const WORKING_GENIUS_OPENS_TIME = "09:00";

/**
 * The exact instant, as UTC milliseconds.
 *
 * Through dueInstant rather than Date.parse, because the server runs UTC and
 * the time above is a wall clock in Espoo. That helper reads the offset from
 * the candidate instant, so moving this date across a clock change stays
 * correct instead of landing an hour out.
 */
export const WORKING_GENIUS_OPENS_AT = dueInstant(WORKING_GENIUS_OPENS_ON, WORKING_GENIUS_OPENS_TIME);

/** Whether the assessment is still held closed. */
export function workingGeniusLocked(now: number = Date.now()): boolean {
  return now < (serverOverride() ?? WORKING_GENIUS_OPENS_AT);
}

/**
 * A way for the test harness to stand on the far side of the hold.
 *
 * Several suites take the assessment end to end — privacy, retakes, the team
 * map — and all of them need the save to reach the database.
 *
 * **Not a production switch.** Read on the server only: Vite replaces
 * `process.env` with an empty object literal in the browser bundle, so this is
 * a lookup against `{}` there and always returns null however the server is
 * configured. Setting it on Render would open the endpoint while every
 * founder's screen still said closed. To move the date for real, change the
 * two constants above and deploy.
 */
function serverOverride(): number | null {
  if (typeof process === "undefined") return null;
  const raw = process.env?.WORKING_GENIUS_OPENS_AT_OVERRIDE;
  if (!raw) return null;
  const at = Number(raw);
  return Number.isFinite(at) ? at : null;
}

/** When it opens, for saying out loud: "Tuesday 8 September, 09:00". */
export function workingGeniusOpensLabel(): string {
  const [y, m, d] = WORKING_GENIUS_OPENS_ON.split("-").map(Number);
  const at = new Date(Date.UTC(y!, m! - 1, d!, 12));
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][at.getUTCDay()];
  const month = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][at.getUTCMonth()];
  return `${weekday} ${d} ${month}, ${WORKING_GENIUS_OPENS_TIME}`;
}
