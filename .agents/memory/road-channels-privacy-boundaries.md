---
name: Road Channels privacy boundaries
description: Non-obvious privacy and moderation invariants for location presence and private voice audio.
---

Road Channels presence responses expose aggregate listener counts and directions only, never device IDs or exact coordinates. A device can hold one active channel lease; channel switching is transactionally serialized and same-channel heartbeats preserve mute/join metadata.

**Why:** Separate delete/insert heartbeats can interleave and create two active channel rows, while recreating the row resets mute state. Exact presence rows also disclose driver locations.

**How to apply:** Lock channel changes per device in one transaction, delete only other-channel rows, and upsert location/lease fields on the selected row.

Private voice playback URLs must expire no later than the recording's retention deadline, and expired audio must not receive a new URL. Explicitly confirmed voice reports enter ordinary moderation as pending rather than notifying nearby drivers immediately.

**Why:** A fixed one-hour signed URL minted just before retention expiry outlives the privacy promise; confirmation is consent to submit, not permission to bypass moderation.

**How to apply:** Cap signing duration to remaining retention seconds and force Road Channels-created community reports through pending review.