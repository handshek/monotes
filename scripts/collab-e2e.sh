#!/usr/bin/env bash
# Run the collaboration browser tests against a fresh local Convex backend.
# The app runs from a temporary copy with its own .env.local, so the
# project's .env.local and cloud deployment are not used.
#
# CONVEX_AGENT_MODE=anonymous makes the Convex CLI create a new local
# deployment without an account. CONVEX_PROVISION_HOST names the production
# Convex API with an explicit port; the CLI still uses that API to issue the
# local deployment's admin key, but keeps its state and credentials in
# ~/.convex-test-443 and its backend binary in ~/.cache/convex-test-443
# instead of ~/.convex, so an existing CLI login is neither used nor changed.
# Only the deployment state this run created is removed afterwards.
#
# Test-only password sign-in is overlaid in the copy from
# tests/collab-e2e/overlay and never exists in the application source.
#
# Usage: scripts/collab-e2e.sh [playwright args]
# Set MONOTES_COLLAB_KEEP=1 to keep the temporary directory for debugging.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/monotes-collab-e2e.XXXXXX")"
APP="$WORK/app"
PORT="${MONOTES_COLLAB_PORT:-3108}"
export CONVEX_PROVISION_HOST="https://api.convex.dev:443"
STATE_ROOT="$HOME/.convex-test-443/anonymous-convex-backend-state"
export CONVEX_AGENT_MODE=anonymous
mkdir -p "$APP"
EXISTING_DEPLOYMENTS="$(ls -1 "$STATE_ROOT" 2>/dev/null || true)"

CONVEX_PID=""
NEXT_PID=""
cleanup() {
  [[ -n "$NEXT_PID" ]] && kill "$NEXT_PID" 2>/dev/null || true
  [[ -n "$CONVEX_PID" ]] && kill "$CONVEX_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  local name=""
  [[ -f "$APP/.env.local" ]] && name="$(sed -n 's/^CONVEX_DEPLOYMENT=anonymous:\([A-Za-z0-9-]*\).*/\1/p' "$APP/.env.local")"
  # The CLI starts the backend as a detached process; stop the one for this run's state.
  if [[ -n "$name" ]]; then pkill -f "$STATE_ROOT/$name/" 2>/dev/null || true; fi
  if [[ -z "${MONOTES_COLLAB_KEEP:-}" ]]; then
    # Remove only a deployment this run created.
    if [[ "$name" =~ ^anonymous-agent(-[0-9a-f]+)?$ ]] && ! grep -qxF "$name" <<<"$EXISTING_DEPLOYMENTS"; then
      rm -rf "${STATE_ROOT:?}/$name"
    fi
    rm -rf "$WORK"
  else
    echo "Kept $WORK (local deployment ${name:-unknown})"
  fi
}
trap cleanup EXIT

wait_for() {
  local url="$1" tries=0
  until curl -s -o /dev/null "$url"; do
    tries=$((tries + 1))
    if (( tries > 180 )); then echo "Timed out waiting for $url" >&2; return 1; fi
    sleep 1
  done
}

echo "Preparing isolated app copy in $WORK"
rsync -a --exclude node_modules --exclude .next --exclude '.env*' --exclude .git --exclude .audit --exclude docs "$ROOT/" "$APP/"
# APFS clone when available; a plain copy otherwise.
cp -cR "$ROOT/node_modules" "$APP/node_modules" 2>/dev/null || cp -R "$ROOT/node_modules" "$APP/node_modules"
cp -R "$ROOT/tests/collab-e2e/overlay/." "$APP/"
cd "$APP"

echo "Starting local Convex backend"
npx convex dev --once --typecheck disable >"$WORK/convex-setup.log" 2>&1
npx convex dev --typecheck disable >"$WORK/convex.log" 2>&1 &
CONVEX_PID=$!
CONVEX_URL="$(sed -n 's/^NEXT_PUBLIC_CONVEX_URL=//p' .env.local)"
wait_for "$CONVEX_URL/version"
SITE_URL="$(node -e 'const u = new URL(process.argv[1]); u.port = String(Number(u.port) + 1); console.log(u.origin)' "$CONVEX_URL")"

# Set a deployment variable without logging its value. The CLI echoes the
# value on success, so its output is shown only on failure, with the value
# removed.
set_env() {
  local name="$1" value="$2" output
  if ! output="$(npx convex env set "$name" -- "$value" 2>&1)"; then
    echo "Couldn't set $name on the local test deployment:" >&2
    printf '%s\n' "$output" | grep -vF -- "$value" | sed -E 's/( to ).*/\1[value hidden]/' >&2 || true
    return 1
  fi
}

KEYS="$(node tests/collab-e2e/generate-auth-keys.mjs)"
set_env JWT_PRIVATE_KEY "$(printf '%s\n' "$KEYS" | sed -n 1p)"
set_env JWKS "$(printf '%s\n' "$KEYS" | sed -n 2p)"
set_env SITE_URL "http://127.0.0.1:$PORT"
unset KEYS
wait_for "$SITE_URL/agent/v1/me"
printf 'MONOTES_AGENT_API_ORIGIN=%s\n' "$SITE_URL" >>.env.local

echo "Building the app"
bun run build >"$WORK/build.log" 2>&1 || { tail -40 "$WORK/build.log"; exit 1; }
bun run start --hostname 127.0.0.1 --port "$PORT" >"$WORK/next.log" 2>&1 &
NEXT_PID=$!
wait_for "http://127.0.0.1:$PORT/"

cd "$ROOT"
MONOTES_BASE_URL="http://127.0.0.1:$PORT" bunx playwright test -c playwright.collab.config.ts "$@"
