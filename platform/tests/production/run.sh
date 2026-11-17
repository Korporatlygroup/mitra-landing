#!/bin/bash
# Production acceptance run with synthetic accounts. Keys are fetched at run time (never printed). Persona passwords live in
# ~/.inok-test-secrets-production (outside the repo, mode 0600), separate from the staging store.
# Required: HOSTED_ACCESS_KEY_FILE. Usage: tests/production/run.sh [playwright args]
cd "$(dirname "$0")/../.."
REF=tykdrzrszznwlcyxmgrg
export HOSTED_BASE_URL="https://app.inok.my"
export HOSTED_SUPABASE_URL="https://$REF.supabase.co"
export INOK_TEST_SECRETS_DIR="$HOME/.inok-test-secrets-production"
export ALLOW_PRODUCTION_TESTS=synthetic-only
# tests/e2e/support/env.ts (imported only for message lookup) insists on local keys; they are never used in this run.
export TEST_PUBLISHABLE_KEY=unused TEST_SERVICE_KEY=unused
export HOSTED_ACCESS_KEY="$(tr -d '\r\n' < "$HOSTED_ACCESS_KEY_FILE")"
KEYS=$(npx supabase projects api-keys --project-ref $REF --reveal --output-format json 2>/dev/null | tr -d '\000')
pick() { echo "$KEYS" | python -c "
import sys,json
raw=sys.stdin.read(); d,_=json.JSONDecoder().raw_decode(raw[raw.index('{'):]); print(next(k['api_key'] for k in d['keys'] if k.get('type')=='$1'))"; }
export HOSTED_SUPABASE_PUBLISHABLE_KEY="$(pick publishable)"
export HOSTED_SUPABASE_SECRET_KEY="$(pick secret)"
unset KEYS
npx playwright test -c playwright.production.config.ts "$@" 2>&1 | tr -d '\000' | grep -vE "npm notice|NO_COLOR|trace-warnings|DEP0190"
