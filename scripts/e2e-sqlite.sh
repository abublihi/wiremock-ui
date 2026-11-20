#!/usr/bin/env bash
# The restart check without Redis: UI + WireMock only, data in the SQLite volume.
# Also recreates the UI container to prove the stub survives in the volume.
set -euo pipefail
cd "$(dirname "$0")/.."
E2E_COMPOSE_FILE=compose.sqlite.yaml E2E_PROJECT=wiremock-ui-e2e-sqlite E2E_RESTART_UI=1 exec scripts/e2e-restart.sh
