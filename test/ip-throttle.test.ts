import { beforeEach, describe, expect, test } from "bun:test";
import {
  isIpLockedOut,
  recordIpFailure,
  resetIpFailures,
  trackedIpCount,
} from "../src/lib/auth";
import { IP_FAILURE_LIMIT } from "../src/lib/limits";

/**
 * The per-address login throttle, and the bound that was quietly disabling it.
 *
 * The throttle keeps a map of address to failure count, and that map has to be
 * bounded: the key is the first entry of `X-Forwarded-For`, so an attacker
 * chooses it, and an unbounded map is a memory-exhaustion hole reachable by
 * anyone who can reach the login form.
 *
 * The bound was written as "once the map is full, stop recording", which also
 * stops recording for an address already *in* the map. So the sequence that
 * matters is: fill the map with throwaway values, then grind one account from
 * an address whose tally can no longer move. It sits below the limit forever
 * and is never locked out. The memory bound cancelled the throttle it was
 * protecting.
 *
 * These call the module directly rather than going through HTTP, which is the
 * exception in this suite and is deliberate: the flood is thousands of entries,
 * and every login attempt over HTTP costs a full Argon2id verify. The functions
 * touched here are pure in-memory bookkeeping and never open the database.
 */

/** Above MAX_TRACKED_IPS in auth.ts, so the map is genuinely at its ceiling. */
const FLOOD = 5_000;

function flood(count = FLOOD): void {
  for (let i = 0; i < count; i++) {
    recordIpFailure(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
  }
}

beforeEach(() => resetIpFailures());

describe("the per-address throttle", () => {
  test("locks out an address that passes the limit", () => {
    const attacker = "203.0.113.9";
    for (let i = 0; i < IP_FAILURE_LIMIT; i++) {
      expect(isIpLockedOut(attacker)).toBe(false);
      recordIpFailure(attacker);
    }
    expect(isIpLockedOut(attacker)).toBe(true);
  });

  test("still counts an address already tracked once the map is full", () => {
    /* The bypass, in the order an attacker would run it. */
    const attacker = "203.0.113.9";

    // Get on the board first, well under the limit.
    for (let i = 0; i < 5; i++) recordIpFailure(attacker);
    expect(isIpLockedOut(attacker)).toBe(false);

    // Fill the map with throwaway addresses, all inside their lockout window.
    flood();

    // Now grind. Ten times the limit went unrecorded before this was fixed.
    for (let i = 0; i < IP_FAILURE_LIMIT * 10; i++) recordIpFailure(attacker);

    expect(isIpLockedOut(attacker)).toBe(true);
  });

  test("an address that fills the map from scratch is still locked out", () => {
    /* The same attack without the head start: the attacker floods first and
       only then starts guessing, so their own address is not yet a key. */
    const attacker = "203.0.113.10";
    flood();
    for (let i = 0; i < IP_FAILURE_LIMIT * 10; i++) recordIpFailure(attacker);
    expect(isIpLockedOut(attacker)).toBe(true);
  });

  test("a flood does not lock out an address that has not failed", () => {
    // The bound must not turn into a way to lock the cohort out of their own
    // accounts by poisoning the map with their addresses' neighbours.
    flood();
    expect(isIpLockedOut("198.51.100.4")).toBe(false);
  });

  test("the map stays bounded, which is what the sweep is for", () => {
    /*
     * Counting every failure must not mean keeping every address. The key is
     * chosen by the caller, so without a ceiling this grows for as long as
     * somebody keeps inventing values: the memory-exhaustion hole the sweep
     * was added to close, and which the fix above must not have reopened.
     */
    flood(20_000);
    expect(trackedIpCount()).toBeLessThanOrEqual(5_000);
  });
});
