---
name: admin_users uuid vs ops_ text id joins
description: Casting rule when joining admin_users (uuid PK) to ops_ tables that store admin ids as TEXT
---

`admin_users.id` is a UUID column, but every `ops_` chat/team table stores admin ids as TEXT (`sender_id`, `user_id`, etc.). Postgres has no implicit `uuid = text` operator, so a plain Drizzle `eq(adminUsersTable.id, opsX.userId)` fails at runtime with "operator does not exist: uuid = text" (typecheck passes).

**How to apply:** join/filter with an explicit cast on the uuid side, e.g. ``sql`${adminUsersTable.id}::text = ${opsMessagesTable.senderId}``. Applies to any new query joining admin_users to ops_ tables.
