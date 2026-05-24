#!/usr/bin/env bash
set -euxo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y -qq curl ca-certificates git unzip rsync

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | BUN_INSTALL=/opt/bun bash
  ln -sf /opt/bun/bin/bun /usr/local/bin/bun
  ln -sf /opt/bun/bin/bunx /usr/local/bin/bunx || true
fi

mkdir -p /opt/sprint-buddy /opt/sprint-buddy-data
chmod 755 /opt/sprint-buddy /opt/sprint-buddy-data

cat > /etc/systemd/system/sprint-buddy.service <<'SERVICE'
[Unit]
Description=Sprint Buddy Astro server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/sprint-buddy
Environment=HOST=0.0.0.0
Environment=PORT=3000
Environment=NODE_ENV=production
Environment=DB_PATH=/opt/sprint-buddy-data/sprint-buddy.db
Environment=SPRINT_WEEK=1
EnvironmentFile=-/etc/sprint-buddy.env
ExecStart=/usr/local/bin/bun ./dist/server/entry.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload

cat > /etc/sprint-buddy.env <<'ENV'
OPENCLAW_URL=http://replace-with-openclaw-ip:18789/v1/chat/completions
OPENCLAW_TOKEN=replace-with-openclaw-gateway-token
ENV
chmod 600 /etc/sprint-buddy.env

echo "Sprint Buddy app host prepared. Edit /etc/sprint-buddy.env, sync app files to /opt/sprint-buddy, run bun install && bunx astro build, then enable sprint-buddy.service."
