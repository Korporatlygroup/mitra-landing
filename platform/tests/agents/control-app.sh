#!/bin/bash
# CONTROL RUN host: a local production build of the same app code, pointed at the SAME mitra-staging Supabase project, served on
# 127.0.0.1:3101. It has no Cloudflare CPU limit, so a failure that appears here is an application/database defect and not a
# hosting limit. Keys are fetched at run time from the signed-in Supabase CLI, kept in process env only, never printed or written.
# Usage: tests/agents/control-app.sh build | start
cd "$(dirname "$0")/../.."
REF=udxzukodfqjzdukweygy
KEYS=$(npx supabase projects api-keys --project-ref $REF --reveal --output-format json 2>/dev/null | tr -d '\000')
pick() { echo "$KEYS" | python -c "
import sys,json
raw=sys.stdin.read(); d,_=json.JSONDecoder().raw_decode(raw[raw.index('{'):]); print(next(k['api_key'] for k in d['keys'] if k.get('type')=='$1'))"; }
export NEXT_PUBLIC_SUPABASE_URL=https://$REF.supabase.co
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$(pick publishable)"
export SUPABASE_SECRET_KEY="$(pick secret)"
unset KEYS
export SITE_URL=http://127.0.0.1:3101
export CRON_SECRET=control-run-cron-secret-0123456789abcdef
unset CLAMD_HOST CLAMD_PORT
case "$1" in
  build) npx next build ;;
  start) exec npx next start -p 3101 -H 127.0.0.1 ;;
  *) echo "usage: $0 build|start"; exit 2 ;;
esac
