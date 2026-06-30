import { ReplitConnectors } from "@replit/connectors-sdk";
import { createClient } from "@replit/revenuecat-sdk/client";

export async function getUncachableRevenueCatClient() {
  const connectors = new ReplitConnectors();

  const client = createClient({
    baseUrl: "https://api.revenuecat.com/v2",
    fetch: async (url: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
      const urlStr = url.toString();
      const path = urlStr.replace("https://api.revenuecat.com/v2", "") || "/";
      return connectors.proxy("revenuecat", path, {
        method: (options?.method ?? "GET") as string,
        body: options?.body as string | undefined,
        headers: options?.headers as Record<string, string> | undefined,
      }) as Promise<Response>;
    },
  });

  return client;
}
