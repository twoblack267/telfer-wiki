#!/usr/bin/env node
/**
 * gen-og-images.mjs — per-person Open Graph share cards.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every page on the site emitted the SAME og:image (/telferwiki-og.png). So a
 * person page shared to Facebook, Reddit or a genealogy forum rendered as the
 * generic site logo — identical for all 412 people, and no reason for anyone
 * to click. This generates a distinct 1200x630 card per person at build time.
 *
 * DESIGN (owner ruling, 25 Oct 2026): name + years + generation, on the site's
 * own palette (src/styles/theme.css, Catppuccin Latte light mode). No photos.
 * Text-only deliberately — it stays consistent and it never leaks a portrait of
 * a living person onto a public share card.
 *
 * OUTPUT
 * ------
 *   public/og/<slug>.png          (committed; served publicly)
 *   src/data/og-images.json       (slug -> "/og/<slug>.png", committed)
 *
 * The map is committed for the same reason as lastmod.json: CI must not need
 * anything that only exists on this machine. A slug absent from the map gets no
 * og:image override and falls back to the site-wide card — never a broken URL.
 *
 * PRIVACY
 * -------
 * NOINDEX_SLUGS / PRIVACY_STRIP_SLUGS people get NO card generated, so a
 * withdrawn person cannot be shared with their own name drawn on the preview.
 *
 * REGENERATE after a vault change:  node scripts/gen-og-images.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { PRIVACY_STRIP_SLUGS, NOINDEX_SLUGS } from "../src/data/privacy-exclusions.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(ROOT, "public/og");
const MAP_FILE = resolve(ROOT, "src/data/og-images.json");

const W = 1200;
const H = 630;

// Palette — copied verbatim from src/styles/theme.css (Latte light mode).
const C = {
  paper: "#eff1f5",
  paperDark: "#e6e9ef",
  ink: "#4c4f69",
  inkLight: "#6c6f85",
  accent: "#dc8a78",
  heading: "#8839ef",
  highlight: "#df8e1d",
  border: "#acb0be",
  surface: "#ccd0da",
  muted: "#9ca0b0",
  cardBg: "#ffffff",
};

// ── text measurement without a font parser ────────────────────────────────
// Helvetica-ish average advance is ~0.52em for mixed case. We deliberately
// over-estimate so long names shrink rather than overflow the card edge.
const avgAdvance = 0.55;
function fitFontSize(text, maxWidth, startSize, minSize = 34) {
  let size = startSize;
  while (size > minSize && text.length * size * avgAdvance > maxWidth) size -= 2;
  return size;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Wrap a string into lines whose estimated width fits maxWidth at fontSize. */
function wrap(text, maxWidth, fontSize, maxLines = 2) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length * fontSize * avgAdvance > maxWidth && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    } else {
      cur = next;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (!lines.length) lines.push("");
  return lines;
}

function lifespanText(p) {
  const b = p.birth_year_display || (p.birth_year ? String(p.birth_year) : "");
  const d = p.death_year_display || (p.death_year ? String(p.death_year) : "");
  if (p.is_living) return b ? `b. ${b}` : "Living";
  if (b && d) return `${b} – ${d}`;
  if (b) return `b. ${b}`;
  if (d) return `d. ${d}`;
  return "";
}

const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];

function generationText(p) {
  const g = Number(p.generation);
  if (!Number.isFinite(g) || g < 1) return "";
  const label = ORDINAL[g] || `${g}th`;
  return `${label} generation`;
}

