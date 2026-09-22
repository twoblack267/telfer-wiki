#!/usr/bin/env node
/**
 * Regression guard for the LIVING-PRIVACY sanitizer
 * (scripts/sanitize-people.mjs → stripLivingPrivateContent).
 *
 * WHY THIS EXISTS
 * On 22 Sep 2026, while adding the public-figure exception, two real defects
 * were introduced and caught only by manual comparison against the previous
 * build:
 *
 *   1. TOO LOOSE AHEAD: the section keep-list matched "## Family" with a bare
 *      \b, so "## Family Stories" also matched — publishing a living person's
 *      personal story (gladys-merle-telfer-1917) on the public site.
 *   2. TOO NARROW: the pattern missed "## Relationships" (Sheryle Telfer's
 *      whole family table vanished) and "## Marriage Certificate — …"
 *      (Timothy Telfer's certificate vanished), while "## Ministry" — a NEW
 *      heading nobody had seen — published by default because the guard was a
 *      BLOCK-list, not a keep-list.
 *
 * This test pins the behaviour so neither class of mistake can return silently.
 * It is pure: it imports the function and asserts on strings. No vault needed.
 *
 * RUN:  node scripts/sanitize-living-privacy.test.mjs
 */

import { stripLivingPrivateContent } from './sanitize-people.mjs';

let failures = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(58)} got=${String(got).padEnd(5)} want=${want}`);
};

const build = (lines) => lines.join('\n');

// ── 1. KEEP-LIST: these MUST survive for a living person ──────────────────
console.log('\n── keep-list (must survive) ──');
{
  const body = build([
    '## Family', '| Relation | Name |', '',
    '## Relationships', '| Relation | Name |', '',
    '## Marriage — Sandra Lea Smith & Leonard Arthur Dance (18 Aug 1974)', 'Married.', '',
    '## Marriage Certificate — Timothy Neil Telfer & Penny Ann Virgen (28 Nov 1981)', '**Registration Number:** 1981/16975', '',
    '## Baptism — 12 September 1982', 'Baptized.', '',
    '## Wedding — someone & someone', 'Wed.', '',
    '## Photos', '![x](y)', '',
    '## Photograph', '![x](y)', '',
  ]);
  const out = stripLivingPrivateContent(body, 'not-allowlisted');
  for (const h of ['## Family', '## Relationships', '## Marriage — Sandra',
                   '## Marriage Certificate — Timothy', '## Baptism — 12 September',
                   '## Wedding — someone', '## Photos', '## Photograph']) {
    check(`keeps ${h}`, out.includes(h), true);
  }
}

// ── 2. DROPPED: these must NEVER publish for a living person ──────────────
console.log('\n── must be dropped (living person) ──');
{
  const body = build([
    '## Family', '| Relation | Name |', '',
    '## Life Summary', 'Private narrative.', '',
    '## Family Stories', 'A personal story. MUST NOT PUBLISH.', '',
    '## Stories & Memories', 'Personal. MUST NOT PUBLISH.', '',
    '## Notes', 'Private notes.', '',
    '## Sources', 'Research provenance.', '',
    '## Timeline', 'Dates.', '',
    '## Qualifications & Career', 'Education/occupation.', '',
    '## Ministry', 'A NEW heading nobody has seen. MUST NOT PUBLISH.', '',
    '## Residence', 'Where they live.', '',
    '## Totally Brand New Heading', 'MUST NOT PUBLISH.', '',
  ]);
  const out = stripLivingPrivateContent(body, 'not-allowlisted');
  for (const h of ['## Life Summary', '## Family Stories', '## Stories & Memories',
                   '## Notes', '## Sources', '## Timeline', '## Qualifications',
                   '## Ministry', '## Residence', '## Totally Brand New Heading']) {
    check(`drops ${h}`, out.includes(h), false);
  }
  // and the body of a dropped section must not leak either
  check('drops "MUST NOT PUBLISH" text', out.includes('MUST NOT PUBLISH'), false);
  check('drops "Private narrative" text', out.includes('Private narrative'), false);
}

// ── 3. PUBLIC-FIGURE EXCEPTION ────────────────────────────────────────────
console.log('\n── public-figure exception ──');
{
  const body = build([
    '## Family', '| Relation | Name |', '',
    '## Life Summary', 'Private narrative.', '',
    '## Public Role', 'Is a retired pastor.', '',
    '## Notes', 'Private.', '',
  ]);
  // allowlisted slug keeps ONLY the Public Role section
  const allowed = stripLivingPrivateContent(body, 'daryll-telfer');
  check('allowlisted: keeps ## Public Role', allowed.includes('## Public Role'), true);
  check('allowlisted: keeps the role text', allowed.includes('retired pastor'), true);
  check('allowlisted: drops ## Life Summary', allowed.includes('## Life Summary'), false);
  check('allowlisted: drops ## Notes', allowed.includes('## Notes'), false);
  check('allowlisted: drops private text', allowed.includes('Private narrative'), false);
  // exactly one Public Role heading (no duplication)
  check('allowlisted: exactly one Public Role heading',
        allowed.split('## Public Role').length - 1, 1);

  // a NON-allowlisted slug must not keep it
  const denied = stripLivingPrivateContent(body, 'some-other-person');
  check('non-allowlisted: drops ## Public Role', denied.includes('## Public Role'), false);
}

// ── 4. SAFETY: a Public Role carrying a residence/social field is REFUSED ──
console.log('\n── exception safety (fail-closed) ──');
{
  const withResidence = build([
    '## Public Role', 'Pastor at a church.', '',
    '**Residence:** 5 Dawson St, Strathalbyn SA', '',
  ]);
  const out1 = stripLivingPrivateContent(withResidence, 'daryll-telfer');
  check('refuses role carrying a Residence field', out1.includes('5 Dawson St'), false);
  check('refuses the whole section (no heading)', out1.includes('## Public Role'), false);

  const withHandle = build([
    '## Public Role', 'Pastor. Find him @somehandle', '',
  ]);
  const out2 = stripLivingPrivateContent(withHandle, 'daryll-telfer');
  check('refuses role carrying a social handle', out2.includes('@somehandle'), false);

  const withPhone = build([
    '## Public Role', 'Pastor.', '', '**Phone:** 0400 000 000', '',
  ]);
  const out3 = stripLivingPrivateContent(withPhone, 'daryll-telfer');
  check('refuses role carrying a Phone field', out3.includes('0400 000 000'), false);
}

// ── 5. NO ARGUMENT / EDGE CASES must not throw ────────────────────────────
console.log('\n── edge cases ──');
{
  try {
    check('empty string is safe', stripLivingPrivateContent('', 'x'), '');
    check('null is safe', stripLivingPrivateContent(null, 'x'), null);
    check('undefined is safe', stripLivingPrivateContent(undefined, 'x'), undefined);
    // calling without a slug must never enable the exception
    const body = build(['## Public Role', 'Should not survive.', '']);
    check('no slug supplied: drops ## Public Role',
          stripLivingPrivateContent(body).includes('## Public Role'), false);
  } catch (e) {
    failures++;
    console.log('  FAIL  threw an exception:', e.message);
  }
}

console.log(
  failures === 0
    ? '\n✅ LIVING-PRIVACY SANITIZER REGRESSION GUARD: ALL PASS\n'
    : `\n❌ LIVING-PRIVACY SANITIZER REGRESSION GUARD: ${failures} FAILURE(S)\n`
);
process.exit(failures === 0 ? 0 : 1);
