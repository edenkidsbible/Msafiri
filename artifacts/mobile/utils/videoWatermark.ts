/**
 * videoWatermark.ts
 *
 * Burns a metadata watermark (location, date/time, vehicle, speed) into a
 * video file using FFmpegKit.  Falls back gracefully in Expo Go (where native
 * modules are unavailable) by returning the original file path unchanged.
 *
 * The output file is written next to the input with a "_wm" suffix.
 */

import * as FileSystem from "expo-file-system/legacy";

export interface WatermarkMeta {
  locationName?: string;
  startedAt: number;       // epoch ms
  vehicleName?: string;
  plate?: string;
  speedKmh?: number;
}

/** Format epoch-ms to "DD Mon YYYY  HH:MM" for the watermark stamp. */
function fmtWmDate(ms: number): string {
  const d = new Date(ms);
  const day = String(d.getDate()).padStart(2, "0");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const mon  = months[d.getMonth()];
  const yr   = d.getFullYear();
  const hh   = String(d.getHours()).padStart(2, "0");
  const mm   = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${mon} ${yr}  ${hh}:${mm}`;
}

/**
 * Escape characters that are special inside an ffmpeg drawtext `text=` value.
 * Colons, equals-signs, and single-quotes must be escaped.
 */
function escapeDrawtext(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/=/g, "\\=");
}

/**
 * Burns the watermark into `inputPath` and writes the result to `outputPath`.
 * Returns true on success, false if FFmpegKit is unavailable or transcoding
 * fails (caller should fall back to saving the original file).
 */
export async function burnWatermark(
  inputPath: string,
  outputPath: string,
  meta: WatermarkMeta,
): Promise<boolean> {
  // Dynamic import so Expo Go (which can't load native modules) doesn't crash.
  let FFmpegKit: any;
  try {
    const mod = await import("ffmpeg-kit-react-native");
    FFmpegKit = mod.FFmpegKit;
  } catch {
    // Native module not available (Expo Go / web).
    return false;
  }

  // ── Build watermark lines ─────────────────────────────────────────────────

  const lines: string[] = [];

  if (meta.locationName) {
    lines.push(escapeDrawtext(`📍 ${meta.locationName}`));
  }
  lines.push(escapeDrawtext(`🗓 ${fmtWmDate(meta.startedAt)}`));

  const vehicleParts: string[] = [];
  if (meta.vehicleName) vehicleParts.push(meta.vehicleName);
  if (meta.plate)       vehicleParts.push(meta.plate);
  if (vehicleParts.length) lines.push(escapeDrawtext(`🚗 ${vehicleParts.join(" · ")}`));

  if (meta.speedKmh != null) {
    lines.push(escapeDrawtext(`💨 ${Math.round(meta.speedKmh)} km/h at start`));
  }

  // ── Build drawtext filter chain ───────────────────────────────────────────
  // Stack each line vertically from the bottom-left corner.
  // Line height ≈ 28 px at font size 18; we start at (y=H-16) for the last
  // line and move upward by ~28 px per line.

  const fontSize   = 18;
  const lineHeight = 28;
  const pad        = 14;   // px from bottom / left edge
  const totalLines = lines.length;

  const drawFilters = lines.map((text, i) => {
    // i=0 is the top-most of the watermark block; i=totalLines-1 is the bottom.
    const yOffset = (totalLines - 1 - i) * lineHeight + pad;
    return (
      `drawtext=text='${text}'` +
      `:fontsize=${fontSize}` +
      `:fontcolor=white` +
      `:shadowcolor=black@0.8` +
      `:shadowx=1:shadowy=1` +
      `:box=1:boxcolor=black@0.45:boxborderw=4` +
      `:x=${pad}` +
      `:y=H-${yOffset}`
    );
  });

  const vfString = drawFilters.join(",");

  // Strip file:// prefix that Expo's FileSystem sometimes adds.
  const clean = (p: string) => p.replace(/^file:\/\//, "");

  const cmd = [
    `-y`,
    `-i "${clean(inputPath)}"`,
    `-vf "${vfString}"`,
    `-codec:a copy`,
    `-preset ultrafast`,
    `"${clean(outputPath)}"`,
  ].join(" ");

  try {
    const session = await FFmpegKit.execute(cmd);
    const rc      = await session.getReturnCode();
    // ReturnCode 0 = success in ffmpeg-kit-react-native.
    return rc != null && String(rc.getValue()) === "0";
  } catch {
    return false;
  }
}

/**
 * High-level helper: watermark `srcPath`, write to a sibling temp file, and
 * return the output path.  Returns `srcPath` unchanged if watermarking fails.
 */
export async function watermarkedPath(
  srcPath: string,
  meta: WatermarkMeta,
): Promise<string> {
  const outPath = srcPath.replace(/\.mp4$/i, "_wm.mp4");
  const success = await burnWatermark(srcPath, outPath, meta);
  if (success) {
    // Verify the output exists and has non-zero size.
    const info = await FileSystem.getInfoAsync(outPath).catch(() => ({ exists: false } as any));
    if (info.exists && (info as any).size > 0) {
      return outPath;
    }
  }
  return srcPath;
}