/** Build the SVG for one person. Returned as a string; sharp rasterises it. */
function cardSvg(p) {
  const name = p.display_name || "Telfer";
  const life = lifespanText(p);
  const gen = generationText(p);

  // Name: shrink to fit one or two lines inside the 1000px safe area.
  const nameSize = fitFontSize(name, 1000, 84, 40);
  const nameLines = wrap(name, 1000, nameSize, name.length * nameSize * avgAdvance > 1000 ? 2 : 1);
  const nameY = nameLines.length === 2 ? 268 : 300;
  const lineHeight = nameSize * 1.14;

  const nameTspans = nameLines
    .map((ln, i) => `<tspan x="100" y="${nameY + i * lineHeight}">${esc(ln)}</tspan>`)
    .join("");

  // Chips row, vertically below the name block.
  const chipsY = nameY + (nameLines.length - 1) * lineHeight + 60;
  let chipX = 100;
  let chips = "";

  const chip = (text, fill, color) => {
    const w = text.length * 15.5 + 44;
    const svg = `
      <rect x="${chipX}" y="${chipsY - 34}" rx="26" ry="26" width="${w}" height="52"
            fill="${fill}" stroke="${C.border}" stroke-opacity="0.5" />
      <text x="${chipX + w / 2}" y="${chipsY + 2}" font-family="Helvetica Neue, Helvetica, Arial"
            font-size="23" font-weight="600" fill="${color}" text-anchor="middle"
            letter-spacing="0.6">${esc(text)}</text>`;
    chipX += w + 16;
    return svg;
  };

  if (life) chips += chip(life, C.cardBg, C.ink);
  if (gen) chips += chip(gen, C.cardBg, C.heading);
  if (p.is_living) chips += chip("Living", C.cardBg, C.highlight);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="wash" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${C.paper}" />
      <stop offset="100%" stop-color="${C.paperDark}" />
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#wash)" />
  <!-- decorative rule across the top: accent + heading + highlight -->
  <rect x="0" y="0" width="${W}" height="10" fill="${C.accent}" />
  <rect x="${W * 0.42}" y="0" width="${W * 0.30}" height="10" fill="${C.heading}" />
  <rect x="${W * 0.82}" y="0" width="${W * 0.18}" height="10" fill="${C.highlight}" />

  <!-- eyebrow -->
  <text x="100" y="152" font-family="Helvetica Neue, Helvetica, Arial" font-size="24"
        font-weight="700" fill="${C.accent}" letter-spacing="4.5">TELFER FAMILY WIKI</text>

  <!-- name -->
  <text font-family="Georgia, Times New Roman, serif" font-size="${nameSize}"
        font-weight="700" fill="${C.ink}">${nameTspans}</text>

  ${chips}

  <!-- footer -->
  <line x1="100" y1="${H - 112}" x2="${W - 100}" y2="${H - 112}"
        stroke="${C.surface}" stroke-width="2" />
  <text x="100" y="${H - 58}" font-family="Helvetica Neue, Helvetica, Arial" font-size="26"
        font-weight="600" fill="${C.inkLight}">Nine generations &#183; Scotland to South Australia</text>
  <text x="${W - 100}" y="${H - 58}" font-family="Helvetica Neue, Helvetica, Arial" font-size="26"
        font-weight="700" fill="${C.heading}" text-anchor="end">telferwiki.com</text>
</svg>`;
}

async function main() {
  const only = process.argv.includes("--sample") ? process.argv[process.argv.indexOf("--sample") + 1] : null;

  const people = JSON.parse(readFileSync(resolve(ROOT, "src/data/people.public.json"), "utf-8"));
  const exclude = new Set([...PRIVACY_STRIP_SLUGS, ...NOINDEX_SLUGS]);

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const map = {};
  let made = 0;
  let skipped = 0;

  const targets = only ? people.filter((p) => p.slug === only) : people;
  if (only && !targets.length) {
    console.error(`No person with slug "${only}"`);
    process.exit(1);
  }

  for (const p of targets) {
    if (!p.slug) continue;
    if (exclude.has(p.slug)) {
      skipped++;
      continue;
    }
    const outPath = resolve(OUT_DIR, `${p.slug}.png`);
    await sharp(Buffer.from(cardSvg(p))).png({ compressionLevel: 9, palette: true }).toFile(outPath);
    map[p.slug] = `/og/${p.slug}.png`;
    made++;
  }

  // Only rewrite the committed map on a full run — a --sample run must not
  // truncate the map to one entry.
  if (!only) {
    const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(MAP_FILE, JSON.stringify(sorted, null, 0) + "\n");
    console.log(`gen-og-images: wrote ${made} cards, skipped ${skipped} privacy-withheld, map at ${MAP_FILE}`);
  } else {
    console.log(`gen-og-images: sample card for ${only} at public/og/${only}.png`);
  }
}

main().catch((e) => {
  console.error("gen-og-images failed:", e);
  process.exit(1);
});
