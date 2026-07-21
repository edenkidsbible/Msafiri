/**
 * Push notification diagnostic script.
 * Sends a single push to each real token, captures ticket IDs,
 * waits 20 seconds, then checks receipts for the definitive delivery status.
 */

const EXPO_PUSH_URL   = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPT_URL = "https://exp.host/--/api/v2/push/getReceipts";
const EXPO_ACCESS_TOKEN = process.env.EXPO_ACCESS_TOKEN;

// Real tokens from the DB (skip the fake xxx one)
const IOS_TOKEN     = "ExponentPushToken[IZqcYCH1Ui50PeabchHINy]";
const ANDROID_TOKEN = "ExponentPushToken[HSmkBlPRSEHUfG2faNsnca]";

function headers() {
  const h: Record<string, string> = {
    "Accept": "application/json",
    "Content-Type": "application/json",
  };
  if (EXPO_ACCESS_TOKEN) {
    h["Authorization"] = `Bearer ${EXPO_ACCESS_TOKEN}`;
    console.log("✓ Using EXPO_ACCESS_TOKEN");
  } else {
    console.warn("⚠️  EXPO_ACCESS_TOKEN not set — sending anonymously (credentials not validated)");
  }
  return h;
}

async function run() {
  console.log("\n── Step 1: Send test pushes ─────────────────────────────────");

  const messages = [
    {
      to: IOS_TOKEN,
      title: "🔔 Diagnostic Test (iOS)",
      body: "Checking push delivery — please confirm receipt",
      channelId: "default",
      sound: "default",
      data: { type: "diagnostic" },
    },
    {
      to: ANDROID_TOKEN,
      title: "🔔 Diagnostic Test (Android)",
      body: "Checking push delivery — please confirm receipt",
      channelId: "default",
      sound: "default",
      data: { type: "diagnostic" },
    },
  ];

  const sendRes = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(messages),
  });

  if (!sendRes.ok) {
    console.error("Send failed — HTTP", sendRes.status, await sendRes.text());
    return;
  }

  const sendBody = await sendRes.json() as { data: Array<{ status: string; id?: string; message?: string; details?: any }> };
  console.log("\nTicket results:");
  const ticketIds: string[] = [];

  for (let i = 0; i < sendBody.data.length; i++) {
    const ticket = sendBody.data[i];
    const label = i === 0 ? "iOS" : "Android";
    if (ticket.status === "ok" && ticket.id) {
      console.log(`  [${label}] ✓ ok — ticket: ${ticket.id}`);
      ticketIds.push(ticket.id);
    } else {
      console.error(`  [${label}] ✗ error — ${ticket.message} | details: ${JSON.stringify(ticket.details)}`);
    }
  }

  if (ticketIds.length === 0) {
    console.error("\nNo ok tickets — push failed at the send stage. Credentials or tokens are invalid.");
    return;
  }

  console.log("\n── Step 2: Waiting 20 seconds for Expo to process receipts ──");
  await new Promise(r => setTimeout(r, 20_000));

  console.log("\n── Step 3: Checking receipts ────────────────────────────────");
  const receiptRes = await fetch(EXPO_RECEIPT_URL, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ ids: ticketIds }),
  });

  if (!receiptRes.ok) {
    console.error("Receipt check failed — HTTP", receiptRes.status, await receiptRes.text());
    return;
  }

  const receiptBody = await receiptRes.json() as { data: Record<string, { status: string; message?: string; details?: any }> };
  const receipts = receiptBody.data;

  if (Object.keys(receipts).length === 0) {
    console.log("⏳ No receipts yet — Expo hasn't processed them in 20s.");
    console.log("   This usually means APNs/FCM credentials are NOT configured in your EAS project.");
    console.log("   Expo queued the message but couldn't route it to APNs/FCM.");
  } else {
    for (const [ticketId, receipt] of Object.entries(receipts)) {
      if (receipt.status === "ok") {
        console.log(`  ✓ ${ticketId}: DELIVERED to APNs/FCM`);
      } else {
        console.error(`  ✗ ${ticketId}: ${receipt.status} — ${receipt.message}`);
        console.error(`    error code: ${receipt.details?.error}`);
        if (receipt.details?.error === "InvalidCredentials") {
          console.error("    → APNs/FCM credentials are NOT set up in your EAS project.");
          console.error("    → Run: eas credentials (iOS) or configure FCM in EAS (Android)");
        } else if (receipt.details?.error === "DeviceNotRegistered") {
          console.error("    → Token is stale/unregistered. The app needs to re-register.");
        }
      }
    }
  }
}

run().catch(console.error);
