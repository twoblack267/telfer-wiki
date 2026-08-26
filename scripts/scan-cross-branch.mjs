#!/usr/bin/env node
/**
 * scan-cross-branch.mjs — CROSS-BRANCH CONNECTION-CONTAMINATION detector.
 *
 * Detects the "same-name branch contamination" class at the DATA layer
 * (src/data/people.json), so it runs in CI and fails the build BEFORE it ships.
 *
 * PRECISE SIGNATURE (the survivor contamination, zero false positives on the known
 * James-Telfer-of-Castleton/Sorbietrees naming variance):
 *
 *   A person's SIBLING ref resolves to a person who is ALSO that person's PARENT
 *   or CHILD. That is a structural contradiction — someone can't be both your
 *   sibling and your parent. It is the deterministic residue of a fuzzy first+last
 *   name index wiring a bare same-name ref to the wrong branch / generation.
 *
 *   Concretely this fired on the REAL Lawrie remnant: robert-dunlop-lawrie (father)
 *   and caroline-edna-lawrie (daughter) each list the other as a SIBLING, while the
 *   other is already their parent/child. That is contamination. The James-Telfer
 *   cluster (parent-set variance 'Castleton' vs 'Sorbietrees') does NOT fire because
 *   its siblings never overlap parents/children — so we never false-flag it.
 *
 * Detection rule — flag a sibling ref R of person P when:
 *   (a) R ∈ P.parents  -> sibling is actually a parent  (parent-as-sibling)
 *   (b) R ∈ P.children -> sibling is actually a child   (child-as-sibling)
 *
 * NOTES:
 *   - Only SIBLING fields checked. Parent/child cross-branch alone is EXPECTED and
 *     normal (a child's parent anchors its branch) — only the sibling contradiction
 *     above is contaminated.
 *   - Dangling refs, stub data gaps, and reciprocal-link issues are handled by the
 *     main validator (checks #4/#6) — not this scanner.
 *
 * Usage:  node scripts/scan-cross-branch.mjs
 * Exit code: 0 = clean, 1 = contamination found.
 */

import fs from 'fs';

const people = JSON.parse(fs.readFileSync('./src/data/people.json', 'utf-8'));
const bySlug = new Map(people.map(p => [p.slug, p]));

let flags = 0;
for (const p of people) {
  if (!p.siblings || p.siblings.length === 0) continue;
  const parentSet = new Set(p.parents || []);
  const childSet = new Set(p.children || []);
  for (const refSlug of p.siblings) {
    if (refSlug === p.slug) continue;
    if (parentSet.has(refSlug)) {
      flags++;
      console.log(`• ${p.slug} lists ${refSlug} as SIBLING but ALSO as PARENT — parent-as-sibling leak`);
    } else if (childSet.has(refSlug)) {
      flags++;
      console.log(`• ${p.slug} lists ${refSlug} as SIBLING but ALSO as CHILD — child-as-sibling leak`);
    }
  }
}

console.log(`\nScanned ${people.length} people. FLAGGED (sibling overlapping parent/child): ${flags}`);
console.log(flags === 0
  ? `\n✅ No cross-branch sibling contamination found.`
  : `\n❌ ${flags} sibling ref(s) contradict parent/child structure — same-name contamination. Fix at the VAULT, then regenerate.`);
process.exit(flags === 0 ? 0 : 1);
