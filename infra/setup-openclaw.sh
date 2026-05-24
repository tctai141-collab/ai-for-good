#!/usr/bin/env bash
set -euxo pipefail

export DEBIAN_FRONTEND=noninteractive

OPENCLAW_PREFIX="/opt/openclaw"
OPENCLAW_STATE="$OPENCLAW_PREFIX/.openclaw"
OPENCLAW_PORT="__OPENCLAW_PORT__"
DEEPSEEK_API_KEY="__DEEPSEEK_API_KEY__"
OPENCLAW_GATEWAY_TOKEN="__OPENCLAW_GATEWAY_TOKEN__"

apt-get update -qq
apt-get install -y -qq build-essential curl git jq sqlite3

curl -fsSL https://openclaw.ai/install-cli.sh | bash -s -- --no-onboard --prefix "$OPENCLAW_PREFIX"

export PATH="$OPENCLAW_PREFIX/bin:$PATH"

mkdir -p "$OPENCLAW_STATE/workspace/memory/advisors"

cat > "$OPENCLAW_STATE/openclaw.json" <<CONFIG
{
  "agents": {
    "defaults": {
      "model": { "primary": "deepseek/deepseek-v4-pro" },
      "models": { "deepseek/deepseek-v4-pro": { "alias": "Founder" } },
      "workspace": "$OPENCLAW_STATE/workspace",
      "thinkingDefault": "off",
      "reasoningDefault": "off"
    },
    "list": [
      {
        "id": "founder",
        "identity": {
          "name": "Founder OS",
          "theme": "You are Founder OS: a seasoned founder coach for Aalto founders. You are not a generic AI assistant, therapist, motivational speaker, or onboarding bot. The program is currently Week 1 of 15: Orientation & Kick-off. Style: terse, calm, concrete. Default to 1 short paragraph under 80 words.",
          "emoji": "spark"
        }
      },
      {
        "id": "marten",
        "identity": {
          "name": "Marten Advisor",
          "theme": "You are Founder OS using the Marten Mickos advisor lens. Use local memory file advisor-marten-mickos.md as grounding when relevant. Practical operator judgment, servant leadership, open source company building, and direct responsibility. Do not pretend to be Marten.",
          "emoji": "M"
        }
      },
      {
        "id": "paul",
        "identity": {
          "name": "Paul Graham Advisor",
          "theme": "You are Founder OS using the Paul Graham advisor lens. Use local memory file advisor-paul-graham.md as grounding when relevant. Direct startup reasoning about users, growth, focus, fundraising, and avoiding fake progress. Do not pretend to be Paul Graham.",
          "emoji": "PG"
        }
      }
    ]
  },
  "models": {
    "providers": {
      "deepseek": {
        "baseUrl": "https://api.deepseek.com",
        "api": "openai-completions",
        "apiKey": "$DEEPSEEK_API_KEY",
        "models": [
          {
            "id": "deepseek-v4-pro",
            "name": "DeepSeek V4 Pro",
            "contextWindow": 1000000,
            "maxTokens": 220,
            "reasoning": false
          }
        ]
      }
    }
  },
  "gateway": {
    "mode": "local",
    "bind": "lan",
    "port": $OPENCLAW_PORT,
    "auth": { "tokens": ["$OPENCLAW_GATEWAY_TOKEN"] },
    "http": { "endpoints": { "chatCompletions": { "enabled": true } } }
  },
  "meta": {
    "provisionedBy": "ai-for-good/infra",
    "advisorMemoryPath": "$OPENCLAW_STATE/workspace/memory"
  }
}
CONFIG

cat > "$OPENCLAW_STATE/workspace/AGENTS.md" <<'AGENTS'
# Founder OS Workspace

This workspace backs Sprint Buddy advisor agents.

- `founder`: plain Founder OS coach
- `marten`: Founder OS with Marten Mickos advisor memory
- `paul`: Founder OS with Paul Graham advisor memory

Advisor materials live in `memory/`. Raw corpora can be copied into
`memory/advisors/` at runtime and then flattened/indexed.
AGENTS

cat > "$OPENCLAW_STATE/workspace/memory/decisions.md" <<'DECISIONS'
# Sprint Decisions Log

Track key decisions through the 15-week sprint. Keep raw founder reflections
private; store only decisions, themes, and follow-ups here.
DECISIONS

cat > "$OPENCLAW_STATE/workspace/memory/README.md" <<'MEMORY'
# OpenClaw Memory

Top-level `*.md` files are indexed by OpenClaw memory.

Known advisor files:
- `advisor-marten-mickos.md`
- `advisor-paul-graham.md`

Runtime corpus copy convention:
- `advisors/docs/advisors/*.txt`
MEMORY

if [ -f "$OPENCLAW_STATE/workspace/memory/advisors/docs/advisors/paul_graham_founder_notes.txt" ]; then
  cp "$OPENCLAW_STATE/workspace/memory/advisors/docs/advisors/paul_graham_founder_notes.txt" \
    "$OPENCLAW_STATE/workspace/memory/advisor-paul-graham.md"
fi

if [ -d "$OPENCLAW_STATE/workspace/memory/advisors/docs/advisors" ]; then
  cat "$OPENCLAW_STATE/workspace/memory/advisors/docs/advisors/marten_"*.txt 2>/dev/null \
    > "$OPENCLAW_STATE/workspace/memory/advisor-marten-mickos.md" || true
fi

env HOME="$OPENCLAW_PREFIX" OPENCLAW_CONFIG_PATH="$OPENCLAW_STATE/openclaw.json" \
  "$OPENCLAW_PREFIX/bin/openclaw" memory index --force || true

cat > /etc/systemd/system/openclaw-gateway.service <<SERVICE
[Unit]
Description=OpenClaw Gateway (Founder OS)
After=network.target

[Service]
Type=simple
ExecStart=$OPENCLAW_PREFIX/bin/openclaw gateway --bind lan --port $OPENCLAW_PORT
WorkingDirectory=$OPENCLAW_PREFIX
Environment=HOME=$OPENCLAW_PREFIX
Environment=OPENCLAW_CONFIG_PATH=$OPENCLAW_STATE/openclaw.json
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable openclaw-gateway
systemctl restart openclaw-gateway

echo "OpenClaw gateway provisioned."
echo "Gateway: http://<instance-ip>:$OPENCLAW_PORT"
