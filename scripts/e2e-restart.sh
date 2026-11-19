#!/usr/bin/env bash
# End-to-end check: a stub saved through the UI survives a WireMock restart
# (the store is the source of truth) and the WireMock admin API stays locked.
# Uses compose.yaml (Redis) by default; scripts/e2e-sqlite.sh runs it on compose.sqlite.yaml
# and also recreates the UI container to prove the SQLite volume keeps the data.
set -euo pipefail

cd "$(dirname "$0")/.."

export WIREMOCK_PORT="${WIREMOCK_PORT:-8080}"
export UI_PORT="${UI_PORT:-3000}"
COMPOSE_FILE="${E2E_COMPOSE_FILE:-compose.yaml}"
PROJECT="${E2E_PROJECT:-wiremock-ui-e2e}"
compose() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"; }

CREATED_ENV=0
if [ ! -f .env ]; then
  cp .env.example .env
  CREATED_ENV=1
fi

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then compose logs --tail 40 || true; fi
  compose down -v >/dev/null 2>&1 || true
  if [ "$CREATED_ENV" -eq 1 ]; then rm -f .env; fi
  exit "$status"
}
trap cleanup EXIT

set -a
# shellcheck disable=SC1091
. ./.env
set +a

UI="http://localhost:${UI_PORT}"
WM="http://localhost:${WIREMOCK_PORT}"

compose up -d --build

wait_healthy() {
  echo "Waiting for the UI health check..."
  ok=0
  for _ in $(seq 1 60); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "$UI/healthz" || true)" = "200" ]; then ok=1; break; fi
    sleep 1
  done
  [ "$ok" -eq 1 ] || { echo "FAIL: /healthz did not return 200 within 60s"; exit 1; }
}
wait_healthy

echo "Creating a stub through the UI API..."
code=$(curl -s -o /dev/null -w '%{http_code}' -u "$ADMIN_USER:$ADMIN_PASSWORD" \
  -H 'Content-Type: application/json' -X POST "$UI/api/mocks" \
  -d '{"request":{"method":"GET","urlPath":"/e2e/ping"},"response":{"status":200,"headers":{"Content-Type":"application/json"},"body":"{\"ok\":true}"}}')
case "$code" in 2??) ;; *) echo "FAIL: POST /api/mocks returned $code"; exit 1 ;; esac

[ "$(curl -s "$WM/e2e/ping")" = '{"ok":true}' ] || { echo "FAIL: stub not served by WireMock"; exit 1; }

echo "Restarting WireMock..."
compose restart wiremock

ok=0
for _ in $(seq 1 30); do
  if [ "$(curl -s "$WM/e2e/ping" || true)" = '{"ok":true}' ]; then ok=1; break; fi
  sleep 1
done
[ "$ok" -eq 1 ] || { echo "FAIL: stub did not come back after the WireMock restart within 30s"; exit 1; }

code=$(curl -s -o /dev/null -w '%{http_code}' "$WM/__admin/mappings")
[ "$code" = "401" ] || { echo "FAIL: /__admin/mappings returned $code, expected 401"; exit 1; }

if [ "${E2E_RESTART_UI:-0}" = "1" ]; then
  echo "Recreating the UI container (only the volume keeps its data)..."
  compose up -d --force-recreate --no-deps ui
  wait_healthy
  curl -s -u "$ADMIN_USER:$ADMIN_PASSWORD" "$UI/api/mocks" | grep -q '/e2e/ping' \
    || { echo "FAIL: stub missing from /api/mocks after recreating the UI"; exit 1; }
fi

echo "E2E OK"
