import { Resend } from "resend";
import { logger } from "./logger.js";

function getClient(): Resend | null {
  const key = process.env["RESEND_API_KEY"];
  if (!key) {
    logger.warn("RESEND_API_KEY not set — email sending disabled");
    return null;
  }
  return new Resend(key);
}

const FROM = process.env["RESEND_FROM"] ?? "Msafiri Kenya <noreply@msafirikenya.com>";

// ── Daily backup email ────────────────────────────────────────────────────────

// Human-readable label map for the stats table in the email
const STAT_LABELS: Record<string, string> = {
  communityReports:       "Community Reports",
  speedZones:             "Speed Zones",
  savedPlaces:            "Saved Places",
  plannedTrips:           "Planned Trips",
  deviceBackups:          "Device Backups",
  sharedVehicles:         "Shared Vehicles",
  vehicleMembers:         "Vehicle Members",
  vehicleJoinRequests:    "Fleet Join Requests",
  emergencyContacts:      "Emergency Contacts",
  pushTokens:             "Push Tokens",
  courseChapters:         "Course Chapters",
  courseLessons:          "Course Lessons",
  courseQuizQuestions:    "Quiz Questions",
  userCourseProgress:     "Course Progress Records",
  userCourseBookmarks:    "Course Bookmarks",
  pois:                   "Points of Interest",
  appSettings:            "App Settings",
  adminUsers:             "Admin Users",
  blogPosts:              "Blog Posts",
  appReleases:            "App Releases",
  creatorApplications:    "Creator Applications",
  promoCodes:             "Promo Codes",
  accidentRecords:        "Accident Records",
  accidentPhotos:         "Accident Photo Refs",
  accidentWitnesses:      "Accident Witnesses",
  accidentTimelineEvents: "Accident Timeline Events",
  dashcamClips:           "Dashcam Clip Metadata",
  brakingEvents:          "Braking Events",
  hazardClusters:         "Hazard Clusters",
  pushCampaigns:          "Push Campaigns",
  blockedDevices:         "Blocked Devices",
  customVehicles:         "Custom Vehicles",
};

