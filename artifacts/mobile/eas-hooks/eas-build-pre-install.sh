#!/bin/bash
# ── EAS pre-install hook: write google-services.json from EAS secret ──────────
# The google-services.json file is never committed to the repo (it contains API
# keys). Instead, store its contents base64-encoded as an EAS secret named
# GOOGLE_SERVICES_JSON_BASE64, then this hook decodes it before the native
# Android build starts.
#
# Setup (one-time, run from artifacts/mobile/):
#   eas secret:create --scope project --name GOOGLE_SERVICES_JSON_BASE64 \
#     --value "$(base64 < /path/to/google-services.json)"
#
# Without this secret the hook exits cleanly but Android push notifications
# will not work — FCM requires a valid google-services.json at build time.
set -euo pipefail

if [ -z "${GOOGLE_SERVICES_JSON_BASE64:-}" ]; then
  echo "⚠️  GOOGLE_SERVICES_JSON_BASE64 secret not set."
  echo "   Android push notifications will NOT work in this build."
  echo "   See artifacts/mobile/FIREBASE_SETUP.md for setup instructions."
  exit 0
fi

# Decode and write next to app.config.js (EAS CWD = artifacts/mobile/)
echo "$GOOGLE_SERVICES_JSON_BASE64" | base64 --decode > ./google-services.json
echo "✅ google-services.json written from GOOGLE_SERVICES_JSON_BASE64 secret"
