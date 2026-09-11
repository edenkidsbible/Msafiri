---
name: Resend inbound email contract
description: Non-obvious requirements for reliably importing Resend inbound email into the admin inbox.
---

Resend's `email.received` webhook contains metadata only. Retrieve the complete message from the Receiving API using `data.email_id` before storing HTML, text, and headers.

**Why:** Assuming the webhook includes body content creates empty inbox messages. Also, an Express router mounted at the full webhook path must declare its handler at `/`; repeating the full path inside the router silently creates a duplicated, unreachable endpoint.

**How to apply:** Keep signature verification on the raw request body, enrich through `/emails/receiving/:emailId`, and use the list-received endpoint for historical reconciliation.