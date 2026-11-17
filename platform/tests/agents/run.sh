#!/bin/bash
# Runs the multi-agent suite against STAGING. Keys are fetched at run time from the signed-in Supabase CLI and never printed.
# Required: HOSTED_ACCESS_KEY_FILE (path to the staging access key file). Optional: HOSTED_BASE_URL.
# Usage: tests/agents/run.sh [playwright args, e.g. tests/agents/01-public.spec.ts]
cd "$(dirname "$0")/../.."
export HOSTED_BASE_URL="${HOSTED_BASE_URL:-https://inok-app-staging.long-wind-0982.workers.dev}"
export HOSTED_SUPABASE_URL=https://udxzukodfqjzdukweygy.supabase.co
[ -n "$HOSTED_ACCESS_KEY_FILE" ] && export HOSTED_ACCESS_KEY="$(tr -d '\r\n' < "$HOSTED_ACCESS_KEY_FILE")"
KEYS=$(npx supabase projects api-keys --project-ref udxzukodfqjzdukweygy --reveal --output-format json 2>/dev/null | tr -d '\000')
pick() { echo "$KEYS" | python -c "
import sys,json
raw=sys.stdin.read(); d,_=json.JSONDecoder().raw_decode(raw[raw.index('{'):]); print(next(k['api_key'] for k in d['keys'] if k.get('type')=='$1'))"; }
export HOSTED_SUPABASE_PUBLISHABLE_KEY="$(pick publishable)"
export HOSTED_SUPABASE_SECRET_KEY="$(pick secret)"
unset KEYS
npx playwright test -c playwright.agents.config.ts "$@" 2>&1 | tr -d '\000' | grep -vE "npm notice|NO_COLOR|trace-warnings|DEP0190"
