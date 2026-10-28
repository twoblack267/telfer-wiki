#!/usr/bin/env node
/**
 * resolve-refs.mjs — v3 (fixed lifespan parsing)
 *
 * Resolves name-based references in people.json to proper slugs.
 * Uses contextual disambiguation (birth/death years, parent/child age ranges).
 *
 * Usage: node scripts/resolve-refs.mjs [--write]
 */

import fs from 'fs';
import { checkYears } from './lib/date-gate.mjs';

/**
 * Relations whose dates can be judged against. Must stay in step with date-gate.mjs
 * (which exports its own copy as a private constant); 'spouse' is included because
 * date-gate bounds it, but no spouse reference is ever REFUSED on dates alone here —
 * date-gate only rejects gaps beyond SPOUSE_SPAN.
 */
const JUDGEABLE_RELATIONS = new Set(['parent', 'child', 'sibling', 'spouse']);

const PEOPLE_JSON = './src/data/people.json';
const people = JSON.parse(fs.readFileSync(PEOPLE_JSON, 'utf-8'));

// ── Build slug set ──────────────────────────────
const slugSet = new Set(people.map(p => p.slug));

// ── Build comprehensive lookup indices ───────────

const byDisplay = new Map();           // exact display_name → slug
const byDisplayCollisions = new Set(); // display_name claimed by more than one slug
const yearAnnotatedKeys = new Set();   // display strings that ARE year annotations, not name qualifiers
const byDisplayWithYears = new Map();  // "Display Name (YYYY–YYYY)" → slug
const byName = new Map();              // "first last" → [{slug, birth, death, display}, ...]
const byFullName = new Map();          // "first middle last" → [{slug, birth, death, display}, ...]
const byBirthYear = new Map();         // slug → birth_year
const bySlug = new Map();              // slug → person object

