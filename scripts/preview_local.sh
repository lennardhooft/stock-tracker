#!/bin/sh
# Local preview with FAKE fixture data (demo mode, no login, no Supabase):
#   sh scripts/preview_local.sh      then open http://localhost:8000
# Try states: http://localhost:8000/?fixture=empty  (also: calm, stale, failed, partial, error, offline, new, login)
# web/config.js is gitignored.
set -eu
cd "$(dirname "$0")/.."
echo 'window.APP_CONFIG = { demo: true };' > web/config.js
echo "Serving on http://localhost:8000  (Ctrl+C to stop)"
python3 -m http.server -d web 8000
