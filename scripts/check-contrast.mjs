#!/usr/bin/env node
/**
 * check-contrast.mjs — WCAG AA contrast gate for the site palette.
 *
 * Why this exists: on 2026-11-04 the muted token measured 3.01:1 against the
 * parchment background. Every date, every "Jump to:" label and every secondary
 * caption on the site was below the 4.5:1 floor for normal text and looked
 * washed out on a phone in daylight. Nothing caught it, because contrast is a
 * property of a PAIR of colours and no linter reads a CSS variable and works out
 * what it sits on.
 *
 * This script hard-codes the palette pairs that actually ship and fails the
 * build when any of them drops below AA. It reads the real tokens out of
 * BaseLayout.astro so the numbers cannot drift from the stylesheet.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const LAYOUT = path.join(ROOT, "src", "layouts", "BaseLayout.astro");
const src = fs.readFileSync(LAYOUT, "utf8");

/** Pull the first occurrence of a token inside a theme block. */
function token(name, block) {
  const re = new RegExp(`--${name}:\\s*([^;]+);`);
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

/** Split the stylesheet into its light and dark custom-property blocks. */
function themeBlocks(text) {
  const blocks = [];
  // Match a selector then a brace block, allowing newlines before the brace.
  const re = /(:root|\[data-theme="dark"\])\s*\{([\s\S]*?)\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const props = m[2];
    if (props.includes("--color-paper")) {
      blocks.push({ theme: m[1] === ":root" ? "light" : "dark", props });
    }
  }
  return blocks;
}

function hexToRgb(hex) {
  const h = hex.trim().replace("#", "");
  if (h.length !== 6) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function luminance([r, g, b]) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(fg, bg) {
  const a = hexToRgb(fg);
  const b = hexToRgb(bg);
  if (!a || !b) return null;
  const l1 = luminance(a);
  const l2 = luminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

// Pairs that ship on real pages. "need" is the WCAG AA floor: 4.5 for normal
// text, 3.0 for large text (>=24px, or >=18.66px bold) and UI boundaries.
const PAIRS = [
  { fg: "color-ink", bg: "color-paper", need: 4.5, where: "body copy" },
  { fg: "color-ink-light", bg: "color-paper", need: 4.5, where: "secondary copy" },
  { fg: "color-muted", bg: "color-paper", need: 4.5, where: "dates, captions, Jump to" },
  { fg: "color-muted", bg: "color-card-bg", need: 4.5, where: "muted text inside cards" },
  { fg: "color-heading", bg: "color-paper", need: 4.5, where: "page headings" },
  { fg: "color-heading", bg: "color-card-bg", need: 4.5, where: "headings inside cards" },
  { fg: "color-link", bg: "color-paper", need: 4.5, where: "inline links" },
];

const blocks = themeBlocks(src);
if (blocks.length < 2) {
  console.error(`✗ contrast: expected light and dark token blocks in ${path.relative(ROOT, LAYOUT)}, found ${blocks.length}.`);
  process.exit(1);
}

let failures = 0;
let checked = 0;
const report = [];

for (const block of blocks) {
  for (const pair of PAIRS) {
    const fg = token(pair.fg, block.props);
    const bg = token(pair.bg, block.props);
    if (!fg || !bg) continue;
    const ratio = contrast(fg, bg);
    if (ratio === null) continue;
    checked++;
    const pass = ratio >= pair.need;
    if (!pass) failures++;
    report.push({
      theme: block.theme,
      where: pair.where,
      fg: `--${pair.fg} ${fg}`,
      bg: `--${pair.bg} ${bg}`,
      ratio: ratio.toFixed(2),
      need: pair.need.toFixed(1),
      pass,
    });
  }
}

const worst = report.filter((r) => !r.pass).sort((a, b) => a.ratio - b.ratio);

if (failures) {
  console.error("\nGATE FAILED — WCAG AA contrast:");
  for (const r of worst) {
    console.error(`  [${r.theme}] ${r.where}: ${r.fg} on ${r.bg} = ${r.ratio}:1 (needs ${r.need}:1)`);
  }
  console.error(`\n${failures} of ${checked} checked pair(s) below AA.\n`);
  process.exit(1);
}

console.log(`✓ contrast: ${checked} token pair(s) checked across ${blocks.length} themes, all at or above WCAG AA.`);
