#!/usr/bin/env bash
# Installs the MsafiriWidget provisioning profile before the Xcode build runs.
# The profile must be stored as a base64-encoded EAS secret named
# WIDGET_PROFILE_BASE64.  Generate it locally with:
#   base64 -i "Msafiri Widget AppStore.mobileprovision" | tr -d '\n'
# Then upload:
#   eas secret:create --name WIDGET_PROFILE_BASE64 --value "<output>" --scope project
set -euo pipefail

if [ -z "${WIDGET_PROFILE_BASE64:-}" ]; then
  echo "⚠️  WIDGET_PROFILE_BASE64 not set — skipping widget provisioning profile install."
  exit 0
fi

echo "📦 Installing widget extension provisioning profile..."

PROFILES_DIR="$HOME/Library/MobileDevice/Provisioning Profiles"
mkdir -p "$PROFILES_DIR"

TEMP=$(mktemp /tmp/widget-XXXXXX.mobileprovision)
printf '%s' "$WIDGET_PROFILE_BASE64" | base64 --decode > "$TEMP"

# Extract the UUID embedded in the profile XML
UUID=$(security cms -D -i "$TEMP" 2>/dev/null | plutil -extract UUID raw - 2>/dev/null)

if [ -z "$UUID" ]; then
  echo "❌ Could not extract UUID from provisioning profile — check that WIDGET_PROFILE_BASE64 is a valid .mobileprovision file."
  rm -f "$TEMP"
  exit 1
fi

cp "$TEMP" "$PROFILES_DIR/$UUID.mobileprovision"
rm -f "$TEMP"

echo "✅ Widget profile installed (UUID: $UUID)"