export async function sendDailyBackupEmail(opts: {
  toEmail:     string;
  date:        string;                   // e.g. "2026-07-30"
  stats:       Record<string, number>;   // per-table row counts
  csvContent:  string;                   // reports CSV, directly importable via admin
  jsonContent: string;                   // full JSON backup for restore
}): Promise<boolean> {
  const client = getClient();
  if (!client) return false;

  const { stats } = opts;
  const totalRows = Object.values(stats).reduce((s, n) => s + n, 0);
  const subject   = `Msafiri Kenya — Daily backup ${opts.date} (${totalRows.toLocaleString()} rows, ${Object.keys(stats).length} tables)`;

  // Build per-table rows for the email, alternating background colours
  const tableRows = Object.entries(stats)
    .map(([key, count], i) => {
      const bg = i % 2 === 0 ? "background:#f9f9f9;" : "";
      const label = STAT_LABELS[key] ?? key;
      return `<tr style="${bg}">
        <td style="padding:7px 14px;font-size:13px;">${label}</td>
        <td style="padding:7px 14px;text-align:right;font-size:13px;font-variant-numeric:tabular-nums;">${count.toLocaleString()}</td>
      </tr>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#111;max-width:580px;margin:0 auto;padding:24px;">
  <p style="font-size:20px;font-weight:700;margin-bottom:4px;">📦 Daily data backup — ${opts.date}</p>
  <p style="color:#555;margin-top:4px;">Your automated Msafiri Kenya data backup is attached (${totalRows.toLocaleString()} rows across ${Object.keys(stats).length} tables).</p>

  <table style="border-collapse:collapse;width:100%;margin:20px 0;font-size:13px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
    <tr style="background:#111;color:#fff;">
      <th style="padding:9px 14px;text-align:left;font-size:12px;font-weight:600;letter-spacing:.05em;">TABLE</th>
      <th style="padding:9px 14px;text-align:right;font-size:12px;font-weight:600;letter-spacing:.05em;">ROWS</th>
    </tr>
    ${tableRows}
  </table>

  <p style="font-size:14px;color:#444;">Two files are attached:</p>
  <ul style="font-size:14px;color:#444;line-height:1.8;">
    <li><strong>reports-${opts.date}.csv</strong> — import directly via Admin → Reports → Import CSV</li>
    <li><strong>backup-${opts.date}.json</strong> — full snapshot of all 32 tables; use Admin → System Backup → Restore to seed a database after maintenance</li>
  </ul>

  <hr style="border:none;border-top:1px solid #eee;margin:28px 0;"/>
  <p style="color:#888;font-size:12px;">
    This backup runs automatically every night at 11 PM EAT.<br/>
    Binary assets (dashcam clips, accident photos, PDFs, audio) are stored in Cloudflare R2
    and are not included — they are always persistent and survive server restarts independently.<br/>
    — Msafiri Kenya system
  </p>
</body>
</html>`;

  const textLines = [
    `Daily backup — ${opts.date}`,
    `${totalRows.toLocaleString()} rows across ${Object.keys(stats).length} tables`,
    "",
    ...Object.entries(stats).map(([k, n]) => `  ${(STAT_LABELS[k] ?? k).padEnd(30)} ${n.toLocaleString()}`),
    "",
    "Attachments:",
    `  reports-${opts.date}.csv       (import via Admin → Reports → Import CSV)`,
    `  backup-${opts.date}.json  (full JSON snapshot — restore via Admin → System Backup)`,
    "",
    "— Msafiri Kenya system",
  ];
  const text = textLines.join("\n");

  try {
    const { error } = await client.emails.send({
      from:    FROM,
      to:      opts.toEmail,
      subject,
      html,
      text,
      attachments: [
        {
          filename: `reports-${opts.date}.csv`,
          content:  Buffer.from(opts.csvContent, "utf-8"),
        },
        {
          filename: `backup-${opts.date}.json`,
          content:  Buffer.from(opts.jsonContent, "utf-8"),
        },
      ],
    });

    if (error) {
      logger.error({ error }, "Resend error sending daily backup email");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err }, "Failed to send daily backup email");
    return false;
  }
}

export async function sendCreatorPromoCode(opts: {
  toEmail:  string;
  toName:   string | null;
  code:     string;
  platform: "ios" | "android";
}): Promise<boolean> {
  const client = getClient();
  if (!client) return false;

  const greeting = opts.toName ? `Hi ${opts.toName},` : "Hi there,";

  const redeemUrl =
    opts.platform === "ios"
      ? "https://apps.apple.com/redeem"
      : "https://play.google.com/redeem";

  const platformLabel =
    opts.platform === "ios" ? "Apple App Store" : "Google Play";

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#111;max-width:520px;margin:0 auto;padding:24px;">
  <p style="font-size:22px;font-weight:700;margin-bottom:4px;">You're a Msafiri Creator! 🎉</p>
  <p>${greeting}</p>
  <p>
    Your application to the <strong>Msafiri Creator Program</strong> has been approved.
    Here is your promo code for <strong>1 month of free Msafiri Access</strong>:
  </p>
  <div style="background:#f4f4f4;border-radius:10px;padding:18px 24px;margin:20px 0;text-align:center;">
    <span style="font-size:26px;font-weight:700;letter-spacing:3px;">${opts.code}</span>
  </div>
  <p>
    To redeem it, open the ${platformLabel} on your device and go to:<br/>
    <a href="${redeemUrl}" style="color:#0070f3;">${redeemUrl}</a>
  </p>
  <p>
    Or open the Msafiri app, go to <strong>Settings → Msafiri Creator Program</strong>
    and tap <em>Redeem Promo Code</em>.
  </p>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0;"/>
  <p style="color:#666;font-size:13px;">
    Thank you for helping keep Kenya's roads safer.<br/>
    — The Msafiri Team
  </p>
</body>
</html>`;

  const text = [
    greeting,
    "",
    "Your Msafiri Creator application has been approved!",
    "",
    `Your promo code: ${opts.code}`,
    "",
    `Redeem at: ${redeemUrl}`,
    "",
    "Thank you,",
    "The Msafiri Team",
  ].join("\n");

  try {
    const { error } = await client.emails.send({
      from:    FROM,
      to:      opts.toEmail,
      subject: "You're a Msafiri Creator — here's your free month",
      html,
      text,
    });

    if (error) {
      logger.error({ error }, "Resend returned an error sending creator promo code email");
      return false;
    }

    return true;
  } catch (err) {
    logger.error({ err }, "Failed to send creator promo code email via Resend");
    return false;
  }
}
