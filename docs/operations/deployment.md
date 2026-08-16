# Deployment

> **⚠️ This document describes the retired hackathon infrastructure and is kept
> for reference only. Do not follow it.**
>
> The OpenClaw advisor gateway it depends on no longer exists; the advisor now
> calls the Anthropic API directly (`src/lib/ai.ts`). The demo logins below have
> also been removed — accounts are created by an organizer and activated through
> a single-use setup link.
>
> See the README for how accounts and environment variables actually work. A
> replacement deployment guide is still to be written.

This repo deploys as a small distributed system:

- one **app VM** for the Astro/Bun web app
- one or more **OpenClaw VMs** for advisor agents
- optional future **Telegram/voice integrations handled inside OpenClaw agents**

Do not put the app on an OpenClaw VM unless the user explicitly asks for a throwaway demo. The intended production shape is one app instance plus isolated OpenClaw instances for shared or founder-specific advisor memory.

## Current Verda Inventory

As of 2026-05-23:

| Role | Hostname | IP | Service | Port |
|---|---|---:|---|---:|
| App | `sprint-buddy-app` | `135.181.71.36` | `sprint-buddy.service` | `3000` |
| Shared OpenClaw | `founder-os-openclaw` | `135.181.71.10` | `openclaw-gateway.service` | `18789` |

The app runs from `/opt/sprint-buddy`. Persistent SQLite data lives in `/opt/sprint-buddy-data/sprint-buddy.db`.

## Quick Deploy Existing App VM

For the current `sprint-buddy-app` VM, run this from the repo root:

```sh
scripts/deploy-app.sh
```

The script:

- syncs the repo to `root@135.181.71.36:/opt/sprint-buddy`
- excludes `.env`, `.git`, `node_modules`, `dist`, and the local SQLite DB
- runs `bun install --frozen-lockfile`
- runs `bunx astro build`
- restarts `sprint-buddy.service`
- checks the homepage and authenticated persistence endpoint

Override the target when needed:

```sh
APP_HOST=root@<app-ip> \
APP_DIR=/opt/sprint-buddy \
APP_URL=http://<app-ip>:3000 \
scripts/deploy-app.sh
```

Manual equivalent:

```sh
rsync -az --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude dist \
  --exclude data/sprint-buddy.db \
  --exclude .env \
  ./ root@135.181.71.36:/opt/sprint-buddy/

ssh root@135.181.71.36 '
  cd /opt/sprint-buddy &&
  bun install --frozen-lockfile &&
  bunx astro build &&
  systemctl enable sprint-buddy.service &&
  systemctl restart sprint-buddy.service &&
  systemctl is-active sprint-buddy.service
'
```

## Required Local Tools

- `bun`
- `verda`, authenticated locally
- `ssh` access to Verda VMs
- `rsync`
- `terraform`, only if provisioning OpenClaw VMs through `infra/`

Use Bun commands only. Do not use Node runtime commands for this repo.

## App VM

### Create an app startup script

The app bootstrap script is checked in at:

```sh
scripts/verda-app-startup.sh
```

Register it with Verda:

```sh
verda startup-script add \
  --agent \
  --output json \
  --name sprint-buddy-app-bootstrap \
  --file ./scripts/verda-app-startup.sh
```

Keep the returned startup script ID.

### Create the app VM

Use a CPU instance. `CPU.4V.16G` is enough for the Astro app and SQLite.

```sh
verda vm create \
  --agent \
  --output json \
  --kind cpu \
  --instance-type CPU.4V.16G \
  --location FIN-01 \
  --os ubuntu-24.04 \
  --os-volume-size 50 \
  --hostname sprint-buddy-app \
  --description sprint-buddy-app \
  --ssh-key <verda-ssh-key-id> \
  --startup-script <startup-script-id> \
  --contract pay_as_go \
  --wait
```

### Sync and build the app

From the repo root:

```sh
rsync -az \
  --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude dist \
  --exclude data/sprint-buddy.db \
  --exclude .env \
  ./ root@<app-ip>:/opt/sprint-buddy/
```

Then on the app VM:

```sh
cd /opt/sprint-buddy
bun install --frozen-lockfile
bunx astro build
systemctl enable sprint-buddy.service
systemctl restart sprint-buddy.service
```

Check it:

```sh
systemctl is-active sprint-buddy.service
curl -i http://127.0.0.1:3000/api/session
curl -i http://<app-ip>:3000/
```

## App Environment

The app service must define:

```ini
Environment=HOST=0.0.0.0
Environment=PORT=3000
Environment=NODE_ENV=production
Environment=DB_PATH=/opt/sprint-buddy-data/sprint-buddy.db
Environment=SPRINT_WEEK=1
EnvironmentFile=-/etc/sprint-buddy.env
```

`/etc/sprint-buddy.env` should contain deployment-specific secrets:

