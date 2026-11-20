#!/usr/bin/env bash
# WireMock-only mode (STORE_DRIVER=none) end to end: a WireMock that already has stubs, the built UI
# pointed at it with no store. The UI must list WireMock's stubs, an edit must reach WireMock, and
# nothing may be deleted or added behind the user's back (no marker, no sync), also across a UI restart.
# Needs Docker and a build (`npm run build`). Ports: E2E_NONE_UI_PORT (3480), E2E_NONE_WM_PORT (3481).
set -euo pipefail

cd "$(dirname "$0")/.."

UI_PORT="${E2E_NONE_UI_PORT:-3480}"
WM_PORT="${E2E_NONE_WM_PORT:-3481}"
UI="http://127.0.0.1:${UI_PORT}"
WM="http://127.0.0.1:${WM_PORT}"
WM_USER=wmadmin
WM_PASS=e2e-wiremock-password
ADMIN_USER=admin
ADMIN_PASS=e2e-admin-password
CONTAINER="wmui-e2e-none-$$"
APP_PID=""
APP_LOG="$(mktemp -t wmui-e2e-none.XXXXXX)"
COOKIES="$(mktemp -t wmui-e2e-none-cookies.XXXXXX)"

[ -f dist/server/server.js ] || { echo "FAIL: no build found; run npm run build first"; exit 1; }

stop_app() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    for _ in $(seq 1 50); do kill -0 "$APP_PID" 2>/dev/null || break; sleep 0.1; done
    kill -9 "$APP_PID" 2>/dev/null || true
  fi
  APP_PID=""
}

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then echo "--- app log ---"; tail -40 "$APP_LOG" || true; fi
  stop_app
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "$APP_LOG" "$COOKIES"
  exit "$status"
}
trap cleanup EXIT

wm() { curl -s -u "$WM_USER:$WM_PASS" "$@"; }
ui() { curl -s -u "$ADMIN_USER:$ADMIN_PASS" "$@"; }
stub_ids() { wm "$WM/__admin/mappings" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).mappings.map(m=>m.id).sort().join(",")))'; }

echo "Starting WireMock with admin auth on :$WM_PORT..."
docker run -d --name "$CONTAINER" -p "127.0.0.1:${WM_PORT}:8080" wiremock/wiremock:3.13.1 \
  --admin-api-basic-auth "$WM_USER:$WM_PASS" >/dev/null
for _ in $(seq 1 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' -u "$WM_USER:$WM_PASS" "$WM/__admin/health" || true)" = "200" ] && break
  sleep 1
done

echo "Adding three stubs straight to WireMock..."
for n in 1 2 3; do
  code=$(wm -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X POST "$WM/__admin/mappings" \
    -d "{\"id\":\"0000e2e0-0000-4000-8000-00000000000$n\",\"name\":\"existing $n\",\"request\":{\"method\":\"GET\",\"urlPath\":\"/existing/$n\"},\"response\":{\"status\":200,\"body\":\"existing-$n\"}}")
  [ "$code" = "201" ] || { echo "FAIL: adding stub $n returned $code"; exit 1; }
done
BEFORE="$(stub_ids)"

start_app() {
  env -i PATH="$PATH" PORT="$UI_PORT" LOG_LEVEL=info STORE_DRIVER=none \
    WIREMOCK_URL="$WM" WIREMOCK_ADMIN_USER="$WM_USER" WIREMOCK_ADMIN_PASSWORD="$WM_PASS" \
    ADMIN_USER="$ADMIN_USER" ADMIN_PASSWORD="$ADMIN_PASS" SESSION_SECRET=e2e-none-secret \
    node --experimental-sqlite --disable-warning=ExperimentalWarning server.mjs >>"$APP_LOG" 2>&1 &
  APP_PID=$!
  for _ in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "$UI/healthz" || true)" = "200" ] && return 0
    kill -0 "$APP_PID" 2>/dev/null || { echo "FAIL: the UI exited"; exit 1; }
    sleep 1
  done
  echo "FAIL: /healthz did not return 200 within 60s"; exit 1
}

echo "Starting the UI with STORE_DRIVER=none on :$UI_PORT..."
start_app
[ "$(stub_ids)" = "$BEFORE" ] || { echo "FAIL: WireMock's stubs changed at UI start"; exit 1; }

echo "Signing in and reading the config..."
code=$(curl -s -o /dev/null -w '%{http_code}' -c "$COOKIES" -H 'Content-Type: application/json' -X POST "$UI/api/session" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")
[ "$code" = "200" ] || { echo "FAIL: sign-in returned $code"; exit 1; }
case "$(curl -s -b "$COOKIES" "$UI/api/config")" in
  *'"storeDriver":"none"'*'"seedPrune":false'*) ;;
  *) echo "FAIL: /api/config does not say none"; exit 1 ;;
esac
[ "$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIES" "$UI/mocks")" = "200" ] || { echo "FAIL: the mocks page did not render"; exit 1; }

echo "Listing mocks through the UI..."
LIST="$(ui "$UI/api/mocks")"
for n in 1 2 3; do
  echo "$LIST" | grep -q "\"existing $n\"" || { echo "FAIL: existing $n missing from /api/mocks"; exit 1; }
done

echo "Editing one through the UI..."
code=$(ui -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X PUT "$UI/api/mocks/0000e2e0-0000-4000-8000-000000000002" \
  -d '{"version":1,"stub":{"name":"existing 2","request":{"method":"GET","urlPath":"/existing/2"},"response":{"status":202,"body":"edited"}}}')
[ "$code" = "200" ] || { echo "FAIL: PUT returned $code"; exit 1; }
[ "$(curl -s "$WM/existing/2")" = "edited" ] || { echo "FAIL: WireMock does not serve the edit"; exit 1; }
[ "$(curl -s -o /dev/null -w '%{http_code}' "$WM/existing/2")" = "202" ] || { echo "FAIL: edited status not served"; exit 1; }
code=$(ui -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X PUT "$UI/api/mocks/0000e2e0-0000-4000-8000-000000000002" \
  -d '{"version":1,"stub":{"request":{"method":"GET","urlPath":"/existing/2"},"response":{"status":500}}}')
[ "$code" = "409" ] || { echo "FAIL: a stale version returned $code, expected 409"; exit 1; }

[ "$(stub_ids)" = "$BEFORE" ] || { echo "FAIL: stubs were added or deleted (before: $BEFORE, now: $(stub_ids))"; exit 1; }
for n in 1 3; do [ "$(curl -s "$WM/existing/$n")" = "existing-$n" ] || { echo "FAIL: existing $n changed"; exit 1; }; done

echo "Restarting the UI..."
stop_app
start_app
[ "$(stub_ids)" = "$BEFORE" ] || { echo "FAIL: WireMock's stubs changed across the UI restart"; exit 1; }
[ "$(curl -s "$WM/existing/2")" = "edited" ] || { echo "FAIL: the edit was lost across the UI restart"; exit 1; }
ui "$UI/api/mocks" | grep -q '"edited"' || { echo "FAIL: the edit is not listed after the UI restart"; exit 1; }

code=$(curl -s -o /dev/null -w '%{http_code}' "$WM/__admin/mappings")
[ "$code" = "401" ] || { echo "FAIL: /__admin/mappings returned $code, expected 401"; exit 1; }

echo "E2E OK"
