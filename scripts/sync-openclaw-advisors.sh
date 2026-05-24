#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 root@<openclaw-ip>" >&2
  exit 1
fi

target="$1"
remote_memory="/opt/openclaw/.openclaw/workspace/memory"
remote_advisors="$remote_memory/advisors"

tar -cz docs/advisors | ssh "$target" \
  "mkdir -p '$remote_advisors' && tar -xz -C '$remote_advisors'"

ssh "$target" "set -euo pipefail
if [ -f '$remote_advisors/docs/advisors/paul_graham_founder_notes.txt' ]; then
  cp '$remote_advisors/docs/advisors/paul_graham_founder_notes.txt' '$remote_memory/advisor-paul-graham.md'
fi
if [ -d '$remote_advisors/docs/advisors' ]; then
  cat '$remote_advisors/docs/advisors'/marten_*.txt > '$remote_memory/advisor-marten-mickos.md'
fi
env HOME=/opt/openclaw OPENCLAW_CONFIG_PATH=/opt/openclaw/.openclaw/openclaw.json \
  /opt/openclaw/bin/openclaw memory index --force
systemctl restart openclaw-gateway.service"
