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

// 6. Children without parents linked back
let childMismatch = 0;
people.forEach(p => {
  if (p.children) {
    p.children.forEach(childSlug => {
      const child = people.find(c => c.slug === childSlug);
      if (child && (!child.parents || !child.parents.includes(p.slug))) {
        console.log(`   CHILD MISMATCH: ${p.slug} claims child ${childSlug} but child doesn't link back`);
        childMismatch++;
      }
    });
  }
});
console.log(`\n6. CHILDREN WITHOUT RECIPROCAL PARENT LINK: ${childMismatch}`);

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

console.log(`\n=== SUMMARY ===`);
const criticalIssues = dupSlugs.length + suspect.length + selfRefs + cycles;
// childMismatch excluded — expected for incomplete family trees; not a build blocker
// Invalid refs are warnings only — side-branch entries reference long build-generated slugs
// (e.g. francis-telfer-18091895) which get resolved via redirect system at build time
console.log(`Critical issues (fail build): ${criticalIssues}`);
console.log(`Invalid refs (warnings, handled by redirects): ${invalidRefs}`);
if (criticalIssues === 0) {
  console.log(`\n✅ Data is clean for build!`);
  process.exit(0);
} else {
  console.log(`\n❌ Critical issues found — fix before build`);
  process.exit(1);
}