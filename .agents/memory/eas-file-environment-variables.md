---
name: EAS file environment variables
description: How EAS exposes uploaded file variables to build hooks and how to support Firebase config safely.
---

An EAS environment variable declared as a file is exposed to the build as a temporary **file path**, not the file's contents. A build hook must copy that path to its required destination; base64-decoding the variable value fails before native compilation begins.

**Why:** A Firebase `google-services.json` uploaded as an EAS file variable caused the Android pre-install hook to fail immediately when it treated the temporary path as base64 text.

**How to apply:** For file-backed build inputs, test whether the environment value is an existing file and copy it. Keep a base64 fallback only for legacy text-secret setups, then validate the produced config before continuing the build.