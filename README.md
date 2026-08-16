# Sprint Buddy — AI-for-Good Hackathon

**Track:** Founder OS — Aalto Founder Sprint
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

## Demo Boundaries

- Organizer cohort rows are seeded demo data, with the live founder row partially driven by founder theme activity.
- The decision journal is real local persistence: decision-like founder messages are detected in chat and saved to SQLite.
- Production auth, aggregate-only organizer APIs, and database backups are still future work.
