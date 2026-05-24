#!/usr/bin/env bash
set -euo pipefail

APP_HOST="${APP_HOST:-root@135.181.71.36}"
APP_DIR="${APP_DIR:-/opt/sprint-buddy}"
APP_URL="${APP_URL:-http://135.181.71.36:3000}"

if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is required" >&2
  exit 1
fi

echo "Deploying Sprint Buddy to ${APP_HOST}:${APP_DIR}"

rsync -az --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude dist \
  --exclude data/sprint-buddy.db \
  --exclude .env \
  ./ "${APP_HOST}:${APP_DIR}/"

ssh "${APP_HOST}" "
  set -euo pipefail
  cd '${APP_DIR}'
  bun install --frozen-lockfile
  bunx astro build
  systemctl enable sprint-buddy.service >/dev/null
  systemctl restart sprint-buddy.service
  systemctl is-active sprint-buddy.service
"

echo "Checking ${APP_URL}"
for _ in 1 2 3 4 5; do
  if curl -fsS "${APP_URL}/" >/dev/null; then
    break
  fi
  sleep 1
done
curl -fsS "${APP_URL}/" >/dev/null

tmp_cookie="$(mktemp)"
trap 'rm -f "${tmp_cookie}"' EXIT

curl -fsS -c "${tmp_cookie}" \
  "${APP_URL}/api/session" \
  -H 'Content-Type: application/json' \
  --data '{"email":"founder1@sprint.test","password":"founder123"}' >/dev/null

curl -fsS -b "${tmp_cookie}" \
  "${APP_URL}/api/persistence?resource=threads&user=founder1@sprint.test" >/dev/null

echo "Deploy complete: ${APP_URL}"
