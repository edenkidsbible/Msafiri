---
name: RevenueCat proxy client quirks
description: Non-obvious issues when bridging @replit/revenuecat-sdk with @replit/connectors-sdk proxy
---

## Request object shape
`createClient` from `@replit/revenuecat-sdk/client` internally calls `_fetch(request)` with a **single `Request` object**, not `fetch(url, options)`. A custom fetch function receives the Request as the first arg and `options` is always `undefined`.

**Fix:** Check `instanceof Request` and read `.url`, `.method`, `.body`, `.headers` directly:
```ts
fetch: async (url: RequestInfo | URL, _options?: RequestInit) => {
  if (url instanceof Request) {
    urlStr = url.url;
    method = url.method;
    body = url.body ? await new Response(url.body).text() : undefined;
    headers = Object.fromEntries(url.headers.entries());
  }
  // ...
}
```

## Proxy path prefix
`connectors.proxy("revenuecat", path)` routes to `https://api.revenuecat.com` + path.
The `createClient` baseUrl is `https://api.revenuecat.com/v2`, so stripping only the host (not `/v2`) gives the correct path:
```ts
const path = urlStr.replace("https://api.revenuecat.com", "") || "/";
```

## OAuth token scope
The Replit connectors-sdk OAuth token is **project-scoped** — it can read/write within authorized projects but CANNOT create new top-level projects (returns 403 "scoped to specific projects"). The seed script must call `listProjects` and use the first returned project instead of trying to create a new one.

**Why:** RevenueCat OAuth tokens granted via Replit integrations are scoped to the user's existing projects at authorization time.

**How to apply:** In any seed script, skip `createProject` — list projects and use `items[0]`.

## Web mode warning
In web/browser mode, RevenueCat switches to `purchases-js` (Web Billing via Stripe). Test store products (safedrive_weekly, safedrive_monthly) show "Could not find product data" warning — this is expected. Products work correctly on iOS/Android via react-native-purchases.
