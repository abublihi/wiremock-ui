#!/usr/bin/env sh
# Boots a built standalone image (UI and WireMock in one container) and checks that the UI answers, that a mock
# saved through the UI is served on WireMock's port, that the Guide has its pages, and that `docker stop` exits 0.
#   scripts/docker-smoke-standalone.sh <image> [ui-host-port] [wiremock-host-port]
set -eu
IMAGE="${1:?usage: scripts/docker-smoke-standalone.sh <image> [ui-host-port] [wiremock-host-port]}"
UI_PORT="${2:-3461}"
WM_PORT="${3:-3462}"
ID="wmui-smoke-standalone-$$"
PASSWORD="smoke-test-password"

cleanup() {
  docker rm -f "$ID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Non-default ports inside the container too, to check PORT and WIREMOCK_PORT are honoured.
docker run -d --name "$ID" -p "127.0.0.1:$UI_PORT:3100" -p "127.0.0.1:$WM_PORT:9100" \
  -e PORT=3100 -e WIREMOCK_PORT=9100 -e ADMIN_USER=admin -e ADMIN_PASSWORD="$PASSWORD" "$IMAGE" >/dev/null

UI="http://127.0.0.1:$UI_PORT"
i=0
until curl -fsS "$UI/healthz" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 90 ]; then
    echo "/healthz did not answer within 90 s" >&2
    docker logs "$ID" >&2 || true
    exit 1
  fi
  sleep 1
done
echo "ok: /healthz"

curl -fsS -u "admin:$PASSWORD" -H 'Content-Type: application/json' \
  -d '{"request":{"method":"GET","urlPath":"/smoke/hello"},"response":{"status":200,"body":"hello from the standalone image"}}' \
  "$UI/api/mocks" >/dev/null
echo "ok: mock saved through the UI"

BODY="$(curl -fsS "http://127.0.0.1:$WM_PORT/smoke/hello")"
[ "$BODY" = "hello from the standalone image" ] || { echo "WireMock answered: $BODY" >&2; exit 1; }
echo "ok: WireMock serves the mock"

# The admin API is locked (the password is made at start-up).
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WM_PORT/__admin/mappings")"
[ "$CODE" = "401" ] || { echo "WireMock admin API answered $CODE without credentials" >&2; exit 1; }
echo "ok: WireMock admin API is locked"

GUIDE="$(curl -fsS -u "admin:$PASSWORD" "$UI/guide")"
case "$GUIDE" in
  *'Getting started'*) echo "ok: /guide lists its pages" ;;
  *) echo "/guide has no pages" >&2; exit 1 ;;
esac

docker stop -t 20 "$ID" >/dev/null
EXIT="$(docker inspect -f '{{.State.ExitCode}}' "$ID")"
[ "$EXIT" = "0" ] || { echo "docker stop: exit code $EXIT" >&2; docker logs "$ID" >&2 || true; exit 1; }
echo "ok: docker stop exits cleanly"
