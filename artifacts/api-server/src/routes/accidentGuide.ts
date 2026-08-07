/**
 * GET /accident-guide
 *
 * Streams a fully-branded Msafiri Kenya Accident Response Guide as a PDF.
 * No authentication required — intended for download / share from the mobile app.
 */

import { Router, type Request, type Response } from "express";
import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";

const router = Router();

// ── Brand tokens ──────────────────────────────────────────────────────────────
const GREEN        = "#00A845";
const GREEN_DARK   = "#007A33";
const GREEN_LIGHT  = "#E7F3EA";
const TEXT_DARK    = "#0C120E";
const TEXT_MUTED   = "#5F6B62";
const WHITE        = "#FFFFFF";
const BORDER       = "#E1E7E1";

// ── Layout constants ──────────────────────────────────────────────────────────
const PAGE_W  = 595.28;   // A4 width  (points)
const PAGE_H  = 841.89;   // A4 height (points)
const ML      = 48;       // margin left
const MR      = 48;       // margin right
const CONTENT = PAGE_W - ML - MR;

// ── Helper: resolve the icon shipped alongside this bundle ────────────────────
function iconPath(): string {
  // __dirname is patched by the esbuild banner → always resolves to dist/
  const d = (globalThis as any).__dirname ?? __dirname;
  return path.join(d, "assets", "msafiri-icon.png");
}

