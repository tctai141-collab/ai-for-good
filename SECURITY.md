# Security

## Reporting

Email **tai.tran@aalto.fi**. No bounty, no formal SLA, but it will be read and
acted on. Please don't test against real cohort accounts — the data is
students' private reflections. Describe it and we will reproduce it against a
scratch database. Also at `/.well-known/security.txt`.

## Pre-deploy checklist

Rerun before any release that touches auth, the persistence layer, the
middleware, or backups.

### Automated

```bash
bun install --frozen-lockfile
bun run typecheck
bun run build
bun test          # 296 as of 22 Aug 2026; never let this go down
bun audit         # 0 critical/high expected
```

`bun test` covers the security properties directly. If one of these fails, read
it before you change it — several encode a decision that is easy to reverse by
accident:

- sessions and invites are stored hashed, never raw
- a stolen hash is not a usable cookie
- signing in retires the previous session
- one address grinding many accounts is throttled
- cross-origin, missing-Origin, spoofed `X-Forwarded-Host`, and
  `Sec-Fetch-Site: cross-site` are all refused
- one founder cannot read, update or delete another's rows
- erasure empties all ten user-scoped tables
- an export contains no credentials and nobody else's data
- backups round-trip, and a tampered one fails loudly
- no secret and no retired persona reaches the client bundle

### By hand

- [ ] `git log -p` clean of secrets if history was rewritten
- [ ] `.env` not committed; `.env.example` has placeholders only
- [ ] Render env vars set: `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, R2 keys,
      `PUBLIC_BASE_URL`, `SENTRY_DSN`, optionally `BACKUP_ENCRYPTION_KEY`
- [ ] `PUBLIC_BASE_URL` matches the real hostname — the CSRF check pins to it,
      so a wrong value rejects every write
- [ ] R2 bucket private; credentials scoped to that bucket
- [ ] **Restore drill run since the last schema change** (`bun scripts/restore-db.ts`)
- [ ] Branch protection on `main` still requires `verify`, admins included

### After deploying

- [ ] `curl -I https://aaltofoundersprint.com` → HSTS, `X-Frame-Options`,
      `X-Content-Type-Options`, `Permissions-Policy`, CSP present
- [ ] `curl https://aaltofoundersprint.com/api/health` → `{"ok":true}` only
- [ ] Sign in, confirm the cookie is `Secure; HttpOnly; SameSite=Lax`
- [ ] `/api/admin/shared` returns 401 signed out

## Standing decisions

**Never push to `main`.** It auto-deploys in ~90s. Branch and PR, always.

**Never invent secrets.** Wire config and `.env.example` placeholders; list what
must be set in Render.

**No new runtime dependencies** without a stated exploit they close. Eight prod
deps today, four of them React.

**Ownership is enforced in the data layer**, not in routes. A new query touching
user-scoped rows takes the email and puts it in the `WHERE` — including
`UPDATE` and `DELETE`, which is the classic miss.

**Migrations run in ascending order.** `migrate()` bumps `user_version` to
whatever it just ran, so an out-of-order block permanently skips the ones below
it. This has happened once.

**The eval is the gate for prompt changes**, not taste. `bun scripts/eval.ts`,
and never let no-fabrication drop.
