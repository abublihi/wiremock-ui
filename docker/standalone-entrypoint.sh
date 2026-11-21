#!/usr/bin/env bash
# Starts WireMock and wiremock-ui in one container (the `standalone` image target).
#
# - WireMock listens on WIREMOCK_PORT (default 8080), the UI on PORT (default 3000).
# - WireMock's admin API is locked with Basic auth. Unless WIREMOCK_ADMIN_USER/WIREMOCK_ADMIN_PASSWORD are set, a
#   random password is made at every start: only the UI (inside this container) needs it.
# - SESSION_SECRET, when not set, is made once and kept in /data so sign-ins survive a restart.
# - WireMock's own files (stubs saved with persistent: true, used in WireMock-only mode) live in /data/wiremock.
# - WIREMOCK_OPTIONS adds WireMock options (for example --global-response-templating); JAVA_OPTS goes to Java.
# - When either process stops, the other is stopped and the container exits with that status.
set -euo pipefail

DATA_DIR="${DATA_DIR:-/data}"
WIREMOCK_PORT="${WIREMOCK_PORT:-8080}"
export PORT="${PORT:-3000}"

# Reads a fixed amount, so no pipe is cut short (pipefail).
random() {
  local s
  s="$(head -c 96 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
  printf '%s' "${s:0:$1}"
}

if [ -z "${WIREMOCK_ADMIN_USER:-}" ] && [ -z "${WIREMOCK_ADMIN_PASSWORD:-}" ]; then
  export WIREMOCK_ADMIN_USER="wiremock-ui"
  WIREMOCK_ADMIN_PASSWORD="$(random 32)"
  export WIREMOCK_ADMIN_PASSWORD
elif [ -z "${WIREMOCK_ADMIN_USER:-}" ] || [ -z "${WIREMOCK_ADMIN_PASSWORD:-}" ]; then
  echo "WIREMOCK_ADMIN_USER and WIREMOCK_ADMIN_PASSWORD must be set together or both left unset" >&2
  exit 1
fi

if [ -z "${SESSION_SECRET:-}" ]; then
  secret_file="$DATA_DIR/.session-secret"
  if [ ! -s "$secret_file" ]; then
    (umask 077 && random 64 >"$secret_file")
  fi
  SESSION_SECRET="$(cat "$secret_file")"
  export SESSION_SECRET
fi

# The UI always talks to the WireMock in this container; the public address is what testers and apps use.
export WIREMOCK_URL="http://127.0.0.1:${WIREMOCK_PORT}"
export WIREMOCK_PUBLIC_URL="${WIREMOCK_PUBLIC_URL:-http://localhost:${WIREMOCK_PORT}}"

mkdir -p "$DATA_DIR/wiremock/mappings" "$DATA_DIR/wiremock/__files"

# shellcheck disable=SC2086 # JAVA_OPTS and WIREMOCK_OPTIONS are word lists on purpose.
java ${JAVA_OPTS:-} -cp '/var/wiremock/lib/*:/var/wiremock/extensions/*' wiremock.Run \
  --port "$WIREMOCK_PORT" \
  --root-dir "$DATA_DIR/wiremock" \
  --admin-api-basic-auth "${WIREMOCK_ADMIN_USER}:${WIREMOCK_ADMIN_PASSWORD}" \
  --max-request-journal-entries "${WIREMOCK_JOURNAL_ENTRIES:-5000}" \
  ${WIREMOCK_OPTIONS:-} &
wiremock_pid=$!

# The UI waits for WireMock itself (BOOT_TIMEOUT_SECONDS), so both can start together.
node --experimental-sqlite --disable-warning=ExperimentalWarning /app/server.mjs &
ui_pid=$!

signalled=0
stop() {
  kill -TERM "$ui_pid" "$wiremock_pid" 2>/dev/null || true
}
trap 'signalled=1; stop' TERM INT

status=0
wait -n "$ui_pid" "$wiremock_pid" || status=$?
# Either a signal arrived (both are being stopped) or one process ended on its own: stop the other too.
stop
wait "$ui_pid" 2>/dev/null || true
wait "$wiremock_pid" 2>/dev/null || true
# docker stop is a clean exit; a process that ended on its own passes on its status.
if [ "$signalled" = 1 ]; then exit 0; fi
exit "$status"
