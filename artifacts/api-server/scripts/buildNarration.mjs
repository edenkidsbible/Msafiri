/**
 * Builds TTS-ready narration for every driving course lesson.
 *
 * PDF extraction artefacts fixed:
 *  1. No terminal punctuation on list items → Flash reads them as one stream.
 *  2. "(a)…(b)…(c)…" category labels fused into one paragraph string.
 *  3. Sub-items space-joined: "No through road on ahead No through road on right"
 *  4. Repeated-phrase lists: "I intend to X I intend to Y I intend to Z"
 *  5. Wide whitespace gaps from PDF column layout.
 *  6. Category header fused with its first action item:
 *     "…to traffic police I intend to move left"
 *  7. Typo "Iam" / "iam" → "I am".
 *
 * Pipeline (recursive per piece):
 *  A. Fix typos (depth 0 only).
 *  B. Split on (b)(c)… parenthetical markers (depth 0 only).
 *  C. Wide whitespace split (≥4 spaces — PDF column artefact).
 *  D. Repeated n-gram (scan ALL positions, not just position 0).
 *  E. Action-phrase split ("…header I intend to X" → header + item).
 *  F. Inline colon-list ("Triangle: Warning Circle: Giving an order").
 *  G. ensurePeriod fallback.
 */

import pg from 'pg';
import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query(
  `SELECT id, slug, title, content FROM course_lessons ORDER BY id`
);

/* ─────────────────────────────── helpers ─────────────────────────── */

const TERMINAL_RE = /[.!?]$/;
const PAREN_SPLIT_RE = /\s+(?=\([b-z]\)\s)/gi;

// Common n-gram starters that are coincidental, not list boundaries
const SKIP_STARTS = /^(and|or|the|a|an|of|in|to|is|are|was|were|be|been|it|this|that|by|at|on|for|with|as|from)\b/i;

function ensurePeriod(s) {
  const t = s.trim();
  if (!t) return '';
  return TERMINAL_RE.test(t) ? t : t + '.';
}

/** Step A – fix known PDF typos. */
function fixTypos(s) {
  return s
    .replace(/\bIam\b/g, 'I am')
    .replace(/\biam\b/g, 'I am');
}

/** Step D – find ANY n-gram (len 2–4) appearing 3+ times, scanning all positions. */
function findRepeatingNgram(text) {
  const words = text.split(/\s+/);
  for (let n = 4; n >= 2; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const candidate = words.slice(i, i + n).join(' ');
      if (SKIP_STARTS.test(candidate)) continue;
      const esc = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const hits = [...text.matchAll(new RegExp(`\\b${esc}\\b`, 'gi'))];
      if (hits.length >= 3) return esc;
    }
  }
  return null;
}

/** Step F – "Word: Desc Word: Desc" inline colon-list. */
function splitInlineColonList(text) {
  const hits = [...text.matchAll(/\b([A-Z][a-zA-Z]*):\s/g)];
  if (hits.length < 2) return null;
  const parts = text.split(/(?<=\S)\s+(?=[A-Z][a-zA-Z]*:\s)/g);
  return parts.length >= 2
    ? parts.map(p => ensurePeriod(p.trim())).filter(Boolean)
    : null;
}

/**
 * Core recursive text-breaking function.
 * Tries each split in priority order; on success, recurses into each piece.
 * depth guards against infinite recursion.
 */
function breakText(raw, depth = 0) {
  if (depth > 5) return [ensurePeriod(raw)];

  const text = (depth === 0 ? fixTypos(raw) : raw).trim();
  if (!text) return [];

  // Already well-punctuated and not too long → keep
  if (TERMINAL_RE.test(text) && text.length < 250) return [text];

  // B: parenthetical split — only at the top level so we don't re-split inside parts
  if (depth === 0) {
    const parenParts = text.split(PAREN_SPLIT_RE).map(p => p.trim()).filter(Boolean);
    if (parenParts.length > 1) return parenParts.flatMap(p => breakText(p, 1));
  }

  // C: wide whitespace (PDF column gaps — ≥4 spaces)
  if (/ {4,}/.test(text)) {
    const parts = text.split(/ {4,}/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) return parts.flatMap(p => breakText(p, depth + 1));
  }

  // D: repeated n-gram (handles "No through road on ahead No through road on right")
  const esc = findRepeatingNgram(text);
  if (esc) {
    const splitRe = new RegExp(`(?<=\\S)\\s+(?=${esc}\\b)`, 'gi');
    const parts = text.split(splitRe).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) return parts.flatMap(p => breakText(p, depth + 1));
  }

  // E: inline colon-list ("A: RED means STOP  B: RED and AMBER…" or "Triangle: Warning Circle: …")
  // Run BEFORE action-phrase so "STOP" inside "A: … STOP  B: …" doesn't get split first.
  const colonResult = splitInlineColonList(text);
  if (colonResult && colonResult.length > 1) return colonResult;

  // F: action-phrase split — separates "Category header I intend to / Come on / STOP / Keep"
  // from the first list item even when that item only appears once in this piece
  {
    const ACTION_RE = /(?<=\S)\s+(?=I (?:intend|want|am)\b|Come on\b|STOP\b|Keep (?:coming\b)?|All vehicles\b|Not ready\b|Barrier\b|Ready to cross\b)/g;
    const parts = text.split(ACTION_RE).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) return parts.flatMap(p => breakText(p, depth + 1));
  }

  // Fallback
  return [ensurePeriod(text)];
}

/* ─────────────────────────────── narration builder ──────────────── */

function buildNarration(content) {
  const blockGroups = [];

  for (const block of content) {
    if (block.type === 'image') continue;

    if (block.type === 'list') {
      const sentences = (block.items || [])
        .map(i => ensurePeriod(fixTypos(String(i).trim())))
        .filter(Boolean);
      if (sentences.length) blockGroups.push(sentences.join('\n'));
      continue;
    }

    const sentences = breakText(block.text || '');
    if (sentences.length) blockGroups.push(sentences.join('\n'));
  }

  // Blank line between blocks = breath-group pause in Flash v2.5
  return blockGroups.join('\n\n');
}

/* ─────────────────────────────── main ───────────────────────────── */

const results = rows.map(row => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  narration: buildNarration(row.content),
  charCount: buildNarration(row.content).length,
}));

const totalChars = results.reduce((s, r) => s + r.charCount, 0);
console.log(`Built narration for ${results.length} lessons — ${totalChars.toLocaleString()} chars`);
console.log(`Flash v2.5 cost estimate: ~$${(totalChars * 0.00005).toFixed(2)}\n`);

const outPath = join(__dirname, '../../../attached_assets/narration_texts.json');
await writeFile(outPath, JSON.stringify(results, null, 2));
console.log(`Written: ${outPath}\n`);

// Spot-check the most problematic lessons
const checks = [
  'unit-22-traffic-signs-traffic-signs',
  'unit-09-communication-on-the-road-signals-given-by-road-users',
  'unit-09-communication-on-the-road-traffic-light-signals',
  'unit-12-emergency-manoeuvres-safely-performing-evasive-turns-on-the-road',
];

for (const slug of checks) {
  const r = results.find(x => x.slug === slug);
  if (!r) continue;
  console.log(`${'─'.repeat(60)}\nLESSON: ${r.title}\n${'─'.repeat(60)}`);
  console.log(r.narration.substring(0, 1000));
  if (r.narration.length > 1000) console.log('  […]\n');
  else console.log('');
}

await client.end();
