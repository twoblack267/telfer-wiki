#!/usr/bin/env node
/**
 * build-relationship-graph.mjs
 * Resolves relationships from people.json → parents/children/spouses/siblings arrays
 * Creates adjacency lists for tree rendering
 *
 * Run: node scripts/build-relationship-graph.mjs
 * Input: src/data/people.json
 * Output: src/data/relationship-graph.json, updates people.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkYears } from './lib/date-gate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PEOPLE_PATH = path.resolve(__dirname, '../src/data/people.json');
const GRAPH_PATH = path.resolve(__dirname, '../src/data/relationship-graph.json');

// ─── Load Data ──────────────────────────────────────────────────────────────

const people = JSON.parse(fs.readFileSync(PEOPLE_PATH, 'utf-8'));
const slugToPerson = new Map(people.map(p => [p.slug, p]));

console.log(`📚 Loaded ${people.length} people`);

// ─── Build Slug Index (case-insensitive, fuzzy) ──────────────────────────────

// Primary index: exact slug match
const slugIndex = new Map(people.map(p => [p.slug.toLowerCase(), p.slug]));

// Secondary index: display name without dates
const nameIndex = new Map();
function setPrefersComplete(key, slug) {
  // A bare "First Last" name resolves safely ONLY when it maps to a single,
  // well-defined person. When multiple DISTINCT people share the name (e.g.
  // William Telfer 1802 / 1811 / 1841 / 1880), leave the key unset (ambiguous)
  // so a bare reference resolves to nothing rather than the WRONG person.
  const existing = nameIndex.get(key);
  if (existing === AMBIGUOUS) return;
  if (!existing) { nameIndex.set(key, slug); return; }
  if (existing === slug) return; // same person, ignore

  const existingPerson = slugToPerson.get(existing);
  const newPerson = slugToPerson.get(slug);
  const existingHasYear = !!(existingPerson && existingPerson.birth_year);
  const newHasYear = !!(newPerson && newPerson.birth_year);

  // Two DIFFERENT year-bearing people with the same bare name → genuinely
  // ambiguous. A bare reference can't pick between them. Mark as ambiguous.
  if (existingHasYear && newHasYear) {
    nameIndex.set(key, AMBIGUOUS);
    return;
  }
  // A year-less stub collides with a dated record → prefer the dated one.
  if (newHasYear && !existingHasYear) {
    nameIndex.set(key, slug);
    return;
  }
  // Existing is year-bearing, new is a stub → keep existing, ignore stub.
  if (existingHasYear && !newHasYear) {
    return;
  }
  // Both year-less stubs with the same name → ambiguous too.
  nameIndex.set(key, AMBIGUOUS);
}
const AMBIGUOUS = '__ambiguous__';
for (const person of people) {
  const name = person.id.toLowerCase(); // id has clean name
  if (!nameIndex.has(name)) nameIndex.set(name, person.slug);
  // Also try first + last name
  // FIXED 2026-09-22 ("robert (1850)" key): person.id carries the year suffix —
  // "Robert Dunlop Lawrie (1850)" — so parts[parts.length - 1] was the YEAR, not
  // the surname. The dated ancestor therefore registered under the garbage key
  // "robert (1850)" and NEVER claimed its own bare name "robert lawrie". The
  // year-less modern namesake was left as the sole claimant, so every bare
  // reference ("Robert Dunlop Lawrie" on Caroline's file, his own Self: line)
  // fuzzy-matched the WRONG generation. Strip the trailing "(...)" before
  // splitting so a dated person registers for its real first+last key too.
  const idBare = String(person.id || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  const parts = idBare.split(' ');
  if (parts.length >= 2) {
    const fn = parts[0].toLowerCase();
    const ln = parts[parts.length - 1].toLowerCase();
    setPrefersComplete(`${fn} ${ln}`, person.slug);
    // FIXED 2026-10-24 (bare full-name key never registered):
    // Only the first+last key was ever registered from `id`. Because `id` carries the
    // year suffix ("John Robert Telfer (1952)"), the FULL year-stripped name was never
    // a key — so the distinctive-name check (`nameIndex.has('john robert telfer')`)
    // was false for a two-middle-name person who is genuinely unique, and the resolver
    // fell back to the shared "john telfer" key (5 records) and refused. Rebecca and
    // Sophia Telfer lost their father that way. Register the whole year-stripped id
    // through the same collision logic so a unique full name claims its own key, and a
    // full name shared by two distinct people still goes AMBIGUOUS.
    setPrefersComplete(idBare.toLowerCase(), person.slug);
    // FIXED 2026-10-24 (nickname/quote variant broke parentage):
    // A person's OWN id may omit a nickname that every other reference carries.
    // William Francis "Frank" Telfer's id is `William Francis Telfer (1885)`, but his
    // three children all name him `William Francis "Frank" Telfer (1885–1955)`. The
    // quoted form slugified to `william-francis-frank-telfer-1885`, which matches no
    // slug, and no name key contained the quotations — so Geoffrey, Basil and Ruth
    // were left with a mother and no father, silently. Register the nickname-stripped
    // aliases against THIS person only:
    //   "william francis frank telfer"  (quotes removed, word kept)
    //   "william francis telfer"        (the person's own legal form)
    // Both go through setPrefersComplete, so if any other record answers to the same
    // alias the key becomes AMBIGUOUS and the resolver refuses — no guessing.
    const aliases = [
      idBare.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(),
      idBare.replace(/["“”][^"“”]*["“”]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(),
    ];
    for (const alias of aliases) {
      if (alias && alias !== idBare.toLowerCase()) setPrefersComplete(alias, person.slug);
    }
  }
}

// ─── Resolve Names to Slugs ──────────────────────────────────────────────────

function resolveNameToSlug(name, sourceSlug) {
  if (!name || name === '?' || name.toLowerCase() === 'unknown') return null;
  if (name.match(/^\(?\d{4}[\-–]\d{4}\)?$/)) return null;
  if (name.match(/^(Self|Spouse|Father|Mother|Children|Siblings)$/i)) return null;

  // Extract clean name (remove dates in parens)
  const cleanName = name.replace(/[\(（]\d{4}[\-–]\d{2,4}.{0,2}\d{0,4}[\)）]/g, '').replace(/\s*\([^)]+\)$/, '').trim()
    // FIXED 2026-10-24 (nickname quotes broke identity):
    // A quoted nickname — William Francis "Frank" Telfer — is part of the NAME in the
    // vault but carries no identity in the index. Leaving the quotes on meant this
    // reference matched nothing: the slug `william-francis-frank-telfer-1885-1955` did
    // not exist and no name key contained quotes, so three children of Frank Telfer
    // (Geoffrey, Basil, Ruth) silently lost their father. Quotes are typographic
    // decoration around a preferred name, not information: strip them, keep the word.
    .replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
  // ── 0) A DISAMBIGUATING QUALIFIER IS IDENTITY (2026-10-25) ──────────────────
  //
  // `cleanName` below strips a trailing parenthetical because years there are not
  // part of a name. But it strips NON-YEAR qualifiers too, and some of those are the
  // only thing identifying the person. "William Telfer (shepherd)" reduces to
  // "William Telfer", a bare name claimed by FOUR records (1802/1811/1841/the
  // shepherd). Every ambiguity gate then refuses it and the ref resolves to null:
  //   • andrew-telfer-1798 lost his Father          → janet-nichol lost a child
  //   • william-telfer-1802 lost his Father         → crown jewel shrank
  //   • the shepherd could not resolve his OWN name → his Spouse edge vanished
  //   • janet-nichol lost her Spouse
  // Three crown-jewel failures from one over-eager strip.
  //
  // "(shepherd)" is not decoration — no other record answers to it, and people.json
  // registers the full string as a unique key. Consult the qualified key BEFORE the
  // qualifier is discarded, and only accept an unambiguous hit, so no generation of
  // William is ever guessed at.
  {
    const q = String(name || '').match(/\(([^)]*)\)\s*$/);
    if (q) {
      const words = q[1].replace(/[\d\u2013\-?]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
      if (words) {
        const bare = String(name).replace(/\s*\([^)]*\)\s*$/, '').replace(/["\u201c\u201d]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
        const qualified = nameIndex.get(`${bare} (${words})`);
        if (qualified && qualified !== AMBIGUOUS) return qualified;
      }
    }
  }

  // FIXED 2026-10-25 (APPROXIMATE YEAR "b. ~1791" WAS INVISIBLE — the Telfer
  // sibling asymmetry):
  //
  // The vault names these two ancestors `John Telfer (b. ~1791, England)` and
  // `Elisabeth Telfer (b. ~1806, England)` because neither year is proven, only
  // estimated. The year extractors below demanded a bare `\d{4}` immediately after
  // the bracket, so the `b. ~` prefix matched nothing, refBirth stayed null, and the
  // ref fell past the year path into the bare-name gates. `john telfer` is
  // AMBIGUOUS (the tree holds several Johns), so the reference was refused — and
  // `Elisabeth Telfer` resolved only because she happens to be the sole Elisabeth.
  // Measured before the fix:
  //   "John Telfer (b. ~1791, England)"      -> null   (could not resolve HIMSELF)
  //   "Elisabeth Telfer (b. ~1806, England)" -> elisabeth-telfer-1806
  // John's own Self ref therefore produced no node, so his reciprocal sibling edge
  // was never written and `john-telfer-1791.siblings` stayed empty while Elisabeth's
  // carried the raw string. Accept an OPTIONAL `b.` / `~` / `c.` / `abt` / `ca.`
  // prefix: a qualifier of uncertainty still names a year, and an approximate year
  // is still evidence — it is not a blank cheque to guess a generation, because the
  // year must still match a record's birth_year exactly below.
  //
  // Extract birth/death years from the reference if present, e.g.
  // "William Telfer (1802–1850)" or "William Telfer (1802)". Use them to
  // disambiguate between same-named people reliably.
  // Handle open-ended ranges like "Robert Telfer (1803–?)" (unknown death) and
  // "Adam Telfer (1799–?)": the 4-digit first group is the birth year. A single
  // bare `(1803)` is also a birth year. A leading `b.`/`~`/`c.`/`abt`/`ca.` marker
  // (approximate or birth-qualified) is tolerated and carries no meaning beyond
  // "here is a year".
  const yearsMatch = name.match(/(\d{4})\s*[\-–]\s*(\d{4})/);
  let refBirth = null, refDeath = null;
  if (yearsMatch) {
    refBirth = parseInt(yearsMatch[1], 10);
    refDeath = parseInt(yearsMatch[2], 10);
  } else {
    // Open-ended range "1803–?" or "1803–": birth year is the first 4-digit group.
    const openRange = name.match(/\(\s*(?:b\.?\s*|c\.?\s*|ca\.?\s*|abt\.?\s*|about\s*|~+\s*)*(\d{4})\s*[\-–]\s*\?/i);
    if (openRange) refBirth = parseInt(openRange[1], 10);
    else {
      const singleYear = name.match(/\(\s*(?:b\.?\s*|c\.?\s*|ca\.?\s*|abt\.?\s*|about\s*|~+\s*)*(\d{4})\b/i);
      if (singleYear) refBirth = parseInt(singleYear[1], 10);
    }
  }

  // 1b) If the reference CARRIED years, that year disambiguation is authoritative.
  // It MUST take priority over a bare same-name slug match, so a person with the
  // ref's birth/death years is preferred — and if no such person exists, the ref is
  // null (do NOT fall through to a different-generation same-name record).
  if (refBirth) {
    // Collect every same-name candidate FIRST, then score the match. Death-year
    // matching must be a TIEBREAKER, not an early return: several same-named
    // Telfers share death years (e.g. James Telfer b1761 d1845 AND James Telfer
    // b1832 d1845), so `if (death_year === refDeath) return ...` grabbed whichever
    // appeared first in list order and wired a wrong-generation sibling/parent/
    // child. Only a *unique* same-name+death-year candidate is safe by death alone.
    // ── FIXED 2026-09-12 ──────────────────────────────────────────────────────
    // `p.id` carries the years, e.g. "John Telfer (1840)". Comparing the whole id
    // against the STRIPPED name ("john telfer") can NEVER match, so `candidates`
    // was always empty and EVERY year-carrying vault ref fell through to
    // `return null`. That silently destroyed 1604 relationship refs across 249
    // records on every pipeline run — the reason /people/full-tree/ rendered a
    // 2-node tree while the site advertised 355 people across 9 generations.
    // Compare against the id's BASE name instead (years live in birth_year/death_year,
    // which the logic below already uses).
    const baseName = (id) => String(id || '').replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
    const cleanedId = cleanName.toLowerCase();
    // NICKNAME TOLERANCE in the YEAR path (2026-10-24). Same defect as the year-less
    // path, but reached FIRST whenever the reference carries a lifespan. Frank
    // Telfer's id is `William Francis Telfer (1885)` while his children write
    // `William Francis "Frank" Telfer (1885–1955)`; `cleanName` becomes
    // "William Francis Frank Telfer", no record's base name matches it, `candidates`
    // stayed empty and the function returned null — three children silently lost
    // their father. If no direct candidate exists, try dropping each single interior
    // word (a nickname is one extra token the record itself does not carry) and accept
    // the result ONLY when the remaining name matches exactly one record. Anything
    // less certain stays unresolved — no guessing.
    const candidates = (() => {
      const direct = people.filter((p) => baseName(p.id) === cleanedId);
      if (direct.length > 0) return direct;
      const words = cleanedId.split(' ').filter(Boolean);
      if (words.length < 3) return direct;
      const matches = new Map();
      for (let i = 1; i < words.length - 1; i++) {
        const variant = words.slice(0, i).concat(words.slice(i + 1)).join(' ');
        for (const p of people) if (baseName(p.id) === variant) matches.set(p.slug, p);
      }
      return matches.size === 1 ? [...matches.values()] : direct;
    })();

    // Exact both-years match is unequivocal.
    if (refDeath) {
      const exact = candidates.find((p) => p.birth_year === refBirth && p.death_year === refDeath);
      if (exact) return exact.slug;
    }
    // Birth-year match.
    const byBirth = candidates.filter((p) => p.birth_year === refBirth);
    if (byBirth.length === 1) return byBirth[0].slug;
    if (byBirth.length > 1) {
      // Same name + same birth year but conflicting deaths — genuinely ambiguous.
      if (refDeath) {
        const byBoth = byBirth.find((p) => p.death_year === refDeath);
        if (byBoth) return byBoth.slug;
      }
      return null;
    }
    // No birth-year match. Fall back to death-year ONLY if unique among same-name
    // candidates — otherwise we'd guess wrong generation.
    if (refDeath) {
      const byDeath = candidates.filter((p) => p.death_year && p.death_year === refDeath);
      if (byDeath.length === 1) return byDeath[0].slug;
      if (byDeath.length > 1) return null;
    }
    // GUARD (26 Aug 2026): a year-carrying ref matching NO record with those years
    // must NOT short-circuit to an exact bare-slug match on a DIFFERENT generation.
    // That unsafe fallback wired cross-branch false parents (e.g. `David Parker
    // (1856–1906)` -> david-parker 1822; Janet Dunlop 1811 as parent of John Lawrie
    // 1810 / Alexander Lawrie 1776; Margaret Wright 1810 as child of Adam 1842).
    return null;
  }

  // 0) YEAR-LESS REF TO A SHARED NAME: REFUSE ENTIRELY (2026-10-24).
  // A bare "William Telfer" with no year identifies nobody when the tree holds
  // three of them (1802 / 1811 / 1841). Step 1 rescued this case via slugIndex
  // when the slugified name happened to exist — even though nameIndex already
  // knew the name was AMBIGUOUS. That is exactly how James Telfer 1761's
  // de-dated "William Telfer" child ref hijacked William Telfer 1802 (a
  // different branch, 200+ km and one generation away), destroying his real
  // parents and two sibling edges. A year-less ref to a shared name must stay
  // an unbound raw string. If ANY distinct person shares this bare name, the
  // ref cannot be pinned and must not be guessed.
  {
    const bareKey = cleanName.toLowerCase();
    const parts = cleanName.split(' ').filter(Boolean);
    const key = parts.length >= 2 ? `${parts[0].toLowerCase()} ${parts[parts.length - 1].toLowerCase()}` : bareKey;
    const baseName = (id) => String(id || '').replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
    // A DISTINCTIVE FULL NAME IS NOT AMBIGUOUS (2026-10-24).
    //
    // This guard used to test the first+last key unconditionally, so "John Robert
    // Telfer" was judged by the key "john telfer" — shared by 5 historical records —
    // and refused, even though the FULL name "john robert telfer" identifies exactly
    // ONE person. Rebecca Telfer's father silently vanished that way, which in turn
    // made the guard report a "shrink" that looked like data loss but was really a
    // resolver refusal. When the full name is itself a distinct record, honour it and
    // only fall back to the first+last key when the full name is not distinctive.
    const fullIsDistinct = (() => {
      if (nameIndex.get(bareKey) === AMBIGUOUS) {
        // A DISAMBIGUATING qUALIFIER IS IDENTITY, NOT DECORATION (2026-10-25).
        //
        // `"William Telfer (shepherd)"` strips to the bare name "William Telfer",
        // which is claimed by four records (1802 / 1811 / 1841 / the shepherd) and so
        // is refused as ambiguous. But the qualifier "(shepherd)" is exactly what
        // identifies THIS man — no other record carries it. Refusing the ref threw
        // away the one piece of evidence that made it resolvable.
        //
        // Measured consequence: andrew-telfer-1798's Father edge was never written to
        // childEdges, so janet-nichol's children dropped from 2 to 1 and the
        // crown-jewel guard fired. The pre-existing green build had only been passing
        // because the PREVIOUS people.json still carried the edge — a derived value
        // being treated as evidence. Rebuilding from scratch exposed it.
        //
        // The parenthesised qualifier is registered against the id itself
        // ("william telfer (shepherd)") and is unambiguous, so honour it. Never guess:
        // only accept the qualifier when it maps to exactly one record and that record
        // is the one and only claimant of the qualifier.
        const qualifierKey = (() => {
          const q = String(name || '').match(/\(([^)]*)\)\s*$/);
          if (!q) return '';
          const qClean = q[1].replace(/[\d–\-?]/g, '').trim(); // years are not identity
          if (!qClean) return '';
          return `${bareKey} (${qClean.toLowerCase()})`;
        })();
        const qualified = qualifierKey ? nameIndex.get(qualifierKey) : undefined;
        if (qualified && qualified !== AMBIGUOUS) return true;
        return false;
      }
      const sameFull = new Set(people.filter((p) => baseName(p.id) === bareKey).map((p) => p.slug));
      return sameFull.size === 1 && nameIndex.has(bareKey);
    })();
    if (!fullIsDistinct) {
      if (nameIndex.get(bareKey) === AMBIGUOUS || nameIndex.get(key) === AMBIGUOUS) return null;
      const sameNamed = new Set(
        people.filter((p) => baseName(p.id) === bareKey || baseName(p.id) === key).map((p) => p.slug)
      );
      if (sameNamed.size > 1) return null;
    }
  }

  // 1) Exact slug match (slugified clean name) — only safe when the ref carries no years, because a bare slug match ignores generations entirely.
  //
  // FIXED 2026-09-30 (bare-slug hijack of an ambiguous name): a NEW person whose
  // slug happens to equal the bare name (e.g. James John Drew Telfer -> `james-telfer`)
  // made `slugIndex` return that newcomer for EVERY bare historical reference to the
  // name "James Telfer". Because step 1 fires BEFORE the nameIndex ambiguity check,
  // a reference such as Robert Telfer (1803)'s `Father: James Telfer` was rewritten
  // to point at the living 8th-generation newcomer instead of the historical record.
  // That self-reinforcing cycle then inflated his descendant depth past 4 and tripped
  // the PHANTOM-LIVING build gate three times over (james-telfer, daryll-telfer,
  // rosemary-curtis), blocking the build. A bare name that is known-AMBIGUOUS must
  // never be resolved by a bare-slug coincidence — refuse rather than guess wrong.
  const slugified = slugify(cleanName);
  if (slugIndex.has(slugified)) {
    const bareKey = cleanName.toLowerCase();
    if (nameIndex.get(bareKey) === AMBIGUOUS) return null;
    return slugIndex.get(slugified);
  }

  // 2) Exact name match
  const exactKey = cleanName.toLowerCase();
  const exactVal = nameIndex.get(exactKey);
  if (exactVal === AMBIGUOUS) return null;
  if (nameIndex.has(exactKey)) return exactVal;

  // 3) Fuzzy: first + last name (only safe when unambiguous)
  const parts = cleanName.split(' ');
  if (parts.length >= 2) {
    const fn = parts[0].toLowerCase();
    const ln = parts[parts.length - 1].toLowerCase();
    const key = `${fn} ${ln}`;
    const fuzzyVal = nameIndex.get(key);
    if (fuzzyVal === AMBIGUOUS) return null;
    if (nameIndex.has(key)) return fuzzyVal;
  }

  // 4) Partial match on display_name
  for (const person of people) {
    if (person.id.toLowerCase() === cleanName.toLowerCase()) return person.slug;
  }

  return null;
}

function slugify(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Initialize Edge Maps ────────────────────────────────────────────────────

const parentEdges = new Map();    // childSlug -> Set(parentSlug)
const childEdges = new Map();     // parentSlug -> Set(childSlug)
const spouseEdges = new Map();    // slug -> Set(spouseSlug)
const siblingEdges = new Map();   // slug -> Set(siblingSlug)
// Step relationships (added 2026-09-22) — deliberately SEPARATE from the biological
// sets so a step-parent/stepchild can never be asserted as a blood relation.
const stepParentEdges = new Map(); // slug(child) -> Set(stepParentSlug)
// Tally of relationship types that are real but deliberately NOT written as direct
// edges (grandparents, in-laws, cousins …) or that were mapped to a non-biological
// edge (adoptive, partner). Exists so "unhandled" and "intentionally derived" are
// distinguishable at a glance — silence is what hid the Sibling/Spouses bug.
const derivedCounts = new Map();
const stepChildEdges = new Map();  // slug(stepParent) -> Set(stepChildSlug)

for (const person of people) {
  const slug = person.slug;
  parentEdges.set(slug, new Set());
  childEdges.set(slug, new Set());
  spouseEdges.set(slug, new Set());
  stepParentEdges.set(slug, new Set());
  stepChildEdges.set(slug, new Set());
  siblingEdges.set(slug, new Set());
}

// ─── Deduplicate Parents: Keep Only Biologically Plausible ────────────────────

// Some people (esp. with common names like "John Telfer") end up with multiple
// parent candidates from stub merging. Keep only the parent(s) whose birth year
// is 15-45 years before the child's birth year.

function deduplicateParents(people, parentEdges) {
  const slugToPerson = new Map(people.map(p => [p.slug, p]));
  let removed = 0;

  for (const [childSlug, parents] of parentEdges.entries()) {
    if (parents.size <= 2) continue; // At most 2 biological parents

    const child = slugToPerson.get(childSlug);
    if (!child?.birth_year) {
      // Child has no birth year — we can't judge age plausibility. But we CAN
      // still drop year-less parent stubs (unreliable fuzzy matches) when the
      // child also has been assigned a year-bearing parent. Keeps real parents,
      // removes poisoned stub fusions like a modern "Penny" grafted onto an
      // 1884-born ancestor.
      const datedParents = [...parents].filter(p => slugToPerson.get(p)?.birth_year);
      const stubParents = [...parents].filter(p => !slugToPerson.get(p)?.birth_year);
      if (datedParents.length > 0 && stubParents.length > 0) {
        stubParents.forEach(p => parents.delete(p));
        removed += stubParents.length;
      }
      continue;
    }

    const plausible = [];
    const noBirthYear = [];
    for (const parentSlug of parents) {
      const parent = slugToPerson.get(parentSlug);
      if (!parent?.birth_year) {
        noBirthYear.push(parentSlug);
        continue;
      }
      const diff = child.birth_year - parent.birth_year;
      if (diff >= 15 && diff <= 45) {
        plausible.push(parentSlug);
      }
      // Also keep if diff < 15 (too young to be parent) or diff > 45 (too old) - flag as implausible
    }

    // A living person cannot be the parent of a deceased person. This catches
    // year-less fusions (e.g. a modern "Penny Telfer" grafted onto an 1884-born
    // ancestor) that age logic alone can't reject when every candidate parent
    // is also year-less.
    if (child.is_living === false) {
      const livingParents = [...parents].filter(
        p => slugToPerson.get(p)?.is_living === true
      );
      if (livingParents.length < parents.size) {
        livingParents.forEach(p => parents.delete(p));
        removed += livingParents.length;
      }
    }

    // If we have plausible parents, remove any parents with no birth year (stubs)
    // Also remove implausible parents (too young/old)
    if (plausible.length > 0) {
      const toRemove = [...noBirthYear];
      for (const parentSlug of parents) {
        const parent = slugToPerson.get(parentSlug);
        if (parent?.birth_year) {
          const diff = child.birth_year - parent.birth_year;
          if (diff < 15 || diff > 50) { // 50 is more generous upper bound
            toRemove.push(parentSlug);
          }
        }
      }
      if (toRemove.length > 0 && toRemove.length < parents.size) {
        toRemove.forEach(p => parents.delete(p));
        removed += toRemove.length;
      }
    }
  }
  if (removed > 0) console.log(`🧹 Deduplicated parents: removed ${removed} implausible links`);
}

let resolved = 0, unresolved = 0;

// Add a parent->child edge only if it won't create a mutual-claim 2-cycle where
// one person claims the other as BOTH parent and child (the signature of a
// bare-name collision across generations). When a mutual claim exists, keep the
// direction that is biologically plausible (parent older than child by a
// reasonable margin); if neither direction is checkable (no years), keep the
// newly-added direction.
function addParentChild(parentSlug, childSlug, sourceSlug) {
  // A SIBLING IS NEVER A CHILD (2026-10-24).
  // If `parentSlug` already declares `childSlug` as its sibling, then `childSlug`
  // is the same generation as `parentSlug` and cannot also be its child. This is a
  // category error, not an edge case — and it is EXACTLY what the vault's own body
  // table does for William Telfer (1802–1850): its Children row wikilinks "Andrew
  // Telfer" to [[Andrew Telfer (1798–1858)]], who the same file declares as his
  // BROTHER (the page's own research note warns "Do NOT conflate with William's
  // sons of the same names"). Resolving that link wired a man as his own brother's
  // son. Refuse: a declared sibling edge outranks a bare same-name child ref, and
  // the ref stays on the record as an unbound raw name.
  if (siblingEdges.get(parentSlug)?.has(childSlug)) {
    console.warn(`   ⚠️ refused child claim: ${childSlug} -> ${parentSlug} (declared SIBLING of the parent)`);
    return false;
  }
  // If child already has this parent, nothing to do.
  if (parentEdges.get(childSlug)?.has(parentSlug)) return false;
  // GUARD (26 Aug 2026): biological plausibility — a parent must be an adult when
  // the child is born. When both years are known and the parent is not ≥13y older,
  // reject the edge outright (catches cross-branch false parents like a wife or
  // cousin wired as a child, or a bare-name ref resolving across generations).
  // UPPER BOUND ADDED 2026-09-22 (card tw-2026-09-22-011): the guard below only
  // rejected a child who was NOT OLDER than the parent — it placed NO ceiling on the
  // gap, so a man born 1774 could "father" a child born 1869 (95y) and one born 1761
  // a child born 1869 (108y). Those exact two edges were live. Measured against the
  // live tree: reciprocated parent->child gaps cluster at 58y and below, with clear
  // outliers at 67/74/95/105/108. 65 sits in that gap — comfortably above every
  // ordinary real gap while rejecting the generational collisions this card is about.
  // NOTE: this clears ONE-WAY implausible edges. Edges where BOTH files agree on a
  // wrong fact are a source problem and are not silently rewritten here.
  const MAX_PARENT_CHILD_GAP = 65;
  {
    const child = slugToPerson.get(childSlug);
    const parent = slugToPerson.get(parentSlug);
    const cBy = child?.birth_year, pBy = parent?.birth_year;
    if (cBy && pBy && (cBy - pBy) < 11) {
      console.warn(`   ⚠️ rejected impossible parent edge: ${childSlug}(b${cBy}) <- ${parentSlug}(b${pBy})`);
      return false;
    }
    if (cBy && pBy && (cBy - pBy) > MAX_PARENT_CHILD_GAP) {
      console.warn(`   ⚠️ rejected implausible parent gap: ${childSlug}(b${cBy}) <- ${parentSlug}(b${pBy}) [${cBy - pBy}y]`);
      return false;
    }
  }
  // If the reverse (parent claims child as ITS parent) is already recorded,
  // one of these claims is a bare-name collision across generations. Keep the
  // direction that is biologically plausible (parent older than child); if
  // neither/both are plausible (no years available), keep the existing.
  if (parentEdges.get(parentSlug)?.has(childSlug)) {
    const child = slugToPerson.get(childSlug);
    const parent = slugToPerson.get(parentSlug);
    const newDiff = child?.birth_year && parent?.birth_year
      ? child.birth_year - parent.birth_year : null;
    const existingDiff = child?.birth_year && parent?.birth_year
      ? parent.birth_year - child.birth_year : null;
    const newPlausible = newDiff !== null && newDiff >= 13 && newDiff <= 55;
    const existingPlausible = existingDiff !== null && existingDiff >= 13 && existingDiff <= 55;
    // Existing direction is plausible & new isn't → keep existing (skip new).
    if (existingPlausible && !newPlausible) return false;
    // New direction is plausible & existing isn't → drop existing, take new.
    if (newPlausible && !existingPlausible) {
      parentEdges.get(parentSlug).delete(childSlug);
      childEdges.get(childSlug).delete(parentSlug);
    } else {
      return false; // ambiguous / both plausible — keep what we have
    }
  }
  parentEdges.get(childSlug).add(parentSlug);
  childEdges.get(parentSlug).add(childSlug);
  return true;
}

// ─── Self-declared parents (2026-09-22, card tw-2026-09-22-011) ───────────────
// A person's OWN file declaring Father/Mother is the strongest evidence of their
// parentage. Previously it competed on equal terms with an INCOMING claim from
// someone else's Children list, and order decided the winner — so Ann Taylor
// (~1856) naming a "Peter Telfer" child silently REPLACED the modern Peter Telfer's
// own declared parents (John Robert Telfer + Robyn Telfer) with herself.
// Collect every slug that self-declares a parent, so the Children case below can
// refuse to overwrite it.
//
// FLAT-SCHEMA FILES COUNT TOO (2026-10-24). This set was built from
// `p.relationships` alone, which is EMPTY for the 8 vault files that use the older
// flat `father:`/`mother:` frontmatter — the converter puts those into
// `p.parents` and leaves `relationships` as []. Such a person therefore never
// registered as self-declared, and because the whole edge build below iterates
// `person.relationships`, their parentage produced NO EDGE AT ALL. William Baker
// (1853–1933) had the right parents in `parents[]` and still ended up an orphan
// with zero siblings, dragging 8 sibling links down with him. Treat a populated
// `parents` array as an equivalent self-declaration.
const SELF_DECLARED_PARENT = new Set();
for (const p of people) {
  for (const rel of p.relationships || []) {
    const t = String(rel.type || '').toLowerCase();
    if (t === 'father' || t === 'mother' || t === 'parent' || t === 'parents') {
      SELF_DECLARED_PARENT.add(p.slug);
      break;
    }
  }
  if ((p.parents || []).length > 0) SELF_DECLARED_PARENT.add(p.slug);
}

for (const person of people) {
  const sourceSlug = person.slug;

  // Process relationships from vault files
  // FLAT-SCHEMA SYNTHESIS (2026-10-24). The 8 vault files that use flat
  // `father:`/`mother:` frontmatter carry an EMPTY `relationships` array — the
  // converter put their parentage into `parents[]` instead. Iterating only
  // `relationships` therefore built no edges for them, so a correctly-parented
  // person rendered as an orphan and their siblings' links collapsed with them.
  // Synthesise equivalent Father/Mother entries from `parents[]` so the one edge
  // builder treats both vault schemas identically. Only used when `relationships`
  // produced no parent role at all, so the string form always stays authoritative.
  const relsForEdges = (() => {
    const declaredParentNames = (person.relationships || [])
      .filter(r => ['father', 'mother', 'parent', 'parents'].includes(String(r.type || '').toLowerCase()))
      .flatMap(r => r.names || []);
    if (declaredParentNames.length > 0) return person.relationships || [];
    const slugs = (person.parents || []).filter(x => slugToPerson.has(x));
    if (slugs.length === 0) return person.relationships || [];
    return [...(person.relationships || []), { type: 'Parents', names: slugs }];
  })();

  for (const rel of relsForEdges) {
    for (const name of rel.names || []) {
      const targetSlug = resolveNameToSlug(name, sourceSlug);
      if (!targetSlug) continue;

      // Skip self-references
      if (targetSlug === sourceSlug) continue;
      // SELF-REFERENCE: DELIBERATELY NOT CHECKED BY NAME (corrected 2026-10-25).
      //
      // I previously added a name-text guard here to strip rows like "Catherine Leah
      // Lawrie" from Catherine's own sibling list. It was the wrong instrument and it
      // caused real damage: 21 legitimate refs were dropped, because THIS check runs
      // after `targetSlug === sourceSlug` has already handled true self-reference, so
      // everything it caught was a ref naming a DIFFERENT person who happens to share
      // a name. Fathers called after their sons are ordinary in this family —
      // "james-telfer-1796 lists itself as Father" was his father James, not himself.
      // Name equality is not identity; a name shared across generations is evidence of
      // a real relationship, not a duplicate row.
      //
      // The Lawrie display artefact is a RENDERER concern and is fixed where it
      // belongs, in the profile page: a resolved self-link is drawn as plain text.
      // The graph keeps every real edge, and the crown-jewel guard stays honest.
      //

      // ── GENERATION GATE (2026-10-24, the neil-telfer father fix) ──────────
      // resolveNameToSlug is a NAME matcher: it has no idea whether the person it
      // found could possibly hold the relationship being asked for. resolve-refs.mjs
      // gates the raw-name→slug step, but a ref that arrives here from a parsed
      // `relationships:` string never passes through resolve-refs — so this path had
      // NO biology check at all.
      //
      // Consequence observed: Neil Ronald Telfer (b.1936) declares his father as
      // "John Ernest Telfer". Exactly one record answers to that name —
      // john-telfer-1877, born 1877 and died 1877 — so the name matched, and a man
      // who had been dead 59 years became the boy's father. The date-consistency
      // guard caught it, but a guard that only DETECTS is not a fix: the wrong edge
      // was already written. Refuse it at the source instead.
      //
      // Rules: only judge biological, dated relations; never touch step edges (a step
      // parent is not constrained by biology); if either side is undated, allow it —
      // absent dates are not evidence of impossibility.
      {
        // Only PARENT/CHILD claims are judged here. Sibling and spouse gaps have their
        // own bounds inside date-gate (SIBLING_SPAN, SPOUSE_SPAN) and the first version
        // of this gate wrongly ran them through the parent-child biology rule,
        // producing 776 bogus refusals like "siblings 2 years apart". A sibling is not
        // a parent; never apply a parent rule to them.
        const KIND = { Father: 'parent', Mother: 'parent', Parents: 'parent', Parent: 'parent',
                       Children: 'child', Child: 'child', Son: 'child', Daughter: 'child' }[rel.type];
        if (KIND) {
          const subj = slugToPerson.get(sourceSlug);
          const cand = slugToPerson.get(targetSlug);
          if (subj && cand && subj.birth_year != null && cand.birth_year != null) {
            // checkYears(relation, subject, candidate): `subject` is always the CHILD
            // and `candidate` is always the PARENT for relation 'parent'.
            //   Father/Mother claim: source declares the target as parent
            //                        → source is the child, target is the parent.
            //   Children claim:      source declares the target as a child
            //                        → source is the PARENT, target is the CHILD.
            // Getting this backwards silently refuses every legitimate child edge,
            // which is exactly what the first version of this gate did.
            const child  = KIND === 'parent' ? subj : cand;
            const parent = KIND === 'parent' ? cand : subj;
            const plaus = checkYears({
              relation: 'parent',
              subjectBirth: child.birth_year,
              subjectDeath: child.death_year,
              candBirth: parent.birth_year,
              candDeath: parent.death_year,
            });
            if (!plaus.ok) {
              console.warn(`   ⛔ refused impossible ${rel.type}: ${sourceSlug} -> ${targetSlug} (${plaus.reason})`);
              continue;
            }
          }
        }
      }

      // Ensure target exists in maps
      if (!parentEdges.has(targetSlug)) parentEdges.set(targetSlug, new Set());
      if (!childEdges.has(targetSlug)) childEdges.set(targetSlug, new Set());
      if (!spouseEdges.has(targetSlug)) spouseEdges.set(targetSlug, new Set());
      if (!siblingEdges.has(targetSlug)) siblingEdges.set(targetSlug, new Set());

      switch (rel.type) {
        case 'Father':
        case 'Mother':
        case 'Parent':
        case 'Parents':
          // SELF-DECLARATION WINS, BOTH DIRECTIONS (2026-10-24). The `Children`
          // case below refuses an incoming parent claim when the target has already
          // declared its own two parents — but this OUTGOING direction had no such
          // guard, so a bad `Children` entry on person A could still reach B and
          // rewrite B's parents through the unguarded side (observed: James
          // Telfer 1761's de-dated "William Telfer" child ref overwrote William
          // Telfer 1802's real parents, which in turn destroyed two sibling edges).
          // If the target has declared BOTH parents itself and neither is the
          // source, this claim is a same-name collision. Refuse it.
          {
            const target = slugToPerson.get(sourceSlug);
            const declared = (target?.relationships || [])
              .filter(r => ['father', 'mother', 'parent', 'parents'].includes(String(r.type || '').toLowerCase()))
              .flatMap(r => r.names || [])
              .map(n => resolveNameToSlug(n, sourceSlug))
              .filter(Boolean);
            if (declared.length >= 2 && !declared.includes(targetSlug) &&
                SELF_DECLARED_PARENT.has(sourceSlug)) {
              console.warn(`   ⚠️ refused outgoing parent claim: ${sourceSlug} -> ${targetSlug} (declares ${declared.join(', ')})`);
              break;
            }
          }
          addParentChild(targetSlug, sourceSlug);
          resolved++;
          break;

        case 'Children':
        case 'Child':
        case 'Son':
        case 'Daughter':
          // SELF-DECLARATION WINS (2026-09-22, card tw-2026-09-22-011). If the target
          // already declares its own parents, an INCOMING claim from this person's
          // Children list must not overwrite that. It may still ADD itself when the
          // target declares nothing or only one parent (a person can have two, and
          // one side may simply not be recorded) — but where the target has declared
          // BOTH parents and this person is neither, the claim is a same-name
          // collision and is refused.
          {
            const target = slugToPerson.get(targetSlug);
            const declared = (target?.relationships || [])
              .filter(r => ['father', 'mother', 'parent', 'parents'].includes(String(r.type || '').toLowerCase()))
              .flatMap(r => r.names || [])
              .map(n => resolveNameToSlug(n, targetSlug))
              .filter(Boolean);
            if (declared.length >= 2 && !declared.includes(sourceSlug) &&
                SELF_DECLARED_PARENT.has(targetSlug)) {
              console.warn(`   ⚠️ refused incoming parent claim: ${sourceSlug} -> ${targetSlug} (target declares ${declared.join(', ')})`);
              break;
            }
          }
          addParentChild(sourceSlug, targetSlug);
          resolved++;
          break;

        case 'Spouse':
        case 'Spouses':   // FIXED 2026-10-25 — plural form was silently dropped (3 edges lost)
        // Ordinal spouse labels: 'Spouse (2nd)', 'Spouse (1st)', 'Wife (2nd)' …
        // FIXED 2026-10-25 — the ordinal suffix defeated an exact-match switch.
        case 'Spouse (2nd)':
        case 'Spouse (1st)':
        case 'Spouse (3rd)':
        case 'Wife (2nd)':
        case 'Husband (2nd)':
        case 'Wife':
        case 'Husband':
          // GUARD (2026-09-22): spouse plausibility. The parent-edge guard has a
          // biology check; spouse edges had NONE, so a fuzzy first+last collision
          // married across generations. Observed: Joseph Farrow (1814–1899)'s vault
          // ref "Elizabeth Float Smith (m. 1870)" resolved to Elizabeth Anne Smith
          // (b. 1878) — a 64-year age gap — because both fuzzy-key to
          // "elizabeth smith". Two people cannot marry across such a gap; treat it
          // as a name collision and reject the edge rather than assert a false
          // marriage. Threshold is deliberately generous (a real marriage can span
          // ~40y) so only impossible pairings are dropped.
          {
            const a = slugToPerson.get(sourceSlug);
            const b = slugToPerson.get(targetSlug);
            const ay = a?.birth_year, by = b?.birth_year;
            if (ay && by && Math.abs(ay - by) > 55) {
              console.warn(`   ⚠️ rejected implausible spouse edge: ${sourceSlug}(b${ay}) <-> ${targetSlug}(b${by})`);
              break;
            }
          }
          spouseEdges.get(sourceSlug).add(targetSlug);
          spouseEdges.get(targetSlug).add(sourceSlug);
          resolved++;
          break;

        // FIXED 2026-10-25 (THE TELFER SIBLING ASYMMETRY — a one-word mismatch).
        //
        // The vault writes `Sibling: John Telfer (b. ~1791, England)` — SINGULAR.
        // This switch only listed 'Siblings' (plural) plus Brother/Sister/Half-siblings,
        // so a singular 'Sibling' fell past every case into the silent default: the ref
        // resolved perfectly, `resolved++` never ran, NO edge was written, and no warning
        // was printed anywhere. John and Elisabeth each declared the other, each resolved
        // the other, and neither array ever got the edge — the "asymmetry" was really a
        // total absence wearing a lopsided disguise.
        //
        // Both spellings are legitimate vault prose. Accept both, and make an unknown
        // type LOUD (see default below) so the next such gap cannot hide in silence.
        case 'Sibling':
        case 'Siblings':
        case 'Brother':
        case 'Sisters':
        case 'Sister':
        case 'Half-sibling':
        case 'Half-siblings':
        case 'Half-brother':  // FIXED 2026-10-25 — singular forms were silently dropped
        case 'Half-sister':
          siblingEdges.get(sourceSlug).add(targetSlug);
          siblingEdges.get(targetSlug).add(sourceSlug);
          resolved++;
          break;

        case 'Adoptive Brother':
        case 'Adoptive Sister':
        case 'Adoptive Mother':
        case 'Adoptive Father':
          // Treat as regular relationship for graph
          if (rel.type.includes('Father') || rel.type.includes('Mother')) {
            parentEdges.get(sourceSlug).add(targetSlug);
            childEdges.get(targetSlug).add(sourceSlug);
          } else {
            siblingEdges.get(sourceSlug).add(targetSlug);
            siblingEdges.get(targetSlug).add(sourceSlug);
          }
          resolved++;
          break;

        case 'Stepchildren':
          // FIXED 2026-09-22: this used to add a full parent->child edge, identical
          // to `Children`, so a stepchild rendered as a BIOLOGICAL child. Rex's vault
          // file states outright "Robert is his STEPFATHER, not his father" while the
          // graph asserted the opposite. Step edges are tracked separately and never
          // enter childEdges/parentEdges.
          stepChildEdges.get(sourceSlug).add(targetSlug);
          stepParentEdges.get(targetSlug).add(sourceSlug);
          resolved++;
          break;

        case 'Stepfather':
        case 'Step-mother':   // FIXED 2026-10-25 — hyphenated form was silently dropped
        case 'Step-father':
        case 'Stepmother':
        case 'Stepparent':
        case 'Step-parent':
          // Previously UNHANDLED — fell to `default:` and was silently dropped.
          stepParentEdges.get(sourceSlug).add(targetSlug);
          stepChildEdges.get(targetSlug).add(sourceSlug);
          resolved++;
          break;

        // DERIVED RELATIONS — deliberately NOT turned into direct edges.
        //
        // A grandparent is reachable by walking two parent edges; a father-in-law
        // through a spouse then a parent. Writing them as direct edges would
        // double-count the graph and misreport the person's own closeness.
        // They are COUNTED and SUMMARISED rather than silently dropped, so the
        // total is still accountable: nothing vanishes without appearing in a tally.
        case 'Grandmother':
        case 'Grandfather':
        case 'Grandparent':
        case 'Grandparents':
        case 'Grandson':
        case 'Granddaughter':
        case 'Grandchild':
        case 'Grandchildren':
        case 'Great-grandmother':
        case 'Great-grandfather':
        case 'Father-in-law':
        case 'Mother-in-law':
        case 'Son-in-law':
        case 'Daughter-in-law':
        case 'Brother-in-law':
        case 'Sister-in-law':
        case 'Cousin':
        case 'Uncle':
        case 'Aunt':
        case 'Nephew':
        case 'Niece':
          derivedCounts.set(rel.type, (derivedCounts.get(rel.type) || 0) + 1);
          break;

        // ADOPTIVE PARENTS — real, and different from step-parents.
        // FIXED 2026-10-25: these were being swallowed. An adoptive parent is a
        // parent for the purposes of this graph (the child is raised by them), but
        // must stay distinguishable from a biological claim, so it is recorded as a
        // step/community parent edge and the label is preserved in the tally.
        case 'Father (adoptive)':
        case 'Mother (adoptive)':
        case 'Adoptive father':
        case 'Adoptive mother':
          // Matches the existing 'Adoptive Father'/'Adoptive Mother' case above:
          // recorded as a parent edge so the page links, tallied separately so the
          // biological claim is never implied.
          parentEdges.get(sourceSlug).add(targetSlug);
          childEdges.get(targetSlug).add(sourceSlug);
          derivedCounts.set(rel.type, (derivedCounts.get(rel.type) || 0) + 1);
          resolved++;
          break;

        case 'Partner':
          // FIXED 2026-10-25: an unmarried partner is a REAL relationship. Recorded
          // as a spouse edge so the page links them, but tallied separately so no
          // marriage is implied.
          spouseEdges.get(sourceSlug).add(targetSlug);
          spouseEdges.get(targetSlug).add(sourceSlug);
          derivedCounts.set(rel.type, (derivedCounts.get(rel.type) || 0) + 1);
          resolved++;
          break;

        default:
          // FIXED 2026-10-25 — THIS `default` WAS THE SILENT HOLE.
          //
          // It used to say "Other relationship types - just note" and then note
          // NOTHING. The ref had already resolved to a real person, so the graph knew
          // the edge existed and threw it away without a word. That is how a single
          // unmatched word ('Sibling' vs 'Siblings') produced a relationship that was
          // declared on BOTH sides of the vault, resolved on BOTH sides, and appeared
          // on NEITHER side of the output — with the pipeline reporting success.
          //
          // A resolved ref that hits an unknown type is a BUG, not a no-op: either the
          // vault uses a spelling this switch does not know, or a new relation was
          // added upstream. Say so, loudly, with the names, so it can be fixed at the
          // cause. This is a warning rather than a throw because one odd relation in
          // one vault file must not block a whole-site build.
          console.warn(
            `   ⚠️ UNHANDLED relationship type "${rel.type}" — ${sourceSlug} -> ${targetSlug} ` +
            `(resolved, but no edge written; add the spelling to this switch)`
          );
          break;
      }
    }
  }

  // DO NOT RE-INGEST THE DERIVED ARRAYS (2026-10-24 — root cause of the
  // self-perpetuating false edge).
  //
  // This block used to walk `person.parents` / `person.children` / `person.spouses`
  // / `person.siblings` / `person.step_*` and re-assert every slug it found. Those
  // arrays are OUTPUT of this very script — they are written back into people.json
  // at the end of every run — so reading them at the start made every edge
  // SELF-CONFIRMING: once one bad edge existed, it survived every future
  // regeneration no matter how good the name resolver became, because the derived
  // array fed it straight back in. That is exactly how
  // `william-telfer-1802.parents = ["james-telfer-1761"]` (created by one de-dated
  // "William Telfer" ref in James 1761's Children list) became permanent, stripping
  // William's real parents and two sibling edges and turning the crown-jewel guard
  // red on every run.
  //
  // The vault frontmatter (`relationships:`) is the ONLY source of truth. The arrays
  // are derived; derived values must never be treated as evidence. Every genuine
  // edge is rebuilt from `relationships:` above, on every run. An edge that cannot
  // be rebuilt from the vault simply does not exist — which is the correct outcome,
  // because the vault is the thing that gets to say so.
}

// ─── Second Pass: Infer Siblings from Shared Parents ──────────────────────────

for (const [childSlug, parents] of parentEdges) {
  const parentList = Array.from(parents);
  if (parentList.length >= 2) {
    // Find all other children of these parents
    for (const otherChild of childEdges.get(parentList[0]) || []) {
      if (otherChild !== childSlug &&
          parentList.every(p => childEdges.get(p)?.has(otherChild))) {
        siblingEdges.get(childSlug).add(otherChild);
        siblingEdges.get(otherChild).add(childSlug);
      }
    }
  }
}

// Call deduplication after all edges are built, before converting to arrays
deduplicateParents(people, parentEdges);

// ─── Disputed parentage must not be asserted (card tw-2026-09-13-031) ─────────
// The vault can declare `parentage_status: unproven` (Agnes Telfer (1848-?) is the
// live case: she appears in none of the three gold family books and not in the 1851
// Jedburgh census). convert-markdown.mjs carries that flag through, but THIS file
// is the authority for parents[]/siblings[] — it rebuilds them from the graph,
// so the gate has to be applied here too or it is silently discarded upstream.
//
// Chosen behaviour (option (b), 13 Sep 2026): an unproven parent link is NOT emitted
// as a machine-readable relationship. It is recorded in disputed_parent_refs instead.
// The body prose still carries the whole dispute, so nothing is hidden — it simply is
// not asserted as fact.
//
// This also closes the second-order leak: the sibling-inference pass above builds
// siblings from shared parents, so leaving the parent edge in place would have
// silently manufactured brothers and sisters for a disputed person.
const UNPROVEN = new Set(
  people.filter(p => String(p.parentage_status || '').toLowerCase() === 'unproven').map(p => p.slug)
);

for (const slug of UNPROVEN) {
  const claimed = parentEdges.get(slug);
  if (claimed && claimed.size > 0) {
    const rec = people.find(p => p.slug === slug);
    if (rec) {
      // slugs only — the display names are already in rec.relationships, and
      // mixing both forms here produced duplicates on the first run.
      rec.disputed_parent_refs = Array.from(claimed).sort();
      rec.parents = [];
    }
  }
  parentEdges.delete(slug);
  // and drop the reverse edge so the disputed child is not listed as anyone's child
  for (const [, kids] of childEdges) kids.delete(slug);
}
// rebuild sibling edges for disputed people: they have no asserted siblings from this
for (const slug of UNPROVEN) siblingEdges.set(slug, new Set());

// ─── Deduplicate and Convert to Arrays ────────────────────────────────────────
//
// 2026-10-24 — THE DATA-LOSS FIX. Read this before changing anything below.
//
// These arrays used to be OVERWRITTEN wholesale from the edge maps:
//     person.children = Array.from(childEdges.get(slug) || []).sort();
// So any relationship entry that resolveNameToSlug() could not bind was DELETED
// from people.json. resolveNameToSlug() refusing a ref is CORRECT — it declines to
// guess a generation. But refusing to RESOLVE is not permission to ERASE: the raw
// name is the only surviving record that the relationship exists.
//
// Measured consequence on the same day: john-lawrie-1810 went from 8 children to 1
// because "Marion Lawrie (1838–1920)", "Janet Lawrie (1842–1845)" and others have
// no profile yet. The people were never wrong and the vault never changed; the
// graph step simply had nowhere to put them and dropped them. Every previous
// "the pipeline lost my family" incident traces to this line.
//
// RULE: THE EDGE MAPS ARE THE TRUTH FOR SLUGS; THEY ARE NOT THE TRUTH FOR PEOPLE.
// Slugs get rebuilt from scratch (that is what keeps the graph consistent), but an
// entry that is still a RAW NAME — i.e. one the resolver could not bind — is
// CARRIED FORWARD untouched. It renders as a research gap, exactly as designed.
// A person can never be silently deleted by a failed name lookup again.
const RAW_REF = (s) => typeof s === 'string' && !slugToPerson.has(s);

// ── Is this raw name the SAME PERSON as a slug already in the rebuilt list? ───
// Added 2026-10-24. Without this, carryUnresolved preserved a raw name that
// duplicated a slug it plainly meant. Live example: janet-nichol.spouses came out
// as ["william-telfer-shepherd", "William Telfer (shepherd)"] — the same man twice,
// one resolved one not, because ONE vault line wrote the slug and another wrote the
// raw name. Carrying that forward is not preserving a research gap; it is
// double-listing a person, and the renderer shows him married to her twice.
// Rule: a raw name that resolves to a slug ALREADY PRESENT is a duplicate, not a gap.
const normName = (s) => String(s)
  .replace(/\s*\([^)]*\)\s*$/, '')      // drop a trailing "(shepherd)" / "(1802–1850)"
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

function duplicateOfPresentSlug(ref, rebuilt) {
  const key = normName(ref);
  if (!key) return false;
  for (const s of rebuilt) {
    const target = slugToPerson.get(s);
    if (!target) continue;
    if (normName(target.display_name || '') === key) return true;
    if (normName(target.name || '') === key) return true;
  }
  return false;
}

function carryUnresolved(person, field, rebuilt, keepResolvedSlugs = false) {
  const previous = Array.isArray(person[field]) ? person[field] : [];
  const rebuiltSet = new Set(rebuilt);
  // TWO RULES, ONE FIELD-LOCAL DIFFERENCE (2026-10-24). The step arrays arrive here
  // ALREADY RESOLVED to slugs (resolve-refs.mjs runs before this script) and their
  // step edge maps are only ever filled from `relationships:` frontmatter, so a
  // correct slug like "allen-merrick" is not in `rebuilt` yet must be kept —
  // otherwise Mark Kenneth Telfer loses both step-parents and Tim loses his four
  // Ivory stepchildren. Biological arrays are different: they are rebuilt from the
  // relationship string this run, so anything not in `rebuilt` is genuinely
  // unresolved and must be a RAW name. Applying the step rule to biological fields
  // preserved stale slugs that had been correctly superseded — the same-name
  // contamination gate caught exactly that (siblings that are really children).
  const kept = previous.filter(ref =>
    typeof ref === 'string' && ref.trim() &&
    (keepResolvedSlugs ? !rebuiltSet.has(ref) : (RAW_REF(ref) && !rebuiltSet.has(ref)))
  );
  if (kept.length === 0) return rebuilt;
  // Preserve any raw name the rebuilt list does not already contain, keeping the
  // vault's original order for the raw entries after the resolved ones.
  const out = [...rebuilt];
  for (const ref of kept) {
    if (out.includes(ref)) continue;              // exact duplicate of a surviving raw name
    if (duplicateOfPresentSlug(ref, out)) continue; // same PERSON as a slug already listed
    if (reciprocallyRecorded(ref, person, field, out)) continue; // edge already exists, resolved
    out.push(ref);
  }
  return out;
}

/**
 * ADDED 2026-10-24 — is the relationship already on the OTHER person as a slug?
 *
 * Live case: william-telfer-1802 lists parent "William Telfer (shepherd)", while
 * william-telfer-shepherd already lists william-telfer-1802 in his children. Both
 * halves describe ONE edge, but this side never got resolved. carryUnresolved only
 * compares within one person's own field, so it kept the raw name and the site showed
 * a father listed twice — once by slug, once by name.
 *
 * If the target already claims this person in the reciprocal field, the edge is not
 * missing; it is recorded. Drop the raw name and let the slug side speak.
 * One-directional evidence is NOT enough: we only skip when the target itself
 * asserts the relationship, never on a name guess.
 */
function reciprocallyRecorded(ref, person, field, rebuilt) {
  const target = resolveNameToSlug(ref, person, field) || slugByExactDisplay(ref);
  if (!target) return false;
  const t = slugToPerson.get(target);
  if (!t) return false;
  const wantsUs = (arr) => Array.isArray(arr) && arr.includes(person.slug);
  if (field === 'parents') return wantsUs(t.children);
  if (field === 'children') return wantsUs(t.parents);
  if (field === 'spouses') return wantsUs(t.spouses);
  if (field === 'siblings') return wantsUs(t.siblings);
  return false;
}

/** Exact display_name match → slug. Used only for the reciprocity test above. */
function slugByExactDisplay(ref) {
  const key = String(ref).toLowerCase().trim();
  for (const [slug, p] of slugToPerson) {
    if (String(p.display_name || '').toLowerCase().trim() === key) return slug;
  }
  return null;
}

for (const person of people) {
  const slug = person.slug;
  person.parents = carryUnresolved(person, 'parents', Array.from(parentEdges.get(slug) || []).sort());
  person.children = carryUnresolved(person, 'children', Array.from(childEdges.get(slug) || []).sort());
  person.spouses = carryUnresolved(person, 'spouses', Array.from(spouseEdges.get(slug) || []).sort());
  person.siblings = carryUnresolved(person, 'siblings', Array.from(siblingEdges.get(slug) || []).sort());
  // Step arrays (added 2026-09-22). Emitted alongside the biological ones so the
  // renderer can show a labelled "Step-parent(s)"/"Stepchildren" section. A slug
  // must never appear in BOTH a biological and a step array — Rex's page claimed
  // Robert as a parent while his own file says Robert is his STEPFATHER, not his
  // father. If a person is recorded as a step relation, that wins.
  const stepP = Array.from(stepParentEdges.get(slug) || []).sort();
  const stepC = Array.from(stepChildEdges.get(slug) || []).sort();
  if (stepP.length || stepC.length) {
    const stepSet = new Set([...stepP, ...stepC]);
    person.parents = person.parents.filter(s => !stepSet.has(s));
    person.children = person.children.filter(s => !stepSet.has(s));
  }
  // STEP RELATIONS GET THE SAME CARRY RULE AS BIOLOGICAL ONES (2026-10-24).
  //
  // stepP/stepC above are built ONLY from stepParentEdges/stepChildEdges, which are
  // populated when a raw name RESOLVES to a slug. An unresolved step relation —
  // "**Stepfather:** [[Allen Merrick]]" where no profile exists yet, or a name the
  // resolver correctly refuses — therefore vanished completely: the raw name was
  // thrown away and the assignment below wrote an empty array over it. Mark Kenneth
  // Telfer's own step-parents, Tim's four Ivory stepchildren and the Lawrie step-link
  // all disappeared this way while the vault still said so in plain English.
  //
  // The blank slate is fine for SLUGS (the edge maps are truth for slugs) but it is
  // not licence to delete a PERSON. Same rule as every other field: carry raw names
  // forward, keep them unbound, render them as a research gap.
  person.step_parents = carryUnresolved(person, 'step_parents', stepP, true);
  person.step_children = carryUnresolved(person, 'step_children', stepC, true);
}

