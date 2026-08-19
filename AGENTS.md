# AI-for-Good — Sprint Buddy

**Stack:** Astro 6 (server output) + React 19 + TypeScript + Bun
**Runtime:** Bun only (no Node runtime commands, no nginx in containers)

## Commands

```sh
bun dev          # astro dev --host 0.0.0.0 (hot reload)
bunx astro build # server output → dist/
```

## Docker (user runs these, not the agent)

```sh
make build   # docker compose build
make up      # docker compose up -d  (port 3000)
make down    # docker compose down
make logs    # docker compose logs -f
make dev     # local dev server
make clean   # down + remove images
```

`Dockerfile` is multi-stage Alpine Bun (`oven/bun:1.3.14-alpine`).  
Builds with `bunx astro build`, serves `dist/server/entry.mjs` with `bun`.

## Structure

| Path | Purpose |
|---|---|
| `src/pages/` | Astro pages |
| `src/components/` | React components (`.tsx`) |
| `src/components/App.tsx` | Root app — login + mascot landing, then mounts SprintBuddy |
| `src/components/SprintBuddyCube.tsx` | 3D cube mascot (login + landing) |
| `src/components/SprintBuddy.tsx` | Founder + coach shell (sidebar, chat, reflections, cohort, founder card). Calls `/api/chat` |
| `src/pages/api/` | Astro API routes for session, persistence, and chat |
| `src/db/` | Bun SQLite schema and persistence helpers |
| `src/lib/sprint-context.ts` | Program context injected into Sprint Buddy prompts |
| `docs/` | Wiki index, product docs, design, ops, program, track |
| `docs/advisors/` | Processed advisor corpora for OpenClaw memory |
| `scripts/sync-openclaw-advisors.sh` | Sync `docs/advisors/` to OpenClaw and rebuild advisor memory |
| `agents/data/` | AI agent config (empty) |
| `data/sprint-buddy.db` | Local SQLite DB when running in development; do not commit generated DB files |

## Key constraints

- **`docs/advisors/` is part of the repo.** Keep only processed, clean advisor material there so the project is redeployable if a local laptop is lost.
- **`dist/` is gitignored** (build artifact). Don't commit it.
- **SQLite persistence exists.** Default DB path is `./data/sprint-buddy.db` locally and `/app/data/sprint-buddy.db` in production.
- **Demo login is hardcoded in `src/components/App.tsx`.** It is not production auth.
- **Session storage is prototype-grade.** `/api/session` stores a JSON cookie with `httpOnly: false` so the browser app can restore demo users.
- **Chat calls the Anthropic Messages API.** `src/lib/ai.ts` translates between it and the OpenAI-style SSE shape the browser still speaks. Config: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT`. The OpenClaw gateway this once used no longer exists.
- **Privacy-first** is the core UX constraint. `.impeccable.md` has design/brand context (Aalto palette, dark mode, Inter font).
- **No CI workflows, no linter/formatter config** exists yet.
- **`astro.config.mjs`:** `output: "server"`, `@astrojs/node` (standalone) + `@astrojs/react`.

## Verda deployment topology

- Use **one dedicated app VM** for the Astro/Bun web app.
- Use **separate OpenClaw VMs** for advisor/runtime isolation. The shared/default OpenClaw can serve most users; user-specific OpenClaws should get their own instances and be routed with env vars such as `OPENCLAW_URL_FOUNDER2`.
- Do not deploy the app onto an OpenClaw VM unless explicitly asked.
- Current app VM: `sprint-buddy-app` (`135.181.71.36`, `CPU.4V.16G`, port `3000`).
- The self-hosted gateway VM is retired; there is no host to reach.
- App service on the app VM is `sprint-buddy.service`, running from `/opt/sprint-buddy` with data at `/opt/sprint-buddy-data/sprint-buddy.db`.
- App bootstrap script lives at `scripts/verda-app-startup.sh`.

## What still needs wiring

- Replace hardcoded demo auth with the intended auth/session model, or explicitly keep demo auth for judging.
- Make OpenClaw/DeepSeek env requirements explicit in README and deployment docs.
- Wire real organizer cohort signals from aggregated founder data. Current coach/cohort data is mostly seeded/demo UI.
- Finish privacy boundaries: raw founder transcripts must never be exposed to organizer views; aggregate only named themes, mood, and attention signals.
- Keep RAG/advisor source files deployable from the repo. `docs/advisors/` is the only committed advisor corpus location.
- Add smoke tests or a minimal Bun test suite for API routes, persistence, and prompt/check-in behavior.
- Add production DB volume/backups for Docker or deployment target.

## Agent conventions

- Follow `CLAUDE.md` for Bun-first patterns (no express, no dotenv, no `pg`, etc.).
