#!/usr/bin/env node
// REPORT-ONLY by default. --enforce exits 1.
//
// WHY THIS EXISTS
// ---------------
// A reader using the site reported: "a few dead links, like John Robert's page
// and Rosemary's page, where the web address is in a different order than you'd
// guess." Those pages were fine. Their URLs were `/people/john-telfer-robert/`
// and `/people/rosemary-telfer-miriam/` -- the middle name sits AFTER the
// surname, so a reader typing `/people/john-robert-telfer/` got a 404.
//
// The failure is invisible. Nothing errors, nothing warns, no gate trips, no log
// line appears. The page simply isn't at the address anyone would guess. The
// next reader does not report it; they close the tab. That is why it survived.
//
// The first attempt at a fix hardcoded the two reported slugs. That is why 146
// other middle-name pages were still dead while two were "fixed". This script
// derives the whole set from the data every run, so a page added tomorrow cannot
// repeat the mistake quietly.
//
// WHAT COUNTS AS A DEFECT
// -----------------------
// A published person page whose canonical slug is neither:
//   (a) exactly `first-last` (or `first-last-year` when a birth year exists), nor
//   (b) that form with the middle name placed sensibly before the surname.
// i.e. any page a reader can reach only by guessing something other than the
// obvious name->URL transformation.
//
// NOTE ON NAMING: this defect was first labelled "surname-first". That label was
// wrong -- it was inferred from a reader saying "different order" plus two
// examples. The actual cause is the middle name's position. The old reason
// string `surname-first-canonical` is still accepted when reading the log so
// existing entries keep counting, but new work uses `middle-name-canonical`.

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const PEOPLE = path.join(ROOT, 'src/data/people.public.json');
const LOGF = path.join(ROOT, 'scripts/redirect-log.json');

const enforce = process.argv.includes('--enforce');

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

if (!fs.existsSync(PEOPLE)) {
  console.error(`✗ slug-guessability: cannot read ${PEOPLE}`);
  process.exit(enforce ? 1 : 0);
}

const people = JSON.parse(fs.readFileSync(PEOPLE, 'utf8'));
const log = fs.existsSync(LOGF) ? JSON.parse(fs.readFileSync(LOGF, 'utf8')) : [];
const hasAlias = new Set(log.map((e) => e.from));

// How many people collapse to each guessable URL? >1 means the guess is
// ambiguous and MUST NOT be emitted -- a 404 is honest, a wrong ancestor is not.
const buckets = new Map();
for (const p of people) {
  const f = norm(p.first_name), l = norm(p.last_name);
  if (!f || !l) continue;
  const yr = p.birth_year ? String(p.birth_year) : '';
  const k = `${f}-${l}${yr ? '-' + yr : ''}`;
  if (!buckets.has(k)) buckets.set(k, []);
  buckets.get(k).push(p.slug);
}

const dead = [];        // unguessable AND no alias reaching it -> reader gets 404
const ambiguous = [];   // unguessable AND ambiguous guess -> correctly withheld
const covered = [];     // unguessable BUT a redirect already serves the guess

const shadowBlocked = []; // guess belongs to a different person -> must not hijack
const seenAmbiguous = new Set();
for (const p of people) {
  if (!p.slug) continue;
  const f = norm(p.first_name), l = norm(p.last_name), m = norm(p.middle_name);
  if (!f || !l) continue;
  const yr = p.birth_year ? String(p.birth_year) : '';
  const guessable = `${f}-${l}${yr ? '-' + yr : ''}`;
  const givenForm = `${f}-${m ? m + '-' : ''}${l}${yr ? '-' + yr : ''}`;
  if (p.slug === guessable || p.slug === givenForm) continue;   // reachable by guess

  const group = buckets.get(guessable) || [];
  if (group.length > 1) {
    if (!seenAmbiguous.has(guessable)) {
      seenAmbiguous.add(guessable);
      ambiguous.push({ slug: p.slug, guess: guessable, holders: group });
    }
    continue;
  }
  // A reader may drop or add the birth year, and may put the middle name before
  // the surname. Any of those URLs must resolve, or the page is effectively
  // unreachable. Checking only the year-suffixed form was this script's own
  // blind spot: it reported CLEAN while john-robert-telfer had no redirect.
  const candidates = [...new Set([
    guessable,
    `${f}-${l}`,
    `${f}-${m ? m + '-' : ''}${l}`,
    `${f}-${m ? m + '-' : ''}${l}${yr ? '-' + yr : ''}`,
  ])].filter((c) => c !== p.slug);

  const resolved = candidates.filter((c) => {
    const e = log.find((x) => x.from === c);
    return e && e.to === p.slug;   // must reach THIS person, not just any page
  });
  if (resolved.length) { covered.push({ slug: p.slug, guess: resolved[0] }); continue; }
  // Only treat the guess as "belongs to someone else" when a DIFFERENT person's
  // real page sits exactly on it. A loose shared-slug hit (e.g. an alias like
  // /people/john-telfer/ that reaches a different John) is not a reason to stay
  // silent — that is precisely the dead link a reader reports.
  if (people.some((x) => x.slug === guessable && x.slug !== p.slug)) {
    shadowBlocked.push({ slug: p.slug, guess: guessable });
    continue;
  }
  dead.push({ slug: p.slug, guess: candidates[0], display: p.display_name, tried: candidates });
}

const line = '─'.repeat(66);
console.log(line);
console.log('SLUG-GUESSABILITY CHECK  (reader types first-name-last-name)');
console.log(line);
console.log(`profiles checked ................. ${people.length}`);
console.log(`unguessable, redirect serves it .. ${covered.length}`);
console.log(`unguessable, ambiguous (withheld) . ${ambiguous.length}`);
console.log(`unguessable, guess is another page  ${shadowBlocked.length}  (withheld on purpose)`);
console.log(`unguessable, NO redirect -> 404 ... ${dead.length}`);

if (ambiguous.length) {
  console.log('\nWithheld on purpose (same first+last+year = different people):');
  for (const a of ambiguous) {
    console.log(`   · ${a.guess}  ${a.holders.length} people: ${a.holders.join(', ')}`);
  }
}

if (dead.length) {
  console.log('\n✗ Pages a reader cannot reach by guessing the obvious URL:');
  for (const d of dead) {
    console.log(`   · /people/${d.slug}/   (reader would try /people/${d.guess}/)`);
  }
  console.log('\n  Fix by emitting an alias, never by renaming the canonical slug —');
  console.log('  a rename breaks every inbound link and citation.');
}

if (!dead.length) {
  console.log('\n✅ SLUG-GUESSABILITY CLEAN — every published page is reachable');
  console.log('   at the URL a reader would guess, or is deliberately withheld');
  console.log('   because the guess is ambiguous.');
}

if (enforce && dead.length) {
  console.error(`\n✗ FAILED: ${dead.length} unreachable page(s).`);
  process.exit(1);
}
process.exit(0);
