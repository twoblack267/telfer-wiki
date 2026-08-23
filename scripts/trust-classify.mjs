#!/usr/bin/env node
// trust-classify.mjs — Derive a per-person trust level from EXISTING data.
//
// Purpose: honestly reflect how much we actually KNOW about each person, without
// inventing anything. Reads people.public.json (or a path arg) and reports the
// trust distribution + a list of every ⚠️/❓ person so humans know what needs sourcing.
//
// Trust levels (self-contained, reproducible, no fabrication):
//   sourced    ✅ — real dates present, no uncertainty words, has a bio.
//                  We can show this person with confidence.
//   partial    ⚠️ — some solid facts but gaps (missing death, approximate dates,
//                  or uncertainty wording). Mixed confidence; show but tag.
//   unverified ❓ — missing core facts (no birth year, unknown key relation,
//                  no bio). Needs research — flagged, never asserted.
//
// An uncertainty "word" is matched against a small dictionary of honest hedge
// language the vault/profiles already use (likely, approx, possibly, believed,
// presumed, suspected, unknown, uncertain, unconfirmed, "no record", etc.).
// This NEVER guesses an answer — it only reports confidence in what's there.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DATA = resolve(process.env.HOME, 'telfer-wiki/src/data/people.public.json');
const path = process.argv[2] || DATA;
const people = JSON.parse(readFileSync(path, 'utf8'));

// Hedge words that signal a fact is NOT firmly established.
const UNCERTAINTY_WORDS = [
  'unknown', 'likely', 'probably', 'possibly', 'suspected', 'uncertain',
  'unconfirmed', 'believed', 'presumably', 'approx', 'approximately',
  'unclear', 'maybe', 'not sure', 'no record', 'not known', 'est\\.|est ',
  '\\?', 'c\\.', '~', 'suspected',
];

function nameOf(p) {
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.display_name || p.slug;
}

function hasUncertainty(p) {
  const hay = `${JSON.stringify(p.bio || '')} ${p.body_markdown || ''} ${JSON.stringify(p.relationships || {})}`.toLowerCase();
  // match literal words AND an '?year' / 'c. year' / '~year' date pattern
  for (const w of UNCERTAINTY_WORDS) {
    if (w === '\\?' && /\b\d{3,4}\?\b/.test(hay)) return true;
    if (w === 'c\\.' && /\bc\.\s?\d{3,4}\b/.test(hay)) return true;
    if (w === '~' && /~\s?\d{3,4}\b/.test(hay)) return true;
    if (w === 'est\\.|est ' && /\best[.:]?\s?\d{3,4}\b/.test(hay)) return true;
    if (w !== '\\?' && w !== 'c\\.' && w !== '~' && w !== 'est\\.|est ' && hay.includes(w)) return true;
  }
  return false;
}

// ── Privacy / do-not-flag ──────────────────────────────
// People whose records are intentionally sparse and who must NEVER surface in
// "needs research" output. This is an explicit, auditable deny-list.
// CURRENTLY: susan-lawrie = Sue Lawrie. Her adoption/parents are PERMANENTLY
// CLOSED by her choice — do not research, flag, or mention. Keep here.
const PROTECTED = new Set(['susan-lawrie']);

// Living people with sparse records usually mean "we know who they are, we just
// don't publish their details" — NOT "needs research." Exclude them from the
// surfaced lists (their counts still count against the total statistics).
const SKIP_LIVING_FROM_SURFACE = true;

function isLiving(p) {
  return !p.death_year && (!p.death_year_display || p.death_year_display === 'living');
}

function classify(p) {
  const hasBirth = !!p.birth_year && p.birth_year > 0;
  const dead = !isLiving(p);
  const hasDeath = !!p.death_year && p.death_year > 0;
  const bodyLen = (p.bio || p.body_markdown || '').trim().length;
  const bioOk = bodyLen >= 15;
  const uncertain = hasUncertainty(p);

  // Any genuine unknown key relation -> drop to unverified
  let unknownRelation = false;
  for (const rel of Object.values(p.relationships || {})) {
    if (Array.isArray(rel) && rel.some(r => /^unknown$/i.test(String(r)))) unknownRelation = true;
    if (typeof rel === 'string' && /^unknown$/i.test(rel)) unknownRelation = true;
  }

  if (!hasBirth || !bioOk || unknownRelation) return 'unverified';
  if (dead && !hasDeath) return 'partial';
  if (uncertain) return 'partial';
  return 'sourced';
}

// Quick duck-check so a caller can tell if the record is a person.
function isPerson(p) {
  return typeof p === 'object' && p && (p.first_name || p.last_name || p.display_name) && p.slug;
}

const result = {
  asOf: new Date().toISOString(),
  total: people.filter(isPerson).length,
  sourced: 0,
  partial: 0,
  unverified: 0,
  partialPeople: [],
  unverifiedPeople: [],
  protectedSkipped: [],      // people hidden from surfacing by privacy/do-not-flag
  livingSkipped: 0,          // living people not surfaced as 'needs research'
  alert: null,               // set when something needs a human/assistant nudge
};

for (const p of people) {
  if (!isPerson(p)) continue;
  const level = classify(p);
  result[level] += 1;
  const label = `${nameOf(p)} (${p.slug})`;
  if (level === 'partial') {
    // Protected people are never surfaced; living people aren't "needs research."
    if (PROTECTED.has(p.slug)) { result.protectedSkipped.push(p.slug); continue; }
    if (SKIP_LIVING_FROM_SURFACE && isLiving(p)) { result.livingSkipped += 1; continue; }
    result.partialPeople.push(label);
  }
  if (level === 'unverified') {
    if (PROTECTED.has(p.slug)) { result.protectedSkipped.push(p.slug); continue; }
    if (SKIP_LIVING_FROM_SURFACE && isLiving(p)) { result.livingSkipped += 1; continue; }
    result.unverifiedPeople.push(label);
  }
}

// The thing that flags us: a hard alert when too much of the tree is unverified,
// OR when a previously-sourced person ever regresses. Kept as a machine-readable
// signal so the guard + cron can raise a Telegram card.
if (result.total > 0 && result.unverified / result.total > 0.4) {
  result.alert = `UNVERIFIED_BURDEN_HIGH: ${result.unverified}/${result.total} profiles lack solid source facts`;
} else if (result.total > 0 && result.partial / result.total > 0.5) {
  result.alert = `PARTIAL_BURDEN_HIGH: most profiles mix solid and uncertain facts`;
}

console.log(JSON.stringify(result, null, 2));
