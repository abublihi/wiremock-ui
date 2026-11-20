#!/usr/bin/env sh
# Boots a built wiremock-ui image next to a WireMock container and checks it serves /healthz and a Guide with
# its pages in it (the Guide is built from docs/guide/*.md; an image built without them has an empty Guide).
#   scripts/docker-smoke.sh <image> [host-port]
set -eu
IMAGE="${1:?usage: scripts/docker-smoke.sh <image> [host-port]}"
PORT="${2:-3460}"
ID="wmui-smoke-$$"
PASSWORD="smoke-test-password"
JAR="$(mktemp)"

cleanup() {
  docker rm -f "$ID-ui" "$ID-wm" >/dev/null 2>&1 || true
  docker network rm "$ID" >/dev/null 2>&1 || true
  rm -f "$JAR"
}
trap cleanup EXIT

docker network create "$ID" >/dev/null
docker run -d --name "$ID-wm" --network "$ID" wiremock/wiremock:3.13.1 --admin-api-basic-auth wm-admin:wm-admin-pass >/dev/null
docker run -d --name "$ID-ui" --network "$ID" -p "127.0.0.1:$PORT:3000" \
  -e WIREMOCK_URL="http://$ID-wm:8080" -e WIREMOCK_ADMIN_USER=wm-admin -e WIREMOCK_ADMIN_PASSWORD=wm-admin-pass \
  -e ADMIN_USER=admin -e ADMIN_PASSWORD="$PASSWORD" \
  -e SESSION_SECRET=smoke-test-session-secret-0123456789 "$IMAGE" >/dev/null

BASE="http://127.0.0.1:$PORT"
i=0
until curl -fsS "$BASE/healthz" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "/healthz did not answer within 60 s" >&2
    docker logs "$ID-ui" >&2 || true
    exit 1
  fi
  sleep 1
done
echo "ok: /healthz"

curl -fsS -c "$JAR" -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$PASSWORD\"}" "$BASE/api/session" >/dev/null
echo "ok: signed in"

GUIDE="$(curl -fsS -b "$JAR" "$BASE/guide")"
for title in 'Getting started' 'Scenarios and the builder'; do
  case "$GUIDE" in
    *"$title"*) ;;
    *)
      echo "/guide does not contain \"$title\": the image's Guide is empty" >&2
      exit 1
      ;;
  esac
done
echo "ok: /guide lists its pages"
