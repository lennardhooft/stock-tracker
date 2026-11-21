#!/bin/sh
# Local preview without Supabase (demo mode, no login):
#   python -m src.run_daily --local     # writes out/*.json
#   sh scripts/preview_local.sh         # then open http://localhost:8000
# web/demo/ and web/config.js are gitignored.
set -eu
cd "$(dirname "$0")/.."
mkdir -p web/demo
cp out/*.json web/demo/
echo 'window.APP_CONFIG = { demo: true };' > web/config.js
echo "Serving on http://localhost:8000  (Ctrl+C to stop)"
python3 -m http.server -d web 8000
