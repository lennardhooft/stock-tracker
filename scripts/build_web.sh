#!/bin/sh
# Cloudflare Pages build command:  sh scripts/build_web.sh     (output directory: web)
# Writes web/config.js from the Pages environment variables SUPABASE_URL and SUPABASE_ANON_KEY.
# Only the PUBLIC anon key goes here. Never the service key.
set -eu

: "${SUPABASE_URL:?set SUPABASE_URL in Cloudflare Pages → Settings → Environment variables}"
: "${SUPABASE_ANON_KEY:?set SUPABASE_ANON_KEY in Cloudflare Pages → Settings → Environment variables}"

cat > web/config.js <<EOF
window.APP_CONFIG = {
  supabaseUrl: "${SUPABASE_URL}",
  supabaseAnonKey: "${SUPABASE_ANON_KEY}",
};
EOF
echo "web/config.js written"
