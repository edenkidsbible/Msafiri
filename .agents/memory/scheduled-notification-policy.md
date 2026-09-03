---
name: Scheduled notification policy
description: Product rule for automatic promotional push notifications.
---

Automatic promotional pushes are limited to one app-usage tip per day at 13:00 EAT for recently active devices. Do not schedule morning road checks, evening road alerts, weekend promotions, reporting-engagement pushes, recovery prompts, trial nudges, re-engagement campaigns, or planned-trip road advisories.

Notification titles must stay at 20 visible characters or fewer whenever possible. Put variable detail such as distance, speed, vehicle name, version, or explanation in the body instead of the title.

**Why:** Multiple overlapping schedules and queued generic campaigns caused users to receive several notifications together, including duplicate road-check messages.

**How to apply:** Use one shared daily campaign identity with an atomic singleton claim, deduplicate physical devices at send time, and cancel generic queued scheduled campaigns rather than delivering them. Keep transactional notifications separate and title-first wording compact.