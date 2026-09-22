import fs from 'fs';

const people = JSON.parse(fs.readFileSync('./src/data/people.json', 'utf-8'));

console.log(`=== VALIDATION REPORT ===`);
console.log(`Total people: ${people.length}\n`);

// 1. Duplicate slugs
const slugCounts = {};
people.forEach(p => { slugCounts[p.slug] = (slugCounts[p.slug] || 0) + 1; });
const dupSlugs = Object.entries(slugCounts).filter(([_, c]) => c > 1);
console.log(`1. DUPLICATE SLUGS: ${dupSlugs.length}`);
dupSlugs.forEach(([slug, count]) => console.log(`   ${slug}: ${count}x`));

// 2. Duplicate names (same display_name + birth_year)
const nameKey = p => `${p.display_name}|${p.birth_year}`;
const nameCounts = {};
people.forEach(p => {
  if (p.display_name && p.birth_year) {
    const key = nameKey(p);
    nameCounts[key] = (nameCounts[key] || 0) + 1;
  }
});
const dupNames = Object.entries(nameCounts).filter(([_, c]) => c > 1);
console.log(`\n2. DUPLICATE NAMES (same name + birth year): ${dupNames.length}`);
dupNames.forEach(([key, count]) => console.log(`   ${key}: ${count}x`));

// 3. Missing required fields
const noBirth = people.filter(p => !p.birth_year && p.death_year);
const noDeath = people.filter(p => p.birth_year && !p.death_year && p.birth_year < 1920);
const noBio = people.filter(p => !p.bio || p.bio.trim().length < 10);
console.log(`\n3. MISSING FIELDS:`);
console.log(`   No birth year (but has death): ${noBirth.length}`);
console.log(`   No death year (born <1920): ${noDeath.length}`);
console.log(`   No/short bio (<10 chars): ${noBio.length}`);

// 4. Invalid references (parents/spouses/children that don't exist)
const slugSet = new Set(people.map(p => p.slug));
let invalidRefs = 0;
people.forEach(p => {
  ['parents', 'spouses', 'children'].forEach(field => {
    if (p[field]) {
      p[field].forEach(ref => {
        if (!slugSet.has(ref)) {
          console.log(`   INVALID REF: ${p.slug} -> ${field}: ${ref}`);
          invalidRefs++;
        }
      });
    }
  });
});
console.log(`\n4. INVALID REFERENCES: ${invalidRefs} (most are side-branch refs handled by redirects)`);

// 5. Orphans (no parents, no spouses, no children)
const orphans = people.filter(p =>
  (!p.parents || p.parents.length === 0) &&
  (!p.spouses || p.spouses.length === 0) &&
  (!p.children || p.children.length === 0)
);
console.log(`\n5. ORPHANS (no connections): ${orphans.length}`);
orphans.slice(0, 20).forEach(p => console.log(`   ${p.slug} (${p.display_name || 'unnamed'})`));

// 6. Reciprocal-link integrity, SPLIT defect vs research gap (2026-09-22).
// Card tw-2026-09-22-011. Two independent external models (Nemotron 3 Ultra, Grok 4.20)
// recommended this split after a blind design review; the numbers below are Skippy's own
// live measurement, not the models' claims.
//
//   DEFECT — the source claims the relation, the TARGET RECORD EXISTS, and the target does
//            not link back. Both files are in the vault and disagree. That is a data fault
//            (most often a same-name binding: a bare/dateless record capturing a historical
//            bare-name reference). Measured 2026-09-22: 25 (14 children, 8 siblings, 3 step).
//
//   GAP    — the target record is absent entirely, or has no vault file. That is an expected
//            state during research (the other half of the link has not been written yet).
//            Measured 2026-09-22: 0.
//
// NOTE: a defect is NOT currently fatal — see the summary block. Turning it into a hard build
// failure is a deliberate policy change that needs Mark's ruling (25 pre-existing defects would
// otherwise block every deploy). Reported loudly until then.
const targetExists = (slug) => {
  const t = people.find(c => c.slug === slug);
  if (!t) return false;
  // A record with a vault_file that is missing on disk is a GAP, not a defect. We cannot
  // stat the vault from here, so treat "has a vault_file" as "is a maintained profile".
  return Boolean(t.vault_file);
};

const RECIP_PAIRS = [
  ['children', 'parents', 'child', 'parent'],
  ['siblings', 'siblings', 'sibling', 'sibling'],
  ['step_children', 'step_parents', 'stepchild', 'step-parent'],
  ['step_parents', 'step_children', 'step-parent', 'stepchild'],
];

let recipDefects = 0, recipGaps = 0, recipDisputed = 0;
const recipDefectList = [];
const recipDisputedList = [];
people.forEach(p => {
  RECIP_PAIRS.forEach(([field, back, labelA, labelB]) => {
    (p[field] || []).forEach(otherSlug => {
      if (otherSlug === p.slug) return;
      const other = people.find(c => c.slug === otherSlug);
      if (!other) {
        recipGaps++;
        return;
      }
      if ((other[back] || []).includes(p.slug)) return; // reciprocal — fine
      if (!targetExists(otherSlug)) {
        recipGaps++;
        return;
      }
      // A target whose parentage/siblinghood is DELIBERATELY held out of the arrays
      // (parentage_status: unproven) is the dispute system working as designed: the
      // vault asserts the link in prose, the machine arrays refuse to. Not a defect.
      if (other.parentage_status === 'unproven' || (other.disputed_parent_refs || []).length > 0) {
        recipDisputed++;
        recipDisputedList.push(`${p.slug} claims ${labelA} ${otherSlug} (unproven parentage — recorded, not asserted)`);
        return;
      }
      recipDefects++;
      recipDefectList.push(`${p.slug} claims ${labelA} ${otherSlug} (${labelB} does not link back)`);
    });
  });
});
console.log(`\n6. RECIPROCAL LINKS — DEFECTS: ${recipDefects}  (target record exists and is maintained, link not mirrored AND not disputed)`);
recipDefectList.forEach(l => console.log(`   DEFECT: ${l}`));
console.log(`6b. RECIPROCAL LINKS — RESEARCH GAPS: ${recipGaps}  (target record absent — expected)`);
console.log(`6d. RECIPROCAL LINKS — DISPUTED/UNPROVEN: ${recipDisputed}  (deliberate hold-out — expected)`);
recipDisputedList.forEach(l => console.log(`   DISPUTED: ${l}`));

