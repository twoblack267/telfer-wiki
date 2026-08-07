#!/usr/bin/env node
/**
 * merge-duplicates.mjs
 * Deterministic merge of known duplicate person records in people.json.
 *
 * Operates on src/data/people.json in place. Prints a summary. Does NOT push.
 *
 * MERGE PLAN (reviewed by Mark/Hermes 2026-08-07):
 *
 * 1. AMY ELLEN TELFER
 *    keeper  : amy-telfer-1884   (1884–1951, real parents, full bio)
 *    shell   : amy-ellen-telfer  (no dates, parents "???", "née Provis" detail)
 *    action  : keep keeper; fold the unique "née Provis" marriage footnote into
 *              keeper's body; fix "Mark's great-grandmother" role (naming rule); delete shell.
 *
 * 2. HANNAH PEACOCK
 *    keeper  : hannah-peacock-1840   (1840–1915)
 *    shell   : hannah-peacock-living  (no dates, identical stub)
 *    action  : delete shell. No unique data to preserve.
 *
 * 3. MARY ANNE MCINTYRE
 *    keeper  : mary-anne-mcintyre-1836   (1836–1913)
 *    shell   : mary-anne-mcintyre-anne   (no dates, identical stub)
 *    action  : delete shell.
 *
 * 4. SUSAN BURTON / SUSAN BURTON TELFER
 *    full rec  : susan-telfer-1844  (1844–1924, real bio Yahl SA, spouses Robert Telfer + Leslie Robert, child James Robert)
 *    stub A    : susan-burton-1844  (child James Robert, no spouse)
 *    stub B    : susan-burton-1845  (spouse Robert Telfer, no child)
 *    action    : keep susan-telfer-1844; delete BOTH susan-burton stubs;
 *                re-point james-robert-telfer.parents 'Susan Burton (1844–1924)' -> 'Susan Burton Telfer (1844–1924)'.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const PATH = new URL('../src/data/people.json', import.meta.url);
const data = JSON.parse(readFileSync(PATH, 'utf8'));

const slugOf = (p) => p.slug;
const index = new Map(data.map((p) => [p.slug, p]));

function remove(slug) {
  const i = data.findIndex((p) => p.slug === slug);
  if (i === -1) throw new Error(`remove: slug not found: ${slug}`);
  return data.splice(i, 1)[0];
}

function replaceStr(arr, from, to) {
  return (arr || []).map((s) => (s === from ? to : s));
}

const changes = [];

/* ---------- 4. SUSAN (do first so we can re-point refs) ---------- */
const jr = index.get('james-robert-telfer');
if (!jr) throw new Error('james-robert-telfer not found');
const oldRef = 'Susan Burton (1844–1924)';
const newRef = 'Susan Burton Telfer (1844–1924)';
if (index.has('susan-burton-1844') && index.has('susan-burton-1845') && index.has('susan-telfer-1844')) {
  remove('susan-burton-1844');
  remove('susan-burton-1845');
  jr.parents = replaceStr(jr.parents, oldRef, newRef);
  changes.push('susan: deleted susan-burton-1844 + susan-burton-1845 stubs; kept susan-telfer-1844; re-pointed james-robert-telfer.parents to "susan-burton 1844" display ref');
} else {
  changes.push('susan: SKIPPED (one of the three susan records missing)');
}

/* ---------- 2. HANNAH ---------- */
if (index.has('hannah-peacock-living')) {
  remove('hannah-peacock-living');
  changes.push('hannah: deleted hannah-peacock-living stub; kept hannah-peacock-1840');
} else changes.push('hannah: SKIPPED (shell not found)');

/* ---------- 3. MARY ANNE ---------- */
if (index.has('mary-anne-mcintyre-anne')) {
  remove('mary-anne-mcintyre-anne');
  changes.push('mary-anne: deleted mary-anne-mcintyre-anne stub; kept mary-anne-mcintyre-1836');
} else changes.push('mary-anne: SKIPPED (shell not found)');

/* ---------- 1. AMY (keeper + fold née Provis + fix role) ---------- */
const keeper = index.get('amy-telfer-1884');
const shell = index.get('amy-ellen-telfer');
if (keeper && shell) {
  // Fold the "née Provis" marriage detail into keeper's body if not already there
  let body = keeper.body_markdown || '';
  if (!/née Provis/i.test(body) && /née Provis/i.test(shell.body_markdown || '')) {
    if (!/\n$/.test(body)) body += '\n';
    body += '\nNote: Amy Ellen Telfer (née Provis) married Francis Charles Telfer.\n';
    keeper.body_markdown = body;
  }
  // Fix the naming-rule role line (Mark's great-grandmother -> plain factual)
  if (body) keeper.body_markdown = body.replace(/\*\*Role:\*\* Mark's great-grandmother/gi, '**Role:** Great-grandmother of Mark Telfer');
  remove('amy-ellen-telfer');
  changes.push('amy: kept amy-telfer-1884 (real parents + bio); folded née Provis footnote; fixed role naming; deleted amy-ellen-telfer shell');
} else changes.push('amy: SKIPPED (keeper or shell missing)');

writeFileSync(PATH, JSON.stringify(data, null, 2));
console.log('Records after merge:', data.length);
console.log('--- changes ---');
for (const c of changes) console.log('  • ' + c);
