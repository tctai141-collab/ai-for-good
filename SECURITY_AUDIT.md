# Security audit — 22 August 2026

Application security review of Sprint Buddy before the F26 cohort starts on
8 September. Threat model throughout: **an attacker who already holds a valid
low-privilege account**, which for two dozen known users is the realistic one.

Baseline at start: **254 tests passing**. At finish: **296**, none removed.

---

## Nothing had to be rotated

All four Critical categories came back clean, which is worth stating plainly
because it is the part that would have needed action before anything else.

| Check | Result |
|---|---|
| Leaked secret | **None.** All 61 commits scanned with `git log -p --all`; every env assignment ever committed is a placeholder. No key needs rotating. |
| SQL injection | **None.** Every interpolation site takes developer constants — migration table names, a `Number()`-coerced version, a server-generated path. None reachable from user input. |
| Auth bypass | **None.** Idle and absolute deadlines enforced per request, dummy Argon2id verify on unknown accounts, 256-bit CSPRNG tokens. |
| Ownership bypass | **None.** `assertOwner()` guards the destructive message delete; the thread UPSERT carries `WHERE threads.user_email`; cross-references validated through `ownerOf()`. |

Two things the brief anticipated that turned out already sound:

- **No XSS.** `formatMarkdown` escapes `&<>` *before* applying markdown and
  emits a fixed tag set with no `href` handling, so the
  `dangerouslySetInnerHTML` sink cannot be driven.
- **Argon2id at m=65536, t=2, p=1** — 3.4× the OWASP memory minimum, from Bun's
  defaults. Left implicit deliberately: pinning the numbers here would freeze
  them at today's values and stop us inheriting Bun's future increases.

---

## Findings and what changed

| # | Sev | Before | After |
|---|---|---|---|
| H1 | High | Session tokens stored **raw**; a leaked backup was a live credential for every signed-in user | SHA-256 at rest, lookup by hash (`db/index.ts`) |
| H1b | High | Invite/reset tokens stored raw — worse, since a setup link *claims* an account | Same treatment; `InviteRow` no longer even carries the value |
| H2 | High | Backups gzip-only: password hashes + every private conversation, 30 days in object storage | Optional AES-256-GCM before upload, **off by default** (see below) |
| H3 | High | No per-IP limiting anywhere. 24 known addresses × 10 tries = 240 guesses, no block | Per-IP throttle on the real client IP, alongside the per-email one |
| M1 | Medium | CSRF added the request's own `X-Forwarded-Host`/`Host` to the allow-set even when configured — a circular check | Pinned to `PUBLIC_BASE_URL` when set; `Sec-Fetch-Site: cross-site` refused outright |
| M2 | Medium | Cookie `Secure` inferred from `x-forwarded-proto`; one missing header silently downgraded it | Forced in production; header check retained for local http |
| M3 | Medium | 2 moderate Astro advisories | Assessed as **not reachable** — see residual risks |
| M5 | Medium | No `Permissions-Policy`; HSTS lacked `includeSubDomains`/`preload` | Both added |
| M6 | Medium | No data export; deletion was organizer-only | `GET /api/account` export, `POST` self-erasure |
| M7 | Medium | No `PRIVACY.md`, `SECURITY.md`, `security.txt` | All three written |
| P6 | Medium | Prompt never framed pack or user text as data | Explicit injection framing added |
| L1 | Low | 896 chars of the retired fabricated-founder persona shipped in the public bundle | Removed; a test now fails if it returns |
| L2 | Low | Signing in left the previous session row live | Retired on sign-in |
| L3 | Low | CI actions pinned by tag; token writable; no Dependabot | Pinned by SHA, `permissions: contents: read`, Dependabot added |
| L4 | Low | Health probe pointed at `/api/session`, the auth endpoint | Dedicated `/api/health` that reveals nothing |

### One bug I introduced and caught

Placing the new migration before migration 2 in the file would have made a v1
database jump straight to `user_version = 3` and **skip migration 2 forever**,
because `migrate()` bumps to whatever version it just ran. Reordered, with an
assertion that the sequence is ascending. Worth recording because it is exactly
the half-applied-schema failure the review was looking for, and it came from the
review itself.

---

## Files changed

