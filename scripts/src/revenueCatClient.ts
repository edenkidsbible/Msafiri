import { ReplitConnectors } from "@replit/connectors-sdk";
import { createClient } from "@replit/revenuecat-sdk/client";

export async function getUncachableRevenueCatClient() {
  const connectors = new ReplitConnectors();

  const client = createClient({
    baseUrl: "https://api.revenuecat.com/v2",
    // @replit/revenuecat-sdk calls _fetch(request) with a single Request object,
    // so we must handle url as a Request instance and extract .url/.method/.body from it.
    fetch: async (url: string | URL | Request, _options?: RequestInit): Promise<Response> => {
      let urlStr: string;
      let method: string;
      let body: string | undefined;
      let headers: Record<string, string> | undefined;

      if (url instanceof Request) {
        urlStr = url.url;
        method = url.method;
        body = url.body ? await new Response(url.body).text() : undefined;
        headers = Object.fromEntries(url.headers.entries());
      } else {
        urlStr = url.toString();
        method = _options?.method ?? "GET";
        body = _options?.body as string | undefined;
        headers = _options?.headers as Record<string, string> | undefined;
      }

      // Strip only the host — the proxy hits api.revenuecat.com directly, so /v2 must stay
      const path = urlStr.replace("https://api.revenuecat.com", "") || "/";

      return connectors.proxy("revenuecat", path, {
        method,
        body,
        headers,
      }) as Promise<Response>;
    },
  });

  return client;
}