```ini
OPENCLAW_URL=http://<shared-openclaw-ip>:18789/v1/chat/completions
OPENCLAW_TOKEN=<gateway-token>
SPRINT_WEEK=1
```

Founder-specific OpenClaw routing is done with additional env vars consumed by `src/pages/api/founder-os/chat.ts`:

```ini
OPENCLAW_URL_FOUNDER2=http://<founder2-openclaw-ip>:18789/v1/chat/completions
```

When adding more founder-specific instances, extend `FOUNDER_OPENCLAW_URLS` in `src/pages/api/founder-os/chat.ts` and add a matching env var.

The web app talks to OpenClaw through `/api/founder-os/chat`. DeepSeek credentials belong on OpenClaw VMs, not on the app VM.

`SPRINT_WEEK` controls the schedule context injected into Founder OS and check-in prompts. Set it to `1` through `15` as the sprint progresses so OpenClaw nudges founders about the right sessions and milestones.

## OpenClaw VMs

OpenClaw VMs are provisioned through `infra/`. The Terraform flow renders `infra/setup-openclaw.sh`, registers it as a Verda startup script, and creates one VM per `openclaw_instances` entry.

### Configure instances

```sh
cd infra
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:

```hcl
openclaw_instances = {
  default = {
    name           = "founder-os-openclaw"
    description    = "shared Founder OS OpenClaw instance"
    founder_email  = "*"
    ssh_key_ids    = ["<verda-ssh-key-id>"]
    openclaw_port  = 18789
  }

  founder2 = {
    name           = "founder2-openclaw"
    description    = "Founder OS OpenClaw instance for founder2@sprint.test"
    founder_email  = "founder2@sprint.test"
    ssh_key_ids    = ["<verda-ssh-key-id>"]
    openclaw_port  = 18789
  }
}

openclaw_gateway_token = "<gateway-token>"
deepseek_api_key       = "<deepseek-key>"
```

Apply:

```sh
terraform init
terraform apply
```

Record each output IP and set the matching app env vars.

### OpenClaw Roles And Prompts

`infra/setup-openclaw.sh` writes `/opt/openclaw/.openclaw/openclaw.json` with three agents:

| Agent ID | Role | Intended use |
|---|---|---|
| `founder` | Founder OS coach | Default calm founder operator voice |
| `marten` | Mårten advisor lens | Servant leadership, open-source company building, practical operator judgment |
| `paul` | Paul Graham advisor lens | Users, growth, focus, fundraising, fake progress detection |

The current app maps personas to OpenClaw model IDs:

```ts
none: "openclaw/founder"
marten: "openclaw/marten"
paul: "openclaw/paul"
```

Prompt rules that must remain true:

- Never introduce as a newly created AI assistant.
- Never claim raw founder transcripts are visible to organizers.
- Keep replies short by default.
- For panic posture, slow the founder down and give exactly one next action.
- For check-ins, use sprint context and prior check-in summaries, not invented program state.
- For completed check-ins, emit both `[CHECKIN_SUMMARY]` and `[CHECKIN_SIGNAL]`. The signal JSON score is an organizer attention score from `0` to `100`, where `0-39` is stable, `40-69` is monitor, and `70-100` is needs attention.
- Do not pretend to literally be Mårten Mickos or Paul Graham when operating as an advisor lens in OpenClaw memory. The UI prompt currently uses stronger persona language; preserve product behavior unless intentionally changing it.

## Advisor Memory

`docs/advisors/` is the single committed advisor corpus location. It should contain only processed, submission-safe text. Do not add raw scrape dumps, binary source documents, secrets, or private founder transcripts.

After an OpenClaw VM is running, copy memory files from the cloned repo:

```sh
scripts/sync-openclaw-advisors.sh root@<openclaw-ip>
```

## Embeddings, TTS, And Telegram Readiness

Telegram is owned by the OpenClaw agents, not by the Astro app. Do not add an app-side Telegram bot worker unless the product architecture changes. The app remains the browser surface and SQLite-backed web persistence layer; OpenClaw owns Telegram conversations, agent memory, voice/TTS behavior, and channel-specific integrations.

### Recommended OpenClaw-side services

| Service | Runs where | Purpose |
|---|---|---|
| Telegram integration | OpenClaw VM | Receives Telegram messages and routes them to the correct founder/advisor agent |
| TTS integration | OpenClaw VM or separate voice VM called by OpenClaw | Converts selected agent replies to voice notes |
| Embedding/index worker | OpenClaw VM or separate memory VM called by OpenClaw | Builds and refreshes advisor/founder-safe memory indexes |

Keep raw Telegram messages and founder transcripts inside the OpenClaw/founder-private boundary. Organizer-facing surfaces should receive only aggregate themes, mood, decisions, and attention signals.

### Environment placeholders

When Telegram is enabled on an OpenClaw VM, configure it on the OpenClaw side with env vars like:

```ini
Environment=TELEGRAM_BOT_TOKEN=<telegram-token>
Environment=TELEGRAM_WEBHOOK_SECRET=<random-secret>
Environment=TELEGRAM_ALLOWED_FOUNDER_MAP=/opt/openclaw/.openclaw/workspace/memory/telegram-founders.json
```

For OpenClaw-side TTS:

```ini
Environment=TTS_PROVIDER=<provider-name>
Environment=TTS_MODEL=<model-id>
Environment=TTS_VOICE_FOUNDER=<voice-id>
Environment=TTS_VOICE_MARTEN=<voice-id>
Environment=TTS_VOICE_PAUL=<voice-id>
```

For future embeddings:

```ini
Environment=EMBEDDINGS_PROVIDER=<provider-name>
Environment=EMBEDDINGS_MODEL=<model-id>
Environment=EMBEDDINGS_DIMENSIONS=<dimension-count>
Environment=VECTOR_STORE_PATH=/opt/openclaw/.openclaw/workspace/memory/vector
```

Do not hardcode provider keys in scripts. Put them in systemd environment files or a secret manager.

### Suggested Telegram flow

1. Telegram sends a webhook to the OpenClaw Telegram integration.
2. OpenClaw maps Telegram user ID to a founder email or founder-scoped workspace.
3. OpenClaw routes the message to the correct agent: `founder`, `marten`, or `paul`.
4. OpenClaw stores channel memory under its private workspace and never exposes raw Telegram transcripts to organizer views.
5. OpenClaw optionally calls TTS for voice note output.
6. OpenClaw sends text and/or audio back to Telegram.

If Telegram-derived aggregate signals need to appear in the web app later, add a narrow aggregate-only sync endpoint. Do not sync raw Telegram transcripts into the organizer surface.

## Verification

App:

```sh
curl -i http://<app-ip>:3000/
curl -i http://<app-ip>:3000/api/session
```

Founder OS chat:

```sh
curl -i -c /tmp/sprint-buddy.cookies \
  http://<app-ip>:3000/api/session \
  -H 'Content-Type: application/json' \
  --data '{"email":"founder1@sprint.test","password":"founder123"}'