// ─── Build Graph Output ──────────────────────────────────────────────────────

const graph = {
  nodes: people.map(p => ({ slug: p.slug, id: p.id, generation: p.generation, branch: p.branch })),
  edges: {
    parentOf: [],
    spouseOf: [],
    siblingOf: [],
    stepParentOf: [],
    stepChildOf: []
  }
};

// ── EDGES ARE SLUG-ONLY (added 2026-10-24) ───────────────────────────────────
// A raw name is preserved on the person record so a research gap stays visible and
// nothing is lost — but a raw name is NOT a node, so an edge to one renders as a
// ghost link pointing at nobody. The 63 endpoints that failed the edge-integrity
// guard on 2026-10-24 were exactly this: carryUnresolved() doing its job, then the
// edge builder treating every preserved name as if it were a person.
// Rule: an edge requires BOTH ends to be real slugs. Unresolved names stay on the
// person record (where the UI can show "no profile yet") and never enter the graph.
const knownSlugs = new Set(people.map(p => p.slug));
const emit = (bucket, from, to) => {
  if (!knownSlugs.has(from) || !knownSlugs.has(to)) return false;
  bucket.push({ from, to });
  return true;
};
let skippedEdges = 0;

for (const person of people) {
  for (const parent of person.parents) {
    if (!emit(graph.edges.parentOf, parent, person.slug)) skippedEdges++;
  }
  for (const spouse of person.spouses) {
    if (person.slug < spouse) { // avoid duplicates
      if (!emit(graph.edges.spouseOf, person.slug, spouse)) skippedEdges++;
    }
  }
  for (const sibling of person.siblings) {
    if (person.slug < sibling) {
      if (!emit(graph.edges.siblingOf, person.slug, sibling)) skippedEdges++;
    }
  }
  // Step edges (added 2026-09-22). Emitted separately and NEVER merged into
  // parentOf, so a consumer cannot mistake a step relation for a blood relation.
  for (const sp of person.step_parents || []) {
    if (!emit(graph.edges.stepParentOf, sp, person.slug)) skippedEdges++;
  }
  for (const sc of person.step_children || []) {
    if (!emit(graph.edges.stepChildOf, person.slug, sc)) skippedEdges++;
  }
}

if (skippedEdges > 0) {
  console.log(`   Skipped ${skippedEdges} edge(s) whose other end has no profile (raw names stay on the person record, never in the graph).`);
}

// ─── Save ────────────────────────────────────────────────────────────────────

fs.writeFileSync(PEOPLE_PATH, JSON.stringify(people, null, 2));
fs.writeFileSync(GRAPH_PATH, JSON.stringify(graph, null, 2));

console.log(`✅ Updated ${PEOPLE_PATH}`);
console.log(`✅ Written ${GRAPH_PATH}`);
console.log(`\n📊 Relationship Stats:`);
console.log(`   Parent edges: ${graph.edges.parentOf.length}`);
console.log(`   Spouse edges: ${graph.edges.spouseOf.length}`);
console.log(`   Sibling edges: ${graph.edges.siblingOf.length}`);
  if (derivedCounts.size > 0) {
    const total = [...derivedCounts.values()].reduce((a, b) => a + b, 0);
    console.log(`   Derived / non-biological refs (tallied, not direct edges): ${total}`);
    for (const [t, n] of [...derivedCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`     • ${t}: ${n}`);
    }
  }