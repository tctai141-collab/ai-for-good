import { dueInstant } from "./deadlines";

/**
 * The daily check-in is closed until the cohort has been told what it is.
 *
 * Asked for directly: locked until 9 September 2026 at 18:00. The sprint opens
 * on the 8th, and a founder who finds a daily reflection ritual before anybody
 * has explained it either skips it or fills it in wrong, and a habit only gets
 * one first impression.
 *
 * Deliberately one constant and one predicate. This is a temporary hold, not a
 * scheduling feature, and the whole of it should be removable by deleting this
 * file and the four places that read it.
 */

/** 18:00 as the room reads a clock, which is Helsinki. */
export const CHECKIN_OPENS_ON = "2026-09-09";
export const CHECKIN_OPENS_TIME = "18:00";

/**
 * The exact instant, as UTC milliseconds.
 *
 * Via dueInstant rather than Date.parse, because the server runs UTC and the
 * time above is a wall clock in a room in Espoo. That helper already reads the
 * offset from the candidate instant, so it stays correct across a clock change
 * — September is summer time, and hard-coding +3 would be right today and
 * wrong for anybody who moves this date into late October.
 */
export const CHECKIN_OPENS_AT = dueInstant(CHECKIN_OPENS_ON, CHECKIN_OPENS_TIME);

/**
 * A way for the test harness to stand on the far side of the hold.
 *
 * Two suites drive a real check-in through /api/chat to assert things about
 * prompt caching — that the check-in framing, which embeds the current server
 * time, never lands in the cached prefix. Those are guarding a bug worth
 * guarding and they need the request to reach the model, which the hold
 * otherwise refuses.
 *
 * **Not a production switch**, and it cannot become one by accident. Checked
 * in the built client bundle: Vite replaces `process.env` with an empty object
 * literal at build time, so this reads `{}` in a browser and always returns
 * null there however the server is configured. Setting it on Render would open
 * the endpoint while every founder's screen still said the check-in was
 * closed — worse than either state on its own. To move the date for real,
 * change the two constants above and deploy.
 */
function serverOverride(): number | null {
  if (typeof process === "undefined") return null;
  const raw = process.env?.CHECKIN_OPENS_AT_OVERRIDE;
  if (!raw) return null;
  const at = Number(raw);
  return Number.isFinite(at) ? at : null;
}

/** Whether the check-in is still held closed. */
export function checkinLocked(now: number = Date.now()): boolean {
  return now < (serverOverride() ?? CHECKIN_OPENS_AT);
}

/**
 * When it opens, for saying out loud: "Wednesday 9 September, 18:00".
 *
 * Built from the constants rather than formatted from the instant, so it says
 * the wall-clock time that was asked for wherever the reader happens to be. A
 * founder abroad for the week should be told the time the room will be using,
 * which is the time everyone else will have answered at.
 */
export function checkinOpensLabel(): string {
  const [y, m, d] = CHECKIN_OPENS_ON.split("-").map(Number);
  const at = new Date(Date.UTC(y!, m! - 1, d!, 12));
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][at.getUTCDay()];
  const month = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][at.getUTCMonth()];
  return `${weekday} ${d} ${month}, ${CHECKIN_OPENS_TIME}`;
}