people.forEach(p => {
  bySlug.set(p.slug, p);
  const display = p.display_name?.toLowerCase().trim();
  const short = `${p.first_name} ${p.last_name}`.toLowerCase().trim();
  const full = [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ').toLowerCase().trim();
  const deathStr = p.death_year || '?';

  // 2026-10-28: the vault's LIVING-person form puts the year in the TITLE
  // ("James Telfer (b. 1979)") while the structured birth_year field stays null —
  // 61 records were in exactly that state. Every date-aware index and gate below
  // reads dates from birth_year, so a ref of "James Telfer (b. 1979)" parsed to
  // 1979, found no candidate carrying that year, and fell through the ambiguity
  // gate to null: the child edge never formed and the person stranded at gen 99.
  // Deriving the year from the title restores evidence the vault already holds.
  // It is NOT a guess: the year is written verbatim in the profile's own filename.
  const birthYear = p.birth_year || (() => {
    const t = p.title || '';
    const born = t.match(/\(\s*b\.?\s*(\d{4})\s*\)/i);
    if (born) return parseInt(born[1]);
    const span = t.match(/\(~?(\d{4})\s*[–-]/);
    if (span) return parseInt(span[1]);
    return null;
  })();
  
  // Build year-annotated versions for all name forms
  if (birthYear) {
    // "Mark Telfer (1877–1946)", "Mark Telfer (1877–living)", etc.
    [short, full, display].filter(Boolean).forEach(nameForm => {
      if (nameForm === short || nameForm === full || nameForm === display) {
        // deduplicate — only add each unique name+year combo once
        const keyLiving = `${nameForm} (${birthYear}–living)`;
        const keyUnknown = `${nameForm} (${birthYear}–?)`;
        if (!byDisplayWithYears.has(keyLiving)) byDisplayWithYears.set(keyLiving, p.slug);
        if (!byDisplayWithYears.has(keyUnknown)) byDisplayWithYears.set(keyUnknown, p.slug);
        if (p.death_year) {
          const keyDeath = `${nameForm} (${birthYear}–${p.death_year})`;
          if (!byDisplayWithYears.has(keyDeath)) byDisplayWithYears.set(keyDeath, p.slug);
        }
      }
    });
  }
  
  if (byDisplay.has(display)) {
    if (byDisplay.get(display) !== p.slug) byDisplayCollisions.add(display);
  } else {
    byDisplay.set(display, p.slug);
  }
  // A display_name ending in a parenthetical lifespan/year is an ANNOTATION, not a name
  // qualifier — it must never win the qualifier short-circuit above.
  if (/\s*\([~]?\d{3,4}\s*[–-]?[^)]*\)\s*$/.test(p.display_name || '')) yearAnnotatedKeys.add(display);
  
  // Store all matches for short names (duplicates)
  if (!byName.has(short)) byName.set(short, []);
  byName.get(short).push({ slug: p.slug, birth: birthYear, death: p.death_year, display });
  
  if (full && full !== short) {
    if (!byFullName.has(full)) byFullName.set(full, []);
    byFullName.get(full).push({ slug: p.slug, birth: birthYear, death: p.death_year, display });
  }
  
  byBirthYear.set(p.slug, birthYear);
});

// ── Helpers ──────────────────────────────────────

function stripLifespan(name) {
  // Matches (1761–1845), (1761–living), (1761–?), (1840-1913), (~1731–?)
  // FIXED 2026-09-22: also strip non-lifespan annotations such as "(fl. 1998)"
  // — the vault's form for a living person with no birth year. Without this the
  // ref kept its parenthetical, matched no record, fell through to a bare/fuzzy
  // match, and captured a same-named 19th-century namesake.
  // FIXED 2026-10-26 (THE STRIP WAS ANCHORED TO THE END AND RAN ONLY ONCE):
  // `Clara Ann Millicent (Dunn) Telfer (1878–1966)` lost its lifespan and kept
  // `(Dunn)` welded mid-name — a string that matches NO index key, so every
  // reference to a married woman was refused and her reciprocal edges died with
  // her Self line. The maiden name is a SECOND parenthetical; strip all of them.
  // Measured before: 11 of the 14 double-parenthetical vault names resolved to null.
  let out = name.trim();
  // Remove every lifespan-looking group, anchored only at the group itself.
  out = out.replace(/\s*\([~]?\d{4}\s*[–-]\s*(?:\d{4}|living|\?)?\s*\)/gi, ' ');
  // "(fl. 1998)", "(fl 1998)"
  out = out.replace(/\s*\(fl\.?\s*\d{3,4}\)/gi, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

// FIXED 2026-10-25 (the `b. ~YYYY` form is a YEAR, not a name).
//
// The Telfer ancestors are written `John Telfer (b. ~1791, England)` and
// `Elisabeth Telfer (b. ~1806, England)` — the `b.` marks an ESTIMATE, and the
// vault is honest enough to say so. Both resolvers demanded a bare digit straight
// after the bracket, so this form matched no year pattern at all: the ref was
// treated as a NAME, reduced to the bare "john telfer" (shared by several Johns →
// ambiguous → refused) and the reciprocal sibling edge was never written. Measured
// before the fix: `resolveNameToSlug("John Telfer (b. ~1791, England)")` → null,
// i.e. John could not resolve his own Self line, so `john-telfer-1791.siblings`
// stayed [] while Elisabeth's held the raw string.
//
// An approximate year is still evidence. Accepting `b.` / `~` / `c.` / `ca.` /
// `abt` here does not license guessing: the year is still matched EXACTLY against
// a record's birth_year, so a ref carrying 1791 binds only to a person recorded
// 1791 — never to a same-named ancestor from another generation.
function extractYears(name) {
  // Extract birth from "James Telfer (1761–1845)", "Mark Telfer (1986–living)",
  // "John Telfer (~1731–?)", or "John Telfer (b. ~1791, England)".
  //
  // 2026-10-28: a `(m. YYYY)` marriage year is NOT a birth year. Previously the
  // pattern below found no match for "(m. 1870)" and returned null — which was
  // correct — but the caller then fell through to a bare-name bind and silently
  // attached a woman born 1878 as the second wife of a man born 1814. The
  // refusal is now EXPLICIT so a marriage year can never be mistaken for a
  // birth year, and the name-matching layer is told the ref is date-bearing.
  if (/\(\s*m\.?\s*\d{4}/i.test(name)) {
    return { birth: null, death: null, marriageOnly: true };
  }
  // Born and died the same year: "John Dillon (b. & d. 1882)". The lifespan
  // regex below cannot see this form, so the year was invisible to the date
  // gate and an infant bound onto his own father. Handled before lifespan.
  const bd = name.match(/\(\s*b\.?\s*&\s*d\.?\s*(\d{4})\s*\)/i);
  if (bd) return { birth: parseInt(bd[1]), death: parseInt(bd[1]) };
  // First try full lifespan: YYYY–YYYY or YYYY–living or YYYY–?
  const match = name.match(/\(\s*(?:b\.?\s*|c\.?\s*|ca\.?\s*|abt\.?\s*|about\s*|~+\s*)*(\d{4})\s*[–-]\s*(\d{4}|living|\?)\s*[,)]/i);
  if (match) {
    const death = match[2] === 'living' || match[2] === '?' ? null : parseInt(match[2]);
    return { birth: parseInt(match[1]), death };
  }
  // Just a single year: "John Telfer (1847)" — also "(b. ~1791, England)".
  const single = name.match(/\(\s*(?:b\.?\s*|c\.?\s*|ca\.?\s*|abt\.?\s*|about\s*|~+\s*)*(\d{4})\b/i);
  if (single) return { birth: parseInt(single[1]), death: null };
  return null;
}

function stripAnnotation(name) {
  // FIXED 2026-10-26: was `/[^)]+\)$/` — trailing only, so a married woman's
  // `(Dunn)` survived. Strip EVERY parenthetical group.
  // Guard: never strip a lone group that IS the whole name (e.g. "(unknown)").
  const stripped = String(name || '').replace(/\s*\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  return stripped || String(name || '').trim();
}

function lowerTrim(s) {
  return s.toLowerCase().trim();
}

function pickBestMatch(candidates, context) {
  // context = { subjectBirth, relation }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].slug;
  
  const { subjectBirth, relation } = context || {};
  
  // Parent: must be born BEFORE child, and not too close (< 12 years gap)
  if (relation === 'parent' && subjectBirth != null) {
    const valid = candidates.filter(c => {
      if (c.birth == null) return true; // can't rule out
      return c.birth < subjectBirth && (subjectBirth - c.birth) >= 12;
    });
    if (valid.length === 1) return valid[0].slug;
    // Pick the one with latest birth (closest but before child)
    const sorted = valid.sort((a, b) => (b.birth ?? 0) - (a.birth ?? 0));
    if (sorted.length > 0) return sorted[0].slug;
  }
  
  // Child: must be born AFTER parent.
  if (relation === 'child' && subjectBirth != null) {
    const valid = candidates.filter(c => {
      if (c.birth == null) return true;
      return c.birth > subjectBirth;
    });
    if (valid.length === 1) return valid[0].slug;
    if (valid.length > 1) {
      // AMBIGUITY RULE (2026-09-22, card tw-2026-09-22-011). Previously this sorted
      // by proximity and returned the first — a SILENT bind that fabricated edges.
      // Observed: four people (b.1774, b.1761, b.1802, b.1856) each claimed the same
      // 1869 William Telfer as a child, because a bare "William Telfer" ref matched
      // several same-named people and order decided the winner.
      // Both external reviewers (Nemotron 3 Ultra, Grok 4.20) gave the same ruling:
      // when a ref is genuinely ambiguous, keep the RAW NAME and leave a visible gap
      // rather than invent a relationship. A missing link can be researched later; a
      // fabricated one silently corrupts the tree.
      // Guard: only refuse when NO candidate is uniquely closest — i.e. two or more
      // are equally plausible. If one is clearly nearest, that is still a judgement
      // call the data supports, so keep the existing behaviour.
      const dated = valid.filter(c => c.birth != null);
      if (dated.length > 1) {
        dated.sort((a, b) => a.birth - b.birth);
        const uniqueNearest = dated.length === 1 ||
          (dated[1].birth - subjectBirth) !== (dated[0].birth - subjectBirth);
        const undatedCount = valid.length - dated.length;
        // Refuse only when several DATED candidates survive AND undated ones cannot
        // tip the balance — that is the genuinely-ambiguous case.
        if (dated.length > 1 && undatedCount === 0 && !uniqueNearest) return null;
        // Multiple dated candidates with a clearly-closest one: keep it.
        return dated[0].slug;
      }
      if (dated.length === 1) return dated[0].slug;
    }
  }
  
  // Spouse: should be within ~30 years of subject
  if (relation === 'spouse' && subjectBirth != null) {
    const valid = candidates.filter(c => {
      if (c.birth == null) return true;
      return Math.abs(c.birth - subjectBirth) <= 30;
    });
    if (valid.length === 1) return valid[0].slug;
    if (valid.length > 0) return valid[0].slug;
    // If none within 30, try 50
    const wide = candidates.filter(c => {
      if (c.birth == null) return true;
      return Math.abs(c.birth - subjectBirth) <= 50;
    });
    if (wide.length > 0) return wide[0].slug;
  }
  
  // Last resort. Previously `return candidates[0].slug` — a blind pick, which is the
  // exact silent-bind the external review flagged. Refuse to guess when several
  // distinct people remain: leaving the raw name surfaces the gap instead of
  // fabricating a relationship. A single candidate is still returned.
  if (candidates.length === 1) return candidates[0].slug;
  return null;
}

function getNamePieces(name) {
  // Try to extract useful name pieces for matching
  // FIXED 2026-10-26: a married woman's name carries a maiden-name parenthetical
  // AND a lifespan. Both strippers above are now global, so `clean` is the bare
  // core name ("clara ann millicent telfer") and matches byName/byFullName, which
  // are keyed on first/middle/last — already clean. The `née` special-case is kept
  // for the `Amy Ellen Telfer (née Provis)` form, where it is still cheaper to cut
  // at the marker than to rely on the parenthesis scan.
  const lifespanless = stripLifespan(name.trim());
  const neeMatch = lifespanless.match(/^(.+?)\s*\(née\s+[^)]+\)/i);
  if (neeMatch) return lowerTrim(neeMatch[1].trim());
  const cleaned = stripAnnotation(lifespanless);
  return lowerTrim(cleaned);
}

function resolveRef(name, context = null) {
  if (!name || name === '?' || name === '???' || name === 'None' || name === 'None (never married)') return null;
  
  const clean = name.trim();
  
  // Already a slug?
  if (slugSet.has(clean)) return clean;
  
  // 0) A DISAMBIGUATING QUALIFIER IS IDENTITY, NOT DECORATION.  2026-10-25
  //
  // The bug this fixes: "William Telfer (shepherd)" returned null, so the shepherd's
  // child edges never formed and janet-nichol silently lost a son (crown-jewel guard
  // fired, correctly). Cause: byDisplay is keyed on the FULL display_name, so the
  // shepherd's only entry is "william telfer (shepherd)". The bare name "william telfer"
  // is shared by four Williams and is therefore __AMBIGUOUS__ by design. Every gate
  // below strips the parenthetical (stripLifespan / stripAnnotation / getNamePieces),
  // which throws away the one token that identifies WHICH William this is — leaving the
  // ref indistinguishable from the three dated namesakes and resolved to nothing.
  //
  // So: if the ref carries a non-date qualifier AND that exact decorated string is the
  // unique display_name of exactly one profile, that profile IS the referent. This runs
  // BEFORE any bare-name ambiguity gate, because the ambiguity is an artefact of having
  // discarded the qualifier. Date qualifiers (1772–1850) and "(fl. 1998)" never reach
  // here — extractYears/stripLifespan handle those — so this cannot hijack a lifespan.
  const qualifier = stripLifespan(clean);
  const qualifierKey = lowerTrim(clean);
  if (qualifier === clean && qualifierKey !== lowerTrim(stripAnnotation(clean))) {
    // Refs always carry the parenthetical; only act when it is a *name* qualifier.
    if (byDisplay.has(qualifierKey) && !yearAnnotatedKeys.has(qualifierKey)) {
      const qualifiedSlug = byDisplay.get(qualifierKey);
      // Only trust it if no other profile claims a colliding display form.
      if (!byDisplayCollisions.has(qualifierKey)) return qualifiedSlug;
    }
  }
  
  const lowered = lowerTrim(clean);
  
  // 1. Try with-years lookup (most precise)
  if (byDisplayWithYears.has(lowered)) return byDisplayWithYears.get(lowered);
  
  // 2. Extract years and try with-years for the local form
  const years = extractYears(clean);
  // 2026-10-28: `years.birth` is null for a marriage-only ref `(m. 1870)`. The
  // name+" (YYYY–living)" keys below would otherwise be built as "null–living"
  // and match nothing, so scope the whole year-matching block to real birth
  // years. Marriage refs are handled further down, where they can be judged
  // against the candidate's age at marriage.
  if (years && years.birth != null) {
    // For each known name form of this person, try to match with extracted years
    const nameClean = stripLifespan(clean);
    const nameLower = lowerTrim(nameClean);
    
    // Try short name + years
    const skLiving = `${nameLower} (${years.birth}–living)`;
    if (byDisplayWithYears.has(skLiving)) return byDisplayWithYears.get(skLiving);
    const skUnknown = `${nameLower} (${years.birth}–?)`;
    if (byDisplayWithYears.has(skUnknown)) return byDisplayWithYears.get(skUnknown);
    if (years.death) {
      const skDeath = `${nameLower} (${years.birth}–${years.death})`;
      if (byDisplayWithYears.has(skDeath)) return byDisplayWithYears.get(skDeath);
    }
    
    // Fuzzier match: extracted years might differ slightly from actual data
    // e.g. vault says "Robert Telfer (1835–1907)" but actual birth is 1837
    const namePieces = getNamePieces(clean);
    let fuzzyCandidates = [];
    if (byName.has(namePieces)) fuzzyCandidates = fuzzyCandidates.concat(byName.get(namePieces));
    if (byFullName.has(namePieces)) {
      const fnCands = byFullName.get(namePieces);
      fnCands.forEach(c => { if (!fuzzyCandidates.find(x => x.slug === c.slug)) fuzzyCandidates.push(c); });
    }

    // tw-2026-09-13-034: a ref that names a MIDDLE NAME the profile doesn't record
    // (vault: "Martha Williams Masters (1814–1896)", profile: first=Martha last=Masters,
    // middle=null) misses both indexes above, so the lifespan was being thrown away and a
    // same-named sibling won on file order. Retry on first+last WITH the extraction.
    if (fuzzyCandidates.length === 0) {
      const words = stripLifespan(clean).trim().split(/\s+/);
      if (words.length > 2) {
        const firstLast = getNamePieces(`${words[0]} ${words[words.length - 1]}`);
        if (byName.has(firstLast)) fuzzyCandidates = fuzzyCandidates.concat(byName.get(firstLast));
      }
    }
    
    if (fuzzyCandidates.length > 0) {
      // Exact birth match
      const exact = fuzzyCandidates.find(c => c.birth === years.birth);
      if (exact) return exact.slug;
      // Near match (within 2 years)
      const near = fuzzyCandidates.find(c => c.birth != null && Math.abs(c.birth - years.birth) <= 2);
      if (near) return near.slug;
    }
  }
  
  // 3. Collect all candidates (display + name-based) for context-aware resolution
  const namePieces = getNamePieces(name);

  // FIXED 2026-09-22 ("fl." annotation shadow): the vault disambiguates a living
  // person who has no birth year by writing "(fl. 1998)" — e.g. Amanda's father
  // "Robert Lawrie (fl. 1998)". extractYears() cannot parse a floruit, so `years`
  // is null, the exact-birth disambiguation is skipped, and a same-named
  // 19th-century namesake (Robert Dunlop Lawrie (1850–1917)) wins on insertion
  // order. Amanda ended up the 1850 man's daughter; Susan's husband "Rob Lawrie"
  // matched nothing at all. When the ref carried an annotation that is NOT a
  // lifespan, the bare name must beat every namesake — the annotation exists
  // precisely to mark the person who has no dates.
  const hadAnnotation = stripAnnotation(clean) !== clean;
  if (hadAnnotation && !extractYears(clean)) {
    const bareName = lowerTrim(stripAnnotation(stripLifespan(clean)));
    const bareExact = [];
    if (byDisplay.has(bareName)) bareExact.push(byDisplay.get(bareName));
    if (byFullName.has(bareName)) byFullName.get(bareName).forEach(c => bareExact.push(c.slug));
    if (byName.has(bareName)) byName.get(bareName).forEach(c => bareExact.push(c.slug));
    const distinct = [...new Set(bareExact)];
    // Exactly one person → unambiguous.
    if (distinct.length === 1) return distinct[0];
    // Several namesakes → the annotation is the tie-breaker. "(fl. 1998)" marks the
    // dateless person, so a candidate with NO birth year is the one meant; a
    // namesake carrying a lifespan is a different generation and must not win.
    if (distinct.length > 1) {
      const dateless = distinct.filter(s => byBirthYear.get(s) == null);
      if (dateless.length === 1) return dateless[0];
    }
  }

  let candidates = [];
  
  // Always collect byName candidates (first + last name)
  if (byName.has(namePieces)) {
    candidates = candidates.concat(byName.get(namePieces));
  }
  // Also try first+middle+last if different
  if (byFullName.has(namePieces)) {
    const fnCands = byFullName.get(namePieces);
    // Merge without duplicates
    const existingSlugs = new Set(candidates.map(c => c.slug));
    fnCands.forEach(c => { if (!existingSlugs.has(c.slug)) { candidates.push(c); existingSlugs.add(c.slug); } });
  }
  
  // Deduplicate candidates
  const seen = new Set();
  candidates = candidates.filter(c => {
    if (seen.has(c.slug)) return false;
    seen.add(c.slug);
    return true;
  });

  // ── GENERATION FILTER (2026-10-24, the alexander-lawrie-1776 fix) ─────────
  // This WAS a preference, not a filter. That was the bug.
  //
  // The 2026-09-22 note below argued a filter "can only ever remove options" and
  // so this stayed a reorder. But when the pool offered NO generation-consistent
  // candidate — which is exactly what happens when the intended person has no
  // profile — the preference did nothing and the code fell through to a name-only
  // pick. Result on the live site: john-lawrie-1810 (b.1810) recorded as the
  // father of alexander-lawrie-1776 (b.1776), his own grandfather, and as the
  // father of two granddaughters born 1881 and 1888.
  //
  // The 2026-09-22 conclusion was still right about the SYMPTOM it was fixing —
  // don't take options away. It was wrong about the remedy, because the refs it
  // was protecting were refs where SOME candidate fit. A ref where NO dated
  // candidate fits is not a ref that needs a preference; it is a ref whose person
  // does not exist in the data, and binding it to the closest namesake fabricates
  // an edge. Refusing it keeps the raw name and leaves a visible research gap,
  // which is the same principle, applied consistently.
  //
  // So: hard-filter when the pool contains at least one DATED candidate. If every
  // dated candidate is contradicted, the ref cannot resolve → return null → the
  // raw name is preserved by the caller. Undated candidates are never filtered
  // (no evidence either way), so a wholly-undated pool behaves exactly as before.
  const subjectBirth = context?.subjectBirth ?? null;
  const subjectDeath = context?.subjectDeath ?? null;
  const relation = context?.relation ?? null;
  if (subjectBirth != null && candidates.length > 0 && JUDGEABLE_RELATIONS.has(relation)) {
    const dated = candidates.filter((c) => c.birth != null);
    if (dated.length > 0) {
      const consistent = candidates.filter(
        (c) =>
          checkYears({
            relation,
            subjectBirth,
            subjectDeath,
            candBirth: c.birth,
            candDeath: c.death,
          }).ok
      );
      if (consistent.length === 0) {
        // Every dated namesake contradicts the dates. Refuse rather than fabricate.
        return null;
      }
      candidates = consistent;
    }
  }

  if (candidates.length === 0) {
    // No name match — try display_name directly
    if (byDisplay.has(namePieces)) {
      const slug = byDisplay.get(namePieces);
      // Verify with context if possible
      if (years && years.birth) {
        const candBirth = byBirthYear.get(slug);
        if (candBirth && candBirth === years.birth) return slug;
        // Birth year mismatch — it's probably wrong, keep looking
      } else if (years && years.marriageOnly) {
        // 2026-10-28: a marriage-year ref ("Elizabeth Float Smith (m. 1870)") reached
        // this branch — no name match, so it fell through to byDisplay and returned
        // the sole display match with NO age check. That bound a woman born 1878 as
        // the wife of a man born 1814, and the graph builder then deleted the real
        // spouse. A marriage year is evidence: judge the candidate's age at marriage
        // before accepting, and refuse when impossible.
        const m = clean.match(/\(\s*m\.?\s*(\d{4})/i);
        const marriageYear = m ? parseInt(m[1]) : null;
        const candBirth = byBirthYear.get(slug);
        if (marriageYear != null && candBirth != null) {
          const ageAtMarriage = marriageYear - candBirth;
          if (ageAtMarriage < 12 || ageAtMarriage > 70) return null;
        }
        return slug;
      } else {
        return slug;
      }
    }
  } else if (candidates.length === 1) {
    // FIXED 2026-10-24 (the neil-telfer father, and the reason this gate kept leaking):
    // A SINGLE candidate used to return here, BEFORE the generation filter above ran.
    // That made the date gate decorative in the most common case — a full-name ref that
    // matches one person. Neil Ronald Telfer (b.1936) names his father as "John Ernest
    // Telfer"; exactly one record answers to that name (john-telfer-1877, b.1877,
    // d.1877), so this branch fired and gave him a father who died 59 years before his
    // birth. The multi-candidate branch was filtered; the single-candidate branch was
    // not. Any ref whose namesake pool happened to collapse to one person bypassed the
    // gate entirely — including the impossible ones.
    //
    // The gate now runs HERE too. A single dated candidate that contradicts the dates is
    // refused (returns null → raw name preserved → a visible research gap), because the
    // intended person has no profile. An undated single candidate is still accepted;
    // absence of dates is not evidence of impossibility.
    if (subjectBirth != null && JUDGEABLE_RELATIONS.has(relation)) {
      const one = candidates[0];
      if (one.birth != null) {
        if (!checkYears({ relation, subjectBirth, subjectDeath, candBirth: one.birth, candDeath: one.death }).ok) {
          return null;
        }
      }
    }
    // Single candidate, verify with years if available
    if (years && years.birth) {
      // If years match, use it
      if (candidates[0].birth === years.birth) return candidates[0].slug;
      // If years don't match, try display match too
      if (byDisplay.has(namePieces)) {
        const dSlug = byDisplay.get(namePieces);
        const dBirth = byBirthYear.get(dSlug);
        if (dBirth === years.birth) return dSlug;
        // Neither matches exact years — prefer display but don't override
        return dSlug;
      }
    }
    // MARRIAGE-YEAR REF, SINGLE CANDIDATE (2026-10-28).
    //
    // A ref like "Elizabeth Float Smith (m. 1870)" carries no birth year, so the
    // exact-year test above cannot run and this function used to return the sole
    // surviving namesake unconditionally. Observed consequence: a woman born 1878
    // was bound as the second wife of a man born 1814, and the graph builder then
    // DELETED the real spouse from the published record — a silent loss of a
    // correct relationship, caused by a name collision with an unrelated child.
    //
    // A marriage year is still evidence: the spouse must be of marriageable age
    // in that year. If the candidate cannot have married then, refuse and keep
    // the raw name so the gap stays visible instead of inventing a wife.
    if (years && years.marriageOnly && candidates.length === 1 && candidates[0].birth != null) {
      const m = clean.match(/\(\s*m\.?\s*(\d{4})/i);
      const marriageYear = m ? parseInt(m[1]) : null;
      if (marriageYear) {
        const ageAtMarriage = marriageYear - candidates[0].birth;
        if (ageAtMarriage < 12 || ageAtMarriage > 70) return null;
      }
    }
    return candidates[0].slug;
  } else {
    // Multiple candidates — use context
    // Check if display match matches years
    if (years && years.birth) {
      const exact = candidates.find(c => c.birth === years.birth);
      if (exact) return exact.slug;
    }
    const best = pickBestMatch(candidates, context);
    if (best) return best;
  }
  
  // 6. Try stripping lifespan (for refs where years were already stripped)
  const stripped = stripLifespan(clean);
  if (stripped !== clean) {
    const loweredStripped = lowerTrim(stripped);
    const spName = getNamePieces(stripped);
    
    if (byDisplay.has(spName)) return byDisplay.get(spName);
    if (byFullName.has(spName)) {
      const candidates = byFullName.get(spName);
      // tw-2026-09-13-034: a ref like "Martha Williams Masters (1814–1896)" fails the
      // byName key (middle name), so it lands here. If the ref carried a lifespan, the
      // birth year is the strongest disambiguator and MUST beat insertion order —
      // otherwise a same-named sibling earlier in people.json wins (1839 over 1814).
      if (years && years.birth != null) {
        const exact = candidates.find(c => c.birth === years.birth);
        if (exact) return exact.slug;
      }
      const best = pickBestMatch(candidates, context);
      if (best) return best;
    }
    if (byName.has(spName)) {
      const candidates = byName.get(spName);
      if (years && years.birth != null) {
        const exact = candidates.find(c => c.birth === years.birth);
        if (exact) return exact.slug;
      }
      const best = pickBestMatch(candidates, context);
      if (best) return best;
    }
  }
  
  // 7. Try stripping annotation like "(adoptive)", "(deceased)", "(3rd wife)"
  const noAnnot = stripAnnotation(clean);
  if (noAnnot !== clean) {
    // 2026-10-28: DO NOT recurse on a marriage-year ref.
    //
    // "Elizabeth Float Smith (m. 1870)" has no name match and no display match, so the
    // retry below recursed with the year STRIPPED ("Elizabeth Float Smith"). That retry
    // could not apply the marriage-age gate — the evidence had been deleted — and fell
    // through to step 8 (first+last), which matched the unrelated "Elizabeth Smith"
    // born 1878. The graph builder then accepted her as the wife of a man born 1814
    // and DELETED the real second marriage from the published record.
    //
    // A marriage year is evidence and must survive to the decision. Handle it here and
    // return explicitly — null means "leave the raw name", which keeps the gap visible.
    if (years && years.marriageOnly) {
      const m = clean.match(/\(\s*m\.?\s*(\d{4})/i);
      const marriageYear = m ? parseInt(m[1]) : null;
      const bare = getNamePieces(noAnnot);
      const pool = byName.get(bare) || [];
      if (marriageYear != null && pool.length > 0) {
        // Keep only spouses of a plausible age at that marriage.
        const plausible = pool.filter(c => {
          if (c.birth == null) return true; // undated: cannot rule out
          const age = marriageYear - c.birth;
          return age >= 12 && age <= 70;
        });
        if (plausible.length === 1) return plausible[0].slug;
        if (plausible.length > 1) {
          const best = pickBestMatch(plausible, context);
          if (best) return best;
        }
        // Nothing plausible — refuse rather than fabricate a spouse.
        return null;
      }
      return null;
    }
    return resolveRef(noAnnot, context);
  }
  
  // 8. For multi-word names, try first+last
  const words = clean.split(/\s+/);
  if (words.length >= 2) {
    const filtered = words.filter(w => !['of', 'the', 'né', 'née', 'mrs', 'mr', 'dr'].includes(w.toLowerCase()));
    if (filtered.length >= 2) {
      const first = filtered[0];
      const last = filtered[filtered.length - 1];
      const firstLast = `${first} ${last}`.toLowerCase();
      const flPieces = getNamePieces(firstLast);
      if (flPieces !== namePieces && byName.has(flPieces)) {
        const candidates = byName.get(flPieces);
        // tw-2026-09-13-034: same insertion-order trap as step 6 — honour the lifespan
        // the reference carried before falling back to contextual/order-based picking.
        if (years && years.birth != null) {
          const exact = candidates.find(c => c.birth === years.birth);
          if (exact) return exact.slug;
        }
        const best = pickBestMatch(candidates, context);
        if (best) return best;
      }
    }
  }
  
  return null;
}

// ── Main ─────────────────────────────────────────

let totalFixed = 0;
// Step fields carry the same raw-name→slug resolution contract as the biological
// ones (added 2026-09-22). They resolve as ordinary parent/child relations; only
// the EDGE they produce differs, and that is decided in build-relationship-graph.
const fields = ['parents', 'children', 'spouses', 'siblings', 'step_parents', 'step_children'];
const changes = [];
const selfRefs = [];

people.forEach(p => {
  const subjectBirth = p.birth_year;
  // subjectDeath is needed so a child born AFTER their parent died is refused.
  const subjectDeath = p.death_year;
  
  fields.forEach(field => {
    if (!p[field] || !Array.isArray(p[field])) return;
    
    const relation = field === 'parents' || field === 'step_parents' ? 'parent'
                   : field === 'children' || field === 'step_children' ? 'child'
                   : field === 'siblings' ? 'sibling'
                   : 'spouse';
    
    // SIBLINGS DECLARED ONLY IN `relationships:` (2026-10-25).
    // `relationships:` is the canonical field, but a profile may name a sibling ONLY
    // there — as both Telfer ancestors do ("Self: … | Sibling: …") — leaving the
    // derived `siblings:` array empty. Iterating `siblings` alone meant that edge
    // could never form: John Telfer (~1791) ended with no sibling while Elisabeth
    // (~1806) carried the raw string, which is exactly the asymmetry reported.
    // When the derived array is empty, fall back to the sibling names declared in
    // `relationships:`. The resolution rules are IDENTICAL — same resolveRef, same
    // year and ambiguity gates — so an unresolvable name still stays a raw string
    // rather than being guessed into a relative.
    let source = Array.isArray(p[field]) ? p[field] : [];
    if (source.length === 0 && field === 'siblings' && Array.isArray(p.relationships)) {
      const declared = [];
      for (const rel of p.relationships) {
        if (!rel || String(rel.type || '').toLowerCase() !== 'sibling') continue;
        for (const n of rel.names || []) if (n) declared.push(n);
      }
      source = declared;
    }

    const newRefs = source.map(ref => {
      if (slugSet.has(ref)) return ref;
      
      const resolved = resolveRef(ref, { subjectBirth, subjectDeath, relation });
      
      if (resolved && resolved !== ref) {
        // Check for self-reference
        if (resolved === p.slug) {
          selfRefs.push({ person: p.slug, field, old: ref, new: resolved, relation });
          return ref; // DON'T fix self-references
        }
        totalFixed++;
        changes.push({ person: p.slug, field, old: ref, new: resolved, relation });
        return resolved;
      }
      
      return ref;
    });
    
    p[field] = newRefs;
  });
});

// Print summary
console.log(`\n=== RESOLVED: ${totalFixed} / 558 ===\n`);

if (totalFixed > 0) {
  const byPerson = {};
  changes.forEach(c => {
    if (!byPerson[c.person]) byPerson[c.person] = [];
    byPerson[c.person].push(c);
  });

  for (const [person, refs] of Object.entries(byPerson)) {
    console.log(`📋 ${person} (${refs.length}):`);
    refs.forEach(r => console.log(`   ${r.field}: "${r.old}" → "${r.new}"`));
  }
}

// ── Report self-references ──────────────────────

if (selfRefs.length > 0) {
  console.log(`\n⚠️  SKIPPED ${selfRefs.length} SELF-REFERENCES (not applied):`);
  selfRefs.forEach(r => console.log(`   ${r.person} -> ${r.field}: "${r.old}" (would point to itself)`));
}

// ── Write if --write flag ────────────────────────

const writeFlag = process.argv.includes('--write');
if (writeFlag && totalFixed > 0) {
  fs.writeFileSync(PEOPLE_JSON, JSON.stringify(people, null, 2) + '\n', 'utf-8');
  console.log(`\n✅ Wrote ${PEOPLE_JSON}`);
} else if (totalFixed > 0) {
  console.log(`\nℹ️  Dry-run only. Use --write to apply changes.`);
}

// ── Remaining count ─────────────────────────────

let remaining = 0;
people.forEach(p => {
  fields.forEach(field => {
    if (!p[field]) return;
    p[field].forEach(ref => {
      if (!slugSet.has(ref)) remaining++;
    });
  });
});
console.log(`\n📊 Remaining unresolved: ${remaining}`);