| File | Why |
|---|---|
| `src/db/index.ts` | `hashToken()`; sessions and invites hashed at rest; `InviteRow.token` removed |
| `src/db/schema.ts` | `token_hash` columns; migration 3 renames and clears both tables |
| `src/lib/auth.ts` | Per-IP throttle, `clientIp()`, `wantsSecureCookie()`, previous session retired on sign-in |
| `src/lib/origin.ts` | **New.** The origin check, extracted from middleware so it can be tested at all |
| `src/middleware.ts` | Imports the extracted check; `Permissions-Policy`; fuller HSTS |
| `src/lib/personas.ts` | Prompt-injection framing |
| `src/lib/backup.ts` | `maybeEncrypt()` / `decryptBackup()`; retention sweep sees both file shapes |
| `scripts/restore-db.ts` | Decrypts when the marker is present |
| `src/pages/api/session.ts` | Login wired to both throttles |
| `src/pages/api/account.ts` | **New.** Export and self-erasure |
| `src/pages/api/health.ts` | **New.** Probe target |
| `src/components/SprintBuddy.tsx` | `FOUNDER_CORPUS` removed |
| `render.yaml` | Health check repointed |
| `.github/workflows/ci.yml` | SHA pins, least-privilege token |
| `.github/dependabot.yml`, `public/.well-known/security.txt` | **New.** |
| `test/*` | 42 new assertions across 5 new files |

---

## What you must do

**Nothing needs rotating.** These are the actions the code cannot take.

1. **Everyone gets signed out once** when this deploys. Migration 3 clears the
   sessions table because the rows hold raw tokens; hashing them in place would
   have preserved exactly the credentials that may already sit in a backup.
   Un-redeemed invite links also stop working and need re-sending.
2. **Decide on `BACKUP_ENCRYPTION_KEY`** (see below).
3. **Check the Anthropic retention tier** in the console and complete the one
   marked line in `PRIVACY.md`. I cannot see this setting.
4. **Confirm the R2 bucket is private** and its credentials are scoped to that
   bucket alone. Not visible from the code.
5. **Run a restore drill**: `bun scripts/restore-db.ts`. Never verified against
   a real snapshot, and an untested backup is a hope.

---

## The backup encryption decision

Built, tested, and **off**. With `BACKUP_ENCRYPTION_KEY` unset, behaviour is
byte-for-byte what it was.

I did not enable it, because doing so silently would create a way to lose all
your data: **lose that key and every snapshot is unrecoverable.** That is a
worse outcome than the risk it closes, and it is not my call to make on your
behalf.

My recommendation is still to turn it on. The payload is students' private
reflections plus password hashes, and thirty days of unencrypted copies in
object storage is the highest-consequence item in this audit. If you do:

```
openssl rand -base64 48
```

Set it in Render **and keep a copy somewhere that is not Render** — a password
manager is fine. Then run a restore drill immediately, before you rely on it.

---

## Residual risks, and why they stand

**`'unsafe-inline'` in the CSP.** Required by Astro's inline module scripts, the
590-line inline admin script, and React's inline styles. The policy is a
backstop, not an XSS defence — `frame-ancestors`, `object-src`, `base-uri` and
`form-action` all hold. Nonce-based CSP is the real fix and is a day of work on
the admin page alone; deferred rather than dismissed.

**Two moderate Astro advisories, unpatched.** Both need Astro 7, a major bump.
I checked whether they apply rather than upgrading reflexively:

- *XSS via spread attribute names* — needs `{...spread}` in a `.astro` file. There are none.
- *XSS via `transition:*` directives* / *View Transition animation properties* — need View Transitions. Not used; every `transition:` in the tree is a CSS property.

Not reachable here. **Re-evaluate the moment anyone adopts View Transitions or
spread attributes**, and take the upgrade then, on purpose.

**Deleted conversations persist in backups for up to 30 days.** Inherent to
having backups. Stated in `PRIVACY.md` rather than papered over.

**Check-in summaries survive conversation deletion.** A deliberate product
decision — they carry the strain signal the cohort dashboard runs on. It does
mean a founder's words outlive a deletion they may believe was total. The
cheap fix, if you want it, is blanking the text and keeping mood and theme.

**In-memory rate limits reset on deploy.** Correct for one instance and two
dozen users; revisit if it ever runs more than one.

**Trust in `X-Forwarded-*`.** Sound only because nothing reaches the process
except through Render. Documented at `clientIp()`. Direct container access
would defeat this and much else besides.
