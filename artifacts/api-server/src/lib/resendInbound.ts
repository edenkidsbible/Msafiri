import { db } from "@workspace/db";
import { inboxEmailsTable } from "@workspace/db/schema";

const RESEND_API_URL = "https://api.resend.com";

export interface ResendReceivedEmailSummary {
  id?: string;
  email_id?: string;
  from?: string;
  to?: string[];
  subject?: string;
  created_at?: string;
  message_id?: string;
}

interface ResendReceivedEmail extends ResendReceivedEmailSummary {
  html?: string | null;
  text?: string | null;
  headers?: Record<string, unknown>;
}

function parseSender(from: string, headerFrom?: unknown) {
  const displayFrom = typeof headerFrom === "string" ? headerFrom : from;
  const match = displayFrom.match(/^"?(.+?)"?\s*<([^>]+)>$/);
  return match
    ? { fromName: match[1].trim(), fromEmail: match[2].trim() }
    : { fromName: null, fromEmail: from.trim() };
}

async function resendGet<T>(apiKey: string, path: string): Promise<T> {
  const response = await fetch(`${RESEND_API_URL}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body}`);
  }
  return response.json() as Promise<T>;
}

export async function retrieveReceivedEmail(
  apiKey: string,
  emailId: string,
): Promise<ResendReceivedEmail> {
  return resendGet<ResendReceivedEmail>(
    apiKey,
    `/emails/receiving/${encodeURIComponent(emailId)}`,
  );
}

export async function persistReceivedEmail(
  apiKey: string,
  summary: ResendReceivedEmailSummary,
): Promise<void> {
  const resendId = summary.email_id ?? summary.id;
  const detail = resendId
    ? await retrieveReceivedEmail(apiKey, resendId)
    : summary;

  const headers = detail.headers ?? {};
  const from = detail.from ?? summary.from ?? "";
  if (!from) throw new Error("Received email is missing a sender");

  const { fromName, fromEmail } = parseSender(from, headers.from);
  const toEmail = detail.to?.[0] ?? summary.to?.[0] ?? "hello@msafirikenya.com";
  const messageId =
    detail.message_id ??
    summary.message_id ??
    (resendId ? `<resend:${resendId}>` : undefined);

  await db
    .insert(inboxEmailsTable)
    .values({
      messageId,
      fromEmail,
      fromName,
      toEmail,
      subject: detail.subject ?? summary.subject ?? "(no subject)",
      bodyHtml: detail.html ?? null,
      bodyText: detail.text ?? null,
      inReplyTo:
        (headers["in-reply-to"] as string | undefined) ??
        (headers["In-Reply-To"] as string | undefined) ??
        null,
      references:
        (headers.references as string | undefined) ??
        (headers.References as string | undefined) ??
        null,
      rawHeaders: JSON.stringify(headers),
      direction: "inbound",
      receivedAt: new Date(
        detail.created_at ?? summary.created_at ?? Date.now(),
      ),
    })
    .onConflictDoUpdate({
      target: inboxEmailsTable.messageId,
      set: {
        fromEmail,
        fromName,
        toEmail,
        subject: detail.subject ?? summary.subject ?? "(no subject)",
        bodyHtml: detail.html ?? null,
        bodyText: detail.text ?? null,
        rawHeaders: JSON.stringify(headers),
        direction: "inbound",
      },
    });
}

export async function listReceivedEmails(
  apiKey: string,
  after?: string,
): Promise<{
  data: ResendReceivedEmailSummary[];
  has_more: boolean;
}> {
  const params = new URLSearchParams({ limit: "100" });
  if (after) params.set("after", after);
  return resendGet(apiKey, `/emails/receiving?${params}`);
}