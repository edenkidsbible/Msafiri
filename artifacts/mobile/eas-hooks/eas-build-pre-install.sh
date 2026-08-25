#!/bin/bash
# ── EAS pre-install hook: write google-services.json from EAS environment ─────
# The google-services.json file is never committed to the repo (it contains API
# keys). EAS file environment variables are exposed as a temporary file path;
# older setups may still provide base64-encoded contents, so support both.
#
# Setup (one-time, run from artifacts/mobile/):
#   eas secret:create --scope project --name GOOGLE_SERVICES_JSON_BASE64 \
#     --value "$(base64 < /path/to/google-services.json)"
#
# Without this secret the hook exits cleanly but Android push notifications
# will not work — FCM requires a valid google-services.json at build time.
set -euo pipefail

GOOGLE_SERVICES_VALUE="${GOOGLE_SERVICES_JSON_BASE64:-}"

if [ -z "$GOOGLE_SERVICES_VALUE" ]; then
  echo "⚠️  GOOGLE_SERVICES_JSON_BASE64 secret not set."
  echo "   Android push notifications will NOT work in this build."
  echo "   See artifacts/mobile/FIREBASE_SETUP.md for setup instructions."
  exit 0
fi

if [ -f "$GOOGLE_SERVICES_VALUE" ]; then
  # EAS file environment variable: the value is the path to the uploaded file.
  cp "$GOOGLE_SERVICES_VALUE" ./google-services.json
  echo "✅ google-services.json copied from EAS file environment variable"
else
  # Backward-compatible path for a base64-encoded text secret.
  echo "$GOOGLE_SERVICES_VALUE" | base64 --decode > ./google-services.json
  echo "✅ google-services.json decoded from base64 environment variable"
fi

# Fail early with a useful message if the uploaded file is not Firebase config.
node -e '
  const fs = require("fs");
  const config = JSON.parse(fs.readFileSync("./google-services.json", "utf8"));
  if (!config.project_info?.project_id || !Array.isArray(config.client)) {
    throw new Error("google-services.json is missing Firebase project_info or client data");
  }
'
echo "✅ google-services.json passed Firebase config validation"
