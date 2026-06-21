#!/usr/bin/env bash
# Launch daydream-chess: the Python engine (:8000) and the React UI (:8080) together.
# Ctrl-C stops both. Set OPEN=0 to skip auto-opening the browser.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PORT_ENGINE="${PORT_ENGINE:-8000}"
PORT_UI="${PORT_UI:-8080}"
OPEN="${OPEN:-1}"

if [ ! -x ".venv/bin/uvicorn" ]; then
  echo "No .venv found. Create it first:" >&2
  echo "  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

if [ ! -d "web/node_modules" ]; then
  echo "Installing web deps (first run)…"
  (cd web && npm install) || { echo "npm install failed" >&2; exit 1; }
fi

pids=()
cleanup() {
  echo
  echo "Shutting down…"
  for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  lsof -ti "tcp:$PORT_ENGINE" 2>/dev/null | xargs kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting engine on http://localhost:$PORT_ENGINE …"
.venv/bin/uvicorn server.app:app --port "$PORT_ENGINE" &
pids+=($!)

# Wait for the engine to answer /health so the UI connects live (not demo mode).
for _ in $(seq 1 40); do
  curl -sf "http://localhost:$PORT_ENGINE/health" >/dev/null 2>&1 && break
  sleep 0.25
done

echo "Starting UI on http://localhost:$PORT_UI …"
vite_args=(--port="$PORT_UI")
[ "$OPEN" = "1" ] && vite_args+=(--open)
(cd web && npx vite "${vite_args[@]}") &
pids+=($!)

wait