curl -i -b /tmp/sprint-buddy.cookies \
  http://<app-ip>:3000/api/founder-os/chat \
  -H 'Content-Type: application/json' \
  --data '{
    "messages": [
      { "role": "user", "content": "I am worried about runway. What should I do tonight?" }
    ],
    "posture": "panic",
    "personality": "none",
    "stream": false,
    "userEmail": "founder1@sprint.test"
  }'
```

Persistence API:

```sh
curl -i http://<app-ip>:3000/api/persistence?resource=threads\&user=founder1@sprint.test

curl -i -b /tmp/sprint-buddy.cookies \
  http://<app-ip>:3000/api/persistence?resource=threads\&user=founder1@sprint.test
```

The first request should return `401`; the second should return the founder's threads. Founder sessions may only access their own records. Organizer demo sessions can access founder records for the coach view.

OpenClaw direct:

```sh
curl -i http://<openclaw-ip>:18789/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <gateway-token>' \
  --data '{
    "model": "openclaw/founder",
    "messages": [
      { "role": "user", "content": "Give me one next step." }
    ],
    "stream": false
  }'
```

Systemd logs:

```sh
journalctl -u sprint-buddy.service -n 100 --no-pager
journalctl -u openclaw-gateway.service -n 100 --no-pager
```

## Common Failure Modes

- **Chat returns an OpenClaw error:** `/api/founder-os/chat` could not reach OpenClaw. Check `OPENCLAW_URL`, `OPENCLAW_TOKEN`, OpenClaw service status, and network access. The browser app no longer falls back to mock replies.
- **Chat or persistence returns `401`:** log in through `/api/session` first. The app now requires the password-created `session_user` cookie for `/api/founder-os/chat` and `/api/persistence`.
- **Persistence returns `403`:** a founder session is trying to access another founder's records. Use the matching founder account or an organizer demo account.
- **Founder-specific routing does not work:** add the founder env var and extend `FOUNDER_OPENCLAW_URLS` in `src/pages/api/founder-os/chat.ts`.
- **OpenClaw has no advisor memory:** copy `docs/advisors/` materials after VM creation, then run `openclaw memory index --force`.
- **SQLite is empty after redeploy:** verify `DB_PATH` points to `/opt/sprint-buddy-data/sprint-buddy.db`, not inside the synced app directory.
- **Cloud-init fails on CPU VMs with `nvidia-smi`:** the Verda image may run a default GPU check. SSH in and run `scripts/verda-app-startup.sh` steps manually; the app does not need a GPU.
