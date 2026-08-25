/**
 * Date and time validation for programme events.
 *
 * A separate module from the API route on purpose, and the reason is not
 * tidiness. The route imports db/index, which resolves DB_PATH the moment it
 * is first imported; a test that statically imports the route therefore opens
 * the database before a harness has pointed DB_PATH anywhere, and every later
 * test in the process silently reads the wrong file. That has bitten this
 * codebase once already. Pure functions live where nothing is opened to reach
 * them.
 */

/** YYYY-MM-DD, and a real day — 2026-02-31 parses as March and is refused. */
export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** HH:MM on a 24-hour clock, or empty for an all-day entry. */
export function validTime(value: unknown): value is string {
  return typeof value === "string" && (value === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
}
