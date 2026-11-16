#!/bin/bash
# Warms the Worker's public-page cache after a deployment (see public-page-cache.mjs): one browser-style request per cacheable page and
# language, repeated until a stored copy answers. Pages are public; the access key is read from a file you name (never printed).
# Usage: deploy/warm-public-pages.sh <worker-url> [access-key-file]
URL=${1:?worker url, e.g. https://inok-app-staging.<subdomain>.workers.dev}
KEY=""
[ -n "$2" ] && KEY=$(cat "$2")
PAGES=""
for l in en ms ta; do
  for p in "" /directory /catalogue /business-help /news /privacy /terms /marketplace-policy /cookies /government-disclaimer /complaints /login /signup /forgot-password; do
    PAGES="$PAGES /$l$p"
  done
done
bad=0
for p in $PAGES; do
  ok=0
  for try in 1 2 3 4 5 6; do
    h=$(curl -s -o /dev/null -D - -H "accept: text/html" ${KEY:+-H "x-inok-access-key: $KEY"} "$URL$p" | tr -d '\r')
    if echo "$h" | grep -qi "x-inok-page-cache"; then ok=1; break; fi
    sleep 1
  done
  [ $ok = 1 ] || { echo "not cached: $p"; bad=$((bad+1)); }
done
echo "warmed $(echo $PAGES | wc -w) pages, $bad not cached"