// ── PDF builder ───────────────────────────────────────────────────────────────
function buildGuide(): Buffer {
  return new Promise<Buffer>((resolve, reject) => {
    const doc    = new PDFDocument({ size: "A4", margins: { top: 0, bottom: 0, left: 0, right: 0 }, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on("data",  (c: Buffer) => chunks.push(c));
    doc.on("end",   () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let y = 0; // running cursor

    // ── COVER HEADER ──────────────────────────────────────────────────────────
    // Full-bleed green banner
    const HEADER_H = 200;
    doc.rect(0, 0, PAGE_W, HEADER_H).fill(GREEN);

    // Decorative circle accents
    doc.save();
    doc.circle(PAGE_W - 60, 30,  80).fillOpacity(0.06).fill(WHITE);
    doc.circle(PAGE_W - 20, 140, 60).fillOpacity(0.05).fill(WHITE);
    doc.circle(40,           -20, 70).fillOpacity(0.06).fill(WHITE);
    doc.restore();

    // App icon (top-left in header)
    const iPath = iconPath();
    if (fs.existsSync(iPath)) {
      doc.image(iPath, ML, 28, { width: 52, height: 52 });
    }

    // Brand name
    doc.fillColor(WHITE).fontSize(11).font("Helvetica")
       .text("MSAFIRI KENYA", ML + 62, 38, { width: CONTENT - 62 });

    // Guide title
    doc.fillColor(WHITE).fontSize(26).font("Helvetica-Bold")
       .text("Accident Response\nGuide", ML, 78, { width: CONTENT - 60, lineGap: 4 });

    // Tagline
    doc.fillColor("rgba(255,255,255,0.82)").fontSize(11).font("Helvetica")
       .text("Know exactly what to do when it matters most", ML, 160, { width: CONTENT });

    y = HEADER_H + 28;

    // ── SECTION helper ────────────────────────────────────────────────────────
    function sectionHeading(title: string, iconChar: string) {
      // Green left border pill
      doc.rect(ML, y, 4, 22).fill(GREEN);
      doc.fillColor(GREEN).fontSize(13).font("Helvetica-Bold")
         .text(`${iconChar}  ${title}`, ML + 12, y + 3, { width: CONTENT - 12 });
      y += 32;
      doc.fillColor(TEXT_DARK).font("Helvetica").fontSize(10);
    }

    // ── STEP helper (numbered) ────────────────────────────────────────────────
    function step(num: number, title: string, body: string) {
      // Circle number badge
      doc.circle(ML + 10, y + 8, 10).fill(GREEN);
      doc.fillColor(WHITE).fontSize(9).font("Helvetica-Bold")
         .text(String(num), ML + 6, y + 4, { width: 8, align: "center" });

      // Title
      doc.fillColor(TEXT_DARK).fontSize(11).font("Helvetica-Bold")
         .text(title, ML + 26, y, { width: CONTENT - 26 });

      // Body
      const bodyHeight = doc.heightOfString(body, { width: CONTENT - 36, lineGap: 2 });
      doc.fillColor(TEXT_MUTED).fontSize(9.5).font("Helvetica")
         .text(body, ML + 36, y + 15, { width: CONTENT - 36, lineGap: 2 });

      y += 18 + bodyHeight + 10;
    }

    // ── CHECKLIST ITEM ────────────────────────────────────────────────────────
    function checkItem(text: string) {
      doc.rect(ML + 2, y + 1, 9, 9).strokeColor(GREEN).lineWidth(1).stroke();
      doc.fillColor(GREEN).fontSize(9).font("Helvetica-Bold")
         .text("✓", ML + 2, y, { width: 9, align: "center" });
      doc.fillColor(TEXT_DARK).fontSize(10).font("Helvetica")
         .text(text, ML + 18, y, { width: CONTENT - 18, lineGap: 2 });
      y += doc.heightOfString(text, { width: CONTENT - 18, lineGap: 2 }) + 8;
    }

    // ── TIP BOX ───────────────────────────────────────────────────────────────
    function tipBox(text: string) {
      const th = doc.heightOfString(text, { width: CONTENT - 32, lineGap: 3 }) + 20;
      doc.rect(ML, y, CONTENT, th).fill(GREEN_LIGHT);
      doc.rect(ML, y, 4, th).fill(GREEN);
      doc.fillColor(GREEN_DARK).fontSize(10).font("Helvetica-Bold")
         .text("💡 TIP  ", ML + 12, y + 10, { continued: true });
      doc.fillColor(TEXT_DARK).font("Helvetica")
         .text(text, { width: CONTENT - 32, lineGap: 3 });
      y += th + 12;
    }

    // ── DIVIDER ───────────────────────────────────────────────────────────────
    function divider() {
      doc.moveTo(ML, y).lineTo(ML + CONTENT, y).strokeColor(BORDER).lineWidth(0.5).stroke();
      y += 14;
    }

    // ── CONTACT ROW ───────────────────────────────────────────────────────────
    function contactRow(label: string, value: string, color = TEXT_DARK) {
      doc.fillColor(TEXT_MUTED).fontSize(9).font("Helvetica").text(label, ML + 8, y, { width: 140 });
      doc.fillColor(color).fontSize(10).font("Helvetica-Bold").text(value, ML + 152, y, { width: CONTENT - 152 });
      y += 18;
    }

    // =========================================================================
    // SECTION 1 — IMMEDIATE STEPS
    // =========================================================================
    sectionHeading("At the Scene — Immediate Steps", "🚨");

    step(1, "Stop Safely", "Move your vehicle out of traffic if it is safe to do so. Turn on hazard lights immediately. Never leave the scene of an accident.");
    step(2, "Check for Injuries", "Check yourself, your passengers, and anyone else involved. Do not move injured persons unless they are in immediate danger (fire, flooding).");
    step(3, "Call for Help", "Dial 999 for police and emergency services if there are injuries, road blockage, or significant damage. State your location clearly.");
    step(4, "Secure the Scene", "Set up warning triangles or use hazard lights. Keep bystanders at a safe distance. Turn off your engine to prevent fire risk.");
    step(5, "Do Not Admit Liability", "Avoid saying 'sorry' or accepting fault at the scene. Liability is determined by police and insurers — not roadside statements.");
    step(6, "Open Crash Assistant", "Launch Msafiri Kenya → tap the 🛡 icon to open Crash Assistant. It will guide you through documentation step by step.");

    y += 4;
    tipBox("Take photos before any vehicles are moved. Courts and insurers rely on scene photos for liability assessment.");

    divider();

    // =========================================================================
    // SECTION 2 — WHAT TO DOCUMENT
    // =========================================================================
    sectionHeading("What to Collect & Document", "📋");

    doc.fillColor(TEXT_MUTED).fontSize(10).font("Helvetica")
       .text("Use Crash Assistant in the app to capture everything automatically. Use this checklist as a manual backup:", ML, y, { width: CONTENT, lineGap: 3 });
    y += 32;

    checkItem("Scene photos — wide angle, close-ups of damage, skid marks, road signs");
    checkItem("Other vehicle registration number, make, model and colour");
    checkItem("Other driver's name, phone number, ID or driving licence");
    checkItem("Insurance company and policy number of the other vehicle");
    checkItem("Names and contacts of any witnesses");
    checkItem("Police OB (Occurrence Book) number if officers attend the scene");
    checkItem("Your GPS location (Crash Assistant captures this automatically)");
    checkItem("Time of incident and road conditions (wet, potholes, poor lighting)");

    divider();

    // =========================================================================
    // SECTION 3 — CRASH ASSISTANT
    // =========================================================================
    sectionHeading("Using Crash Assistant In-App", "📱");

    doc.fillColor(TEXT_DARK).fontSize(10).font("Helvetica")
       .text("Crash Assistant is built into Msafiri Kenya to make accident documentation fast and thorough:", ML, y, { width: CONTENT, lineGap: 3 });
    y += 22;

    const steps3 = [
      ["Open the app", "Go to Garage → Accident Reports → Create New Report, or tap the shield icon on the drive screen."],
      ["Auto-captured data", "Speed before impact, GPS location, heading, and weather are captured automatically — no manual entry needed."],
      ["Add photos", "Photograph damage, the scene, registration plates, and road conditions directly within the report."],
      ["Record a statement", "Use the voice statement feature to narrate what happened while it is still fresh."],
      ["Add witnesses & other party", "Enter witness details and the other driver's information for your records."],
      ["Generate PDF report", "When complete, export a professional PDF report for your insurer or police statement."],
    ];

    for (const [title, body] of steps3) step(steps3.indexOf([title, body]) + 1, title, body);

    y += 4;
    tipBox("Crash Assistant reports are stored securely in the app. You can share or download them at any time from the Accident Reports screen.");

    // Check if we need a new page
    if (y > PAGE_H - 200) {
      doc.addPage();
      y = 40;
    }

    divider();

    // =========================================================================
    // SECTION 4 — EMERGENCY CONTACTS
    // =========================================================================
    sectionHeading("Emergency Contacts — Kenya", "📞");

    // Contact card background
    const contactH = 150;
    doc.rect(ML, y, CONTENT, contactH).fill(GREEN_LIGHT);
    y += 12;

    contactRow("Emergency Services",  "999",           GREEN_DARK);
    contactRow("Police (Alt)",        "0800 722 203");
    contactRow("Ambulance / KRCS",    "0800 723 253");
    contactRow("AA Kenya Rescue",     "0709 933 000");
    contactRow("Kenyatta Hospital",   "020 272 6300");
    contactRow("Aga Khan Emergency",  "020 366 2000");

    y += 12;

    divider();

    // =========================================================================
    // SECTION 5 — NEXT STEPS (24-48 hrs)
    // =========================================================================
    sectionHeading("Next Steps — Within 24–48 Hours", "📅");

    const nextSteps = [
      ["Notify your insurer", "Report the accident to your insurance company within 24 hours. Provide your OB number, photos, and the other party's details. Delayed reporting may affect your claim."],
      ["Obtain a P3 form if injured", "Visit any government hospital or police station for a P3 form if you or a passenger sustained injuries. This is required for injury compensation claims."],
      ["Follow up on OB number", "Contact the attending police station for a copy of the accident report. You will need this for insurance and potential legal proceedings."],
      ["Get a repair estimate", "Take your vehicle to an approved garage. Your insurer may require their own assessment before authorising repairs."],
      ["Seek medical attention", "Even if you feel fine, some injuries (whiplash, internal bruising) manifest hours later. A medical report protects your legal rights."],
    ];

    for (const [t, b] of nextSteps) {
      step(nextSteps.indexOf([t, b]) + 1, t, b);
    }

    // =========================================================================
    // FOOTER
    // =========================================================================
    if (y < PAGE_H - 80) y = PAGE_H - 80;

    doc.rect(0, PAGE_H - 60, PAGE_W, 60).fill(TEXT_DARK);
    doc.fillColor(WHITE).fontSize(8.5).font("Helvetica-Bold")
       .text("Msafiri Kenya — Drive Smart, Stay Safe", ML, PAGE_H - 44, { width: CONTENT / 2 });
    doc.fillColor("rgba(255,255,255,0.5)").fontSize(7.5).font("Helvetica")
       .text("This guide is for general reference only. Always follow official police and insurer instructions.", ML, PAGE_H - 30, { width: CONTENT });
    doc.fillColor("rgba(255,255,255,0.6)").fontSize(8).font("Helvetica")
       .text("msafirikenya.com", ML + CONTENT - 80, PAGE_H - 44, { width: 80, align: "right" });

    doc.end();
  }) as unknown as Buffer;
}

// ── Route ─────────────────────────────────────────────────────────────────────
router.get("/accident-guide", async (_req: Request, res: Response) => {
  try {
    const pdf = await buildGuide();
    res.set({
      "Content-Type":        "application/pdf",
      "Content-Disposition": 'inline; filename="msafiri-accident-guide.pdf"',
      "Content-Length":      pdf.length,
      "Cache-Control":       "public, max-age=86400",
    });
    res.send(pdf);
  } catch (err) {
    console.error("GET /accident-guide error:", err);
    res.status(500).json({ error: "Could not generate guide" });
  }
});

export default router;
