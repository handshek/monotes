#!/usr/bin/env bash
# Run the dev server against a private local Convex backend with test-only
# password sign-in, so signed-in features can be tried without a Google
# account (in incognito, say). The sign-in page offers one-click buttons for
# alice@test.local and bob@test.local, and takes any other email too; every
# account uses the password test-password-1234 and is created on first use.
#
# The app runs from a copy in ~/.cache/monotes-dev-signed-in with the overlay
# from tests/collab-e2e/overlay, so the project's .env.local, Convex login and
# cloud deployment are never used. Edits to the source are copied across
# every second, so Next.js and Convex reload as usual.
#
# Accounts and cloud notes are kept between runs. Pass --fresh to start over
# with an empty backend.
#
# See scripts/collab-e2e.sh for why CONVEX_AGENT_MODE and
# CONVEX_PROVISION_HOST are set.
#
# Usage: scripts/dev-signed-in.sh [--fresh]   (or: bun run dev:signed-in)
# MONOTES_DEV_PORT picks the port (default 3109).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${XDG_CACHE_HOME:-$HOME/.cache}/monotes-dev-signed-in"
APP="$WORK/app"
PORT="${MONOTES_DEV_PORT:-3109}"
export CONVEX_PROVISION_HOST="https://api.convex.dev:443"
export CONVEX_AGENT_MODE=anonymous
STATE_ROOT="$HOME/.convex-test-443/anonymous-convex-backend-state"

deployment_name() {
  [[ -f "$APP/.env.local" ]] && sed -n 's/^CONVEX_DEPLOYMENT=anonymous:\([A-Za-z0-9-]*\).*/\1/p' "$APP/.env.local" || true
}

if [[ "${1:-}" == "--fresh" ]]; then
  name="$(deployment_name)"
  if [[ "$name" =~ ^anonymous-agent(-[0-9a-f]+)?$ ]]; then
    pkill -f "$STATE_ROOT/$name/" 2>/dev/null || true
    rm -rf "${STATE_ROOT:?}/$name"
  fi
  rm -rf "$WORK"
  echo "Started over with an empty backend"
fi
mkdir -p "$APP"

CONVEX_PID=""
NEXT_PID=""
SYNC_PID=""
cleanup() {
  [[ -n "$SYNC_PID" ]] && kill "$SYNC_PID" 2>/dev/null || true
  [[ -n "$NEXT_PID" ]] && kill "$NEXT_PID" 2>/dev/null || true
  [[ -n "$CONVEX_PID" ]] && kill "$CONVEX_PID" 2>/dev/null || true
  local name
  name="$(deployment_name)"
  # The CLI starts the backend as a detached process; stop it, keep its data.
  if [[ -n "$name" ]]; then pkill -f "$STATE_ROOT/$name/" 2>/dev/null || true; fi
  wait 2>/dev/null || true
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

# Copies the source without touching the overlay, the copy's own settings,
# or files the copy's Convex and Next.js processes generate.
copy_source() {
  rsync -a --delete \
    --exclude /node_modules --exclude /.next --exclude '/.env*' --exclude /.git \
    --exclude /.audit --exclude /docs --exclude /test-results --exclude /playwright-report \
    --exclude /convex/_generated --exclude /convex/auth.ts \
    --exclude '/src/app/(auth)/signin/signin-form.tsx' \
    --exclude '*.tsbuildinfo' --exclude /next-env.d.ts \
    "$ROOT/" "$APP/"
}

echo "Preparing the app copy in $APP"
copy_source
if [[ ! -d "$APP/convex/_generated" ]]; then
  cp -R "$ROOT/convex/_generated" "$APP/convex/_generated"
fi
rm -rf "$APP/node_modules"
# APFS clone when available; a plain copy otherwise.
cp -cR "$ROOT/node_modules" "$APP/node_modules" 2>/dev/null || cp -R "$ROOT/node_modules" "$APP/node_modules"
cp -R "$ROOT/tests/collab-e2e/overlay/." "$APP/"
cd "$APP"

echo "Starting the local Convex backend"
npx convex dev --once --typecheck disable >"$WORK/convex-setup.log" 2>&1 || { tail -40 "$WORK/convex-setup.log"; exit 1; }
npx convex dev --typecheck disable >"$WORK/convex.log" 2>&1 &
CONVEX_PID=$!
CONVEX_URL="$(sed -n 's/^NEXT_PUBLIC_CONVEX_URL=//p' .env.local)"
wait_for "$CONVEX_URL/version"
SITE_URL="$(node -e 'const u = new URL(process.argv[1]); u.port = String(Number(u.port) + 1); console.log(u.origin)' "$CONVEX_URL")"

# Set a deployment variable without logging its value.
set_env() {
  local name="$1" value="$2" output
  if ! output="$(npx convex env set "$name" -- "$value" 2>&1)"; then
    echo "Couldn't set $name on the local deployment:" >&2
    printf '%s\n' "$output" | grep -vF -- "$value" | sed -E 's/( to ).*/\1[value hidden]/' >&2 || true
    return 1
  fi
}

# Signing keys are made once, so sessions survive a restart.
if [[ -z "$(npx convex env get JWKS 2>/dev/null || true)" ]]; then
  KEYS="$(node tests/collab-e2e/generate-auth-keys.mjs)"
  set_env JWT_PRIVATE_KEY "$(printf '%s\n' "$KEYS" | sed -n 1p)"
  set_env JWKS "$(printf '%s\n' "$KEYS" | sed -n 2p)"
  unset KEYS
fi
set_env SITE_URL "http://localhost:$PORT"
wait_for "$SITE_URL/agent/v1/me"
grep -q '^MONOTES_AGENT_API_ORIGIN=' .env.local || printf 'MONOTES_AGENT_API_ORIGIN=%s\n' "$SITE_URL" >>.env.local

( while sleep 1; do copy_source 2>/dev/null || true; done ) &
SYNC_PID=$!

cat <<EOF

  Monotes with test sign-in: http://localhost:$PORT/signin
  Accounts:  alice@test.local, bob@test.local (or any email)
  Password:  test-password-1234 (filled in for you)
  Cloud data: cd "$APP" && CONVEX_PROVISION_HOST=$CONVEX_PROVISION_HOST CONVEX_AGENT_MODE=anonymous npx convex data notes
  Logs: $WORK/convex.log
  Stop with Ctrl-C. Data is kept; pass --fresh to start over.

EOF

bunx next dev --turbopack --port "$PORT" &
NEXT_PID=$!
wait "$NEXT_PID"
