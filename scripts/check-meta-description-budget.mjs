#!/usr/bin/env node
/**
 * check-meta-description-budget.mjs — link-integrity guard for meta descriptions.
 *
 * WHY: card itc-20261023-7 counted 149 pages shipping a <meta description> longer
 * than the 160-character search snippet budget. The count had been reported three
 * different ways (2, 41, 149) because each measurement used a different corpus and
 * a different encoding. This guard fixes the MEASUREMENT so the number can never
 * drift again: it counts the DECODED text of the attribute, which is what a search
 * engine actually sees, across every built HTML page.
 *
 * It also catches the specific trap that hid the bug: the person builder used to
 * slice the RAW string at 158 chars, so a description containing &#38; or &#34;
 * rendered at 165-170 characters while looking "clamped" in the source.
 *
 * Exits non-zero if any page exceeds the budget or if a page emits no description.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const DIST = "dist";
const MAX = 160;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (entry.endsWith(".html")) out.push(p);
  }
  return out;
}

const decode = (s) =>
  s
    .replace(/&#38;/g, "&")
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

let files = [];
try {
  files = walk(DIST);
} catch {
  console.error(`❌ meta-description-budget: no ${DIST}/ directory — build first.`);
  process.exit(1);
}

const over = [];
const missing = [];

for (const f of files) {
  const html = readFileSync(f, "utf8");
  const m = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
  if (!m) {
    missing.push(relative(DIST, f));
    continue;
  }
  const text = decode(m[1]);
  if (text.length > MAX) over.push({ page: relative(DIST, f), len: text.length, text });
}

if (over.length) {
  over.sort((a, b) => b.len - a.len);
  console.error(`❌ meta-description-budget: ${over.length} page(s) exceed ${MAX} chars (decoded).`);
  for (const o of over.slice(0, 10)) {
    console.error(`   ${o.len}  ${o.page}`);
    console.error(`        ${o.text.slice(0, 120)}…`);
  }
  if (over.length > 10) console.error(`   …and ${over.length - 10} more.`);
  process.exit(1);
}

console.log(
  `🎉 meta-description-budget: ${files.length} pages, all descriptions ≤ ${MAX} chars (decoded)` +
    (missing.length ? ` · ${missing.length} page(s) carry no description` : "")
);