// Legacy count kept for continuity: children->parents mismatches only.
let childMismatch = 0;
people.forEach(p => {
  (p.children || []).forEach(childSlug => {
    const child = people.find(c => c.slug === childSlug);
    if (child && (!child.parents || !child.parents.includes(p.slug))) childMismatch++;
  });
});
console.log(`6c. (legacy) CHILDREN WITHOUT RECIPROCAL PARENT LINK: ${childMismatch}`);

// 7. Suspect years
const suspect = people.filter(p =>
  (p.birth_year && (p.birth_year < 1500 || p.birth_year > 2030)) ||
  (p.death_year && (p.death_year < 1500 || p.death_year > 2030)) ||
  (p.birth_year && p.death_year && p.death_year < p.birth_year)
);
console.log(`\n7. SUSPECT YEARS: ${suspect.length}`);
suspect.forEach(p => console.log(`   ${p.slug}: birth=${p.birth_year}, death=${p.death_year}`));

// 8. Self-references
let selfRefs = 0;
people.forEach(p => {
  ['parents', 'spouses', 'children'].forEach(field => {
    if (p[field] && p[field].includes(p.slug)) {
      console.log(`   SELF-REF: ${p.slug} -> ${field}`);
      selfRefs++;
    }
  });
});
console.log(`\n8. SELF-REFERENCES: ${selfRefs}`);

// 9. Cycles (naive check: A parent of B, B parent of A)
let cycles = 0;
const find = (slug) => people.find(p => p.slug === slug);
people.forEach(p => {
  if (p.parents) {
    p.parents.forEach(parSlug => {
      const parent = find(parSlug);
      if (parent && parent.parents && parent.parents.includes(p.slug)) {
        console.log(`   CYCLE: ${p.slug} <-> ${parSlug}`);
        cycles++;
      }
    });
  }
});
console.log(`\n9. PARENT CYCLES: ${cycles}`);

// 10. IMPOSSIBLE-PARENT EDGES (generation guard — catches cross-branch contamination)
// A parent must be an adult when the child is born: parent birth <= child birth - 11 years.
// Catches the recurring same-name contamination class (e.g. a wife wrongly attached as a
// child, or a bare ref resolving to a person from a different generation).
let impossibleParent = 0;
const bySlug = new Map(people.map(p => [p.slug, p]));
people.forEach(p => {
  if (!p.birth_year) return;
  (p.parents || []).forEach(parSlug => {
    const par = bySlug.get(parSlug);
    if (!par || !par.birth_year) return;
    const gap = p.birth_year - par.birth_year;
    if (gap < 11) {
      console.log(`   IMPOSSIBLE PARENT: ${p.slug} (b.${p.birth_year}) -> parent ${parSlug} (b.${par.birth_year}), gap ${gap}y`);
      impossibleParent++;
    }
  });
});
console.log(`\n10. IMPOSSIBLE-PARENT EDGES (birth gap < 11y): ${impossibleParent}`);

// 11. DUPLICATE IDs (identity-key guard)
// `id` is the identity key for graph/relationship wiring and per-person lookups.
// It was historically just display_name, so same-named people collided (7x James
// Telfer, 4x John Telfer, ...) and id lookups silently resolved to whichever
// duplicate won. Fixed at the generator (convert-markdown.mjs toPersonId); this
// guard stops the invariant rotting again. See card tw-2026-09-11-004.
const idCounts = {};
people.forEach(p => { idCounts[p.id] = (idCounts[p.id] || 0) + 1; });
const dupIds = Object.entries(idCounts).filter(([_, c]) => c > 1);
console.log(`\n11. DUPLICATE IDS: ${dupIds.length}`);
dupIds.forEach(([id, count]) => console.log(`   ${id}: ${count}x`));

console.log(`\n=== SUMMARY ===`);
const criticalIssues = dupSlugs.length + suspect.length + selfRefs + cycles + impossibleParent + dupIds.length;
// childMismatch excluded — expected for incomplete family trees; not a build blocker
// Invalid refs are warnings only — side-branch entries reference long build-generated slugs
// (e.g. francis-telfer-18091895) which get resolved via redirect system at build time
console.log(`Critical issues (fail build): ${criticalIssues}`);
console.log(`Invalid refs (warnings, handled by redirects): ${invalidRefs}`);
console.log(`Reciprocal DEFECTS (non-fatal, reported): ${recipDefects}`);
console.log(`Reciprocal research GAPS (expected): ${recipGaps}`);
console.log(`Reciprocal DISPUTED/UNPROVEN hold-outs (expected): ${recipDisputed}`);
if (criticalIssues === 0) {
  console.log(`\n✅ Data is clean for build!`);
  process.exit(0);
} else {
  console.log(`\n❌ Critical issues found — fix before build`);
  process.exit(1);
}