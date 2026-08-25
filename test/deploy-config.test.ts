import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { configuredAppUrl } from "../src/lib/appUrl";

/**
 * The blueprint has to declare the things the app now refuses to guess.
 *
 * PUBLIC_BASE_URL used to be `sync: false` — dashboard-only, with a comment
 * saying to fill it in after the first deploy. That is the wrong setting for a
 * public URL: it is not a secret, and the only thing dashboard-only bought was
 * the chance of it being unset.
 *
 * It stopped being cosmetic when setup links stopped falling back to the
 * request's Host header. Invite and reset emails are built from this value and
 * nothing else, so a deploy that comes up without it cannot add a founder.
 */

const blueprint = readFileSync("render.yaml", "utf-8");

/** The env block, as key → declaration. */
function envVars(): Map<string, string> {
  const out = new Map<string, string>();
  const lines = blueprint.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const key = lines[i]!.match(/^\s*- key:\s*(\S+)\s*$/);
    if (!key) continue;
    out.set(key[1]!, (lines[i + 1] ?? "").trim());
  }
  return out;
}

describe("render.yaml", () => {
  test("declares the public URL as a value, not a dashboard blank", () => {
    const declared = envVars().get("PUBLIC_BASE_URL");
    expect(declared).toBeDefined();
    expect(declared).not.toBe("sync: false");
    expect(declared).toMatch(/^value:\s*https:\/\/\S+$/);
  });

  test("the declared URL is one the app would accept", () => {
    // Same parser the runtime uses, so a typo here fails now rather than at
    // the moment somebody tries to add a founder.
    const declared = envVars().get("PUBLIC_BASE_URL")!.replace(/^value:\s*/, "");
    const before = process.env.PUBLIC_BASE_URL;
    try {
      process.env.PUBLIC_BASE_URL = declared;
      expect(configuredAppUrl()).toBe(declared.replace(/\/+$/, ""));
    } finally {
      if (before === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = before;
    }
  });

  test("declares every variable the code reads that has no safe default", () => {
    /*
     * BACKUP_ENCRYPTION_KEY was read by src/lib/backup.ts and by the restore
     * script, and declared nowhere. Undeclared means a blueprint rebuild never
     * prompts for it, and unset the backup is written in the clear — the whole
     * database, password hashes and thirty days of private conversations, into
     * object storage whose credentials *are* declared two lines above.
     */
    const env = envVars();
    for (const key of ["BACKUP_ENCRYPTION_KEY", "R2_BUCKET", "RESEND_API_KEY", "ANTHROPIC_API_KEY"]) {
      expect(env.has(key)).toBe(true);
    }
  });

  test("real secrets stay out of the file", () => {
    // The rule this sits next to: a public address is declared, a credential
    // never is.
    const env = envVars();
    for (const secret of ["ANTHROPIC_API_KEY", "RESEND_API_KEY", "BACKUP_ENCRYPTION_KEY"]) {
      if (!env.has(secret)) continue;
      expect(env.get(secret)).toBe("sync: false");
    }
    expect(blueprint).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/);
    expect(blueprint).not.toMatch(/re_[A-Za-z0-9_-]{16,}/);
  });
});
