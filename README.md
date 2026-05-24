# Sprint Buddy — AI-for-Good Hackathon

**Track:** Founder OS — Aalto Founder Sprint
**Prize:** €1,000
**Duration:** 48 hours

An AI companion for Aalto Founder Sprint participants — a coach in their pocket available 24/7 throughout their 15-week journey. First advisor: Mårten Mickos (Head of Aalto Founder School, ex-CEO MySQL & HackerOne).

## Demo Logins

Use these accounts for the hackathon demo:

| Role | Email | Password | Notes |
|---|---|---|---|
| Founder | `founder1@sprint.test` | `founder123` | Default shared OpenClaw route |
| Founder | `founder2@sprint.test` | `founder123` | Founder-specific OpenClaw route when `OPENCLAW_URL_FOUNDER2` is set |
| Organizer | `organizer1@sprint.test` | `organizer123` | Coach/cohort view |

This is password-checked demo auth, not production authentication.

## Environment

Required for real AI replies:

```sh
OPENCLAW_URL=http://135.181.71.10:18789/v1/chat/completions
OPENCLAW_TOKEN=<openclaw-gateway-token>
```

Optional founder-specific routing:

```sh
OPENCLAW_URL_FOUNDER2=http://<founder2-openclaw-ip>:18789/v1/chat/completions
```

Optional persistence location:

```sh
DB_PATH=./data/sprint-buddy.db
```

The browser app does not silently fall back to canned AI replies. If OpenClaw is unavailable, chat shows an error so the demo does not accidentally pretend the live advisor is working.

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
