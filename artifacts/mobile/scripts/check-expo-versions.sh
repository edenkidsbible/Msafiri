#!/usr/bin/env bash
# EAS Build appends "--platform android" or "--platform ios" to any
# prebuildCommand value.  expo install --check does not accept a --platform
# flag, so we absorb all extra arguments here and run the check cleanly.
set -euo pipefail
npx expo install --check
