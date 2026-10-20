#!/usr/bin/env node
/**
 * live-photo-sentinel-card — files the 7am Can Do Board card for the OUTSIDE
 * photo check.
 *
 * Design rule (deliberate): the local model is NOT allowed to decide whether a
 * photo is missing. That verdict is deterministic — an <img> exists or it does
 * not, a URL returns bytes or it does not, and a model that "has an opinion"
 * about that would silently override a hard fact with a guess.
 *
 * The model's only job is to write the plain-English diagnosis a tired human
 * reads at 7am: what broke, in this website's terms, and which of the three
 * known causes it most likely is. If the model is unavailable or waffles, the
 * deterministic text is used instead — the card must never fail to file just
 * because the language model is having a moment.
 *
 * Usage: node scripts/live-photo-sentinel-card.mjs --input /tmp/sentinel.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const INPUT = getArg('--input', null);
const MODEL = process.env.SENTINEL_MODEL || 'qwen3.5-bender:latest';
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

if (!INPUT || !existsSync(INPUT)) {
  console.error('❌ live-photo-sentinel-card: --input <sentinel json> required');
  process.exit(2);
}
const data = JSON.parse(readFileSync(INPUT, 'utf8'));

// Nothing to file for a clean run or an outage (an outage is not photo loss,
// and the uptime path owns that — filing a photo card for it would be a lie).
if (data.ok) { console.log('✅ sentinel clean — no card needed'); process.exit(0); }
if (data.site_down) {
  console.log('⚠️  site unreachable — this is an OUTAGE, not photo loss. No photo card filed.');
  process.exit(0);
}

const failures = data.failures || [];
if (failures.length === 0) { console.log('ℹ️  no photo failures to file'); process.exit(0); }

const VERDICT_MEANING = {
  PHOTO_MISSING:      'the page loaded fine but carries no image element at all — the photo is gone from the generated markup',
  PHOTO_UNREACHABLE:  'the image is referenced by the page but the file itself did not come back (HTTP error or empty body)',
  PHOTO_ZERO_WIDTH:   'the image element exists but decoded to zero width — a broken or wrong src in the markup',
  PHOTO_PARTIAL:      'the page shows fewer photos than the profile is supposed to carry — a silent partial loss',
  PAGE_UNAVAILABLE:   'the person page itself returned a non-200 status',
  ERROR:              'the page could not be loaded at all',
};

const factLines = failures.map((f) =>
  `- ${f.slug}: ${f.verdict} — ${VERDICT_MEANING[f.verdict] || f.detail}. Observed: ${f.detail}`
).join('\n');

// ── model: write the diagnosis only, with a hard timeout ───────────────────
async function diagnose() {
  const prompt =
`You are writing a one-paragraph diagnosis for a family-history website's owner.
A browser-based check just loaded the LIVE public page and found missing photographs.

FACTS (do not dispute these, they are measured):
${factLines}

The site is generated from an Obsidian vault: a photo must exist in the vault's
"Family History/People/Photos" folder AND be embedded in the person's note as
![[Family History/People/Photos/<name>.jpg]]. A nightly rebuild regenerates the
site data from those embeds. Three known causes:
1. the ![[...]] embed was removed or renamed in the note (most common),
2. the photo file was moved or deleted from the vault folder,
3. the build/deploy failed or served stale files.

Write 2-3 sentences, plain English, no lists, no markdown, naming the most likely
cause and the single first thing to check. Do not invent details. Do not claim to
know which photo it was unless the facts say. Start with "Most likely".`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const r = await fetch(`${OLLAMA}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, stream: false, think: false, options: { num_predict: 180, temperature: 0.3 } }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return { text: null, why: `ollama HTTP ${r.status}` };
    const j = await r.json();
    let t = (j.response || '').trim();
    // qwen sometimes prefixes with the word or brackets; keep it clean
    t = t.replace(/^["'\s]+|["'\s]+$/g, '');
    if (t.length < 40) return { text: null, why: `model returned too little (${t.length} chars)` };
    return { text: t, why: null };
  } catch (e) {
    clearTimeout(timer);
    return { text: null, why: String(e.message || e).slice(0, 120) };
  }
}

const model = await diagnose();
const diagnosis = model.text
  ? model.text
  : `Most likely the ![[...]] photo embed was removed or renamed in the vault note, so the nightly rebuild regenerated the page without it. Check the profile's note in Obsidian first, then the Photos folder.`;

const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const TASKS_DIR = path.join(os.homedir(), '.hermes/kanban/tasks');
if (!existsSync(TASKS_DIR)) mkdirSync(TASKS_DIR, { recursive: true });

let n = 1;
let cardId = `live-photo-sentinel-${TODAY}-${n}`;
while (existsSync(path.join(TASKS_DIR, `${cardId}.yaml`))) { n++; cardId = `live-photo-sentinel-${TODAY}-${n}`; }

const pageList = failures.map((f) => `  - ${f.slug}: ${f.url}`).join('\n');

const yaml = `id: ${cardId}
title: "Live photo check FAILED — ${failures.length} page(s) missing photos: ${failures.map((f) => f.slug).join(', ')}"
date: ${new Date().toISOString().slice(0, 10)}
severity: high
source: "Skippy — live-photo-sentinel (ego lite browser, qwen3.5-bender diagnosis)"
status: Backlog

# THE LIVE PUBLIC SITE WAS CHECKED IN A REAL BROWSER
checked_at: "${data.checked_at}"
sampled: "${data.checked} of ${data.pool_size} photo-bearing pages"
model_diagnosis_used: ${model.text ? 'true' : 'false'}

# WHAT WAS FOUND (measured, not inferred)
failures:
${failures.map((f) => `  - slug: ${f.slug}\n    verdict: ${f.verdict}\n    detail: "${String(f.detail).replace(/"/g, "'").slice(0, 300)}"\n    url: ${f.url}`).join('\n')}

# WHY THIS MATTERS
description: >
  This is the OUTSIDE check. Every other photo guard reads our own data, our own
  build output and our own vault — so if the build is wrong in the same way the
  guard is wrong, they agree with each other and both stay silent. That is how a
  headstone once sat missing for two months with every gate reporting CLEAN.
  This check loads the live public page in a real browser and asks what a visitor
  would actually see.

# DIAGNOSIS
diagnosis: >
  ${(model.text ? model.text : diagnosis).replace(/\n/g, ' ')}

# REQUESTED ACTION
suggested_action: >
  1) Open the page(s) below and confirm the photo really is absent to a visitor.
  2) Check the person's note in Obsidian for a ![[Family History/People/Photos/<name>.jpg]] embed.
  3) If the embed is missing, re-add it, then run: bash scripts/regenerate-data.sh
  4) If the embed is there but the photo 404s, the file itself is missing from the
     vault Photos folder — restore it from git history if necessary.
  5) Rebuild and confirm this check passes: node scripts/live-photo-sentinel.mjs

# PAGES
${pageList}

# NOTES
  If this card appears when the whole site is down, it is a false alarm: the check
  exits 3 and files nothing for an outage. Photo faults exit 1 and file this card.
`;

writeFileSync(path.join(TASKS_DIR, `${cardId}.yaml`), yaml);
console.log(`📌 FIRED card ${cardId} — live photos missing on: ${failures.map((f) => f.slug).join(', ')}`);
console.log(`   model diagnosis: ${model.text ? `qwen3.5-bender (${MODEL})` : `FALLBACK (${model.why})`}`);
console.log(`   Card: ${TASKS_DIR}/${cardId}.yaml → surfaces in the 7am Morning Can Do Board Check`);
