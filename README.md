# Sprint Buddy — AI-for-Good Hackathon

**Track:** Aalto Founder Sprint
**Prize:** €1,000
**Duration:** 48 hours

An AI companion for Aalto Founder Sprint participants — a coach in their pocket available 24/7 throughout their 15-week journey. First advisor: Mårten Mickos (Head of Aalto Founder School, ex-CEO MySQL & HackerOne).

## Accounts

There are no shared or default logins. Every account is created by an organizer
and activated by its owner through a single-use setup link.

**First run on a fresh database** — create the first organizer from the command
line, because the admin page needs an organizer to sign in:

```sh
bun scripts/create-organizer.ts you@example.com "Your Name" https://your-domain
```

That prints a `/setup?token=…` link. Open it, choose a password, then sign in
and use **/admin** to add the rest of the operating team and the cohort. Each
person added there gets their own single-use link, valid for 14 days, which you
send them over whatever channel you already use. The same button issues a fresh
link if someone forgets their password.

Passwords are hashed with Argon2id and never leave the server. Sessions are
random opaque tokens checked against the database, so a client cannot forge a
role, and removing someone revokes their access immediately.

## Removing someone

Removing an account from `/admin` deletes it and everything belonging to it —
conversations, messages, check-ins, decisions, visit counts and Working Genius
results — in a single transaction. That is the GDPR erasure path, and it is
covered by a test that seeds a row in every child table first.

## Operations

- `docs/operations/deploy.md` — first deploy, start to finish
- `docs/operations/backups.md` — automated backups, and the restore drill

## Privacy

Founders' conversations are private. Organizers see themes, attention signals
and decisions — never the transcript — unless a founder explicitly shares a
specific conversation, which they can withdraw at any time. This is enforced in
`src/pages/api/persistence.ts`, not merely stated.

## Environment

Required for AI replies — get a key at
[console.anthropic.com](https://console.anthropic.com):

```sh
ANTHROPIC_API_KEY=<your-anthropic-api-key>
```

Required in any deployment behind a domain or proxy, so setup links point at
the right host rather than localhost:

```sh
PUBLIC_BASE_URL=https://your-domain
```

Optional:

```sh
DB_PATH=./data/sprint-buddy.db   # where SQLite stores everything
SPRINT_WEEK=1                    # 1-15, drives the schedule context in prompts
ANTHROPIC_MODEL=claude-opus-5    # advisor model
ANTHROPIC_EFFORT=low             # low | medium | high
```

See `.env.example` for the full list.

The app never falls back to canned AI replies. If the advisor cannot be
reached, chat says so rather than pretending to work.

## Project Structure

```
docs/
├── track/          — Hackathon challenge, judging criteria, schedule
├── advisors/       — Processed advisor memory materials
├── program/        — Aalto Founder Sprint S26 program structure
└── design/         — Architecture & UX design docs
data/               — Data files
src/                — Sprint Buddy source code
agents/             — AI agent configuration
```

## Building Sprint Buddy

1. **Mårten advisor** — RAG-powered conversational AI from his materials
2. **Daily check-ins** — 2-3 reflective questions, pattern detection over time
3. **Founder profiling** (stretch) — Working Genius assessment
4. **Organizer signal** (stretch) — Weekly attention-need flags, human-in-the-loop

### Key constraint
Privacy-first. If founders feel monitored, they perform instead of reflect.

## What is and isn't real

Everything the operating team sees is derived from real founder activity. The
hackathon build seeded the organizer view with eight fictional founders and the
Reflections page with three invented themes; both are gone.

- **Cohort dashboard** — real. Built from actual check-in signals: per-week
  attention score, dominant theme, trend, days since last check-in, open
  decision count. Founders with no history show as having no history.
- **Reflections themes** — real, derived from the founder's own threads,
  decisions and check-ins. Empty until they have some.
- **Decision journal** — real. Decision-like messages are detected in chat and
  saved to SQLite. Detection is a regex heuristic, so it both misses and
  over-fires; treat it as a prompt, not a record.
- **Check-in score** — real, produced by the advisor at the end of a check-in.
  If the model omits it the check-in is still recorded, unscored, rather than
  silently dropped.

**Authentication, aggregate-only organizer APIs and database backups are all
built.** See `docs/operations/backups.md` for the backup and restore procedure —
it is automated daily to Cloudflare R2, and the restore drill is part of the
test suite.

Known gaps, deliberately: no email nudges or reminders, no deadline/task
tracking (a separate work package), no multi-cohort support, and migrations are
versioned but have no rollback path.
