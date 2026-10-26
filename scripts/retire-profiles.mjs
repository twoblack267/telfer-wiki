#!/usr/bin/env node
/**
 * retire-profiles.mjs — remove deliberately retired profiles, and keep them dead.
 *
 * WHY THIS EXISTS
 * ---------------
 * `convert-markdown.mjs` treats every record with `vault_file: null` as untouchable:
 * it gathers them into `noVaultFile` and re-appends them before writing
 * (`existingPeople = [...mergedPeople, ...noVaultFile]`). So a phantom profile with no
 * vault note cannot be removed by deleting it from people.json — the next regen puts it
 * straight back. Verified empirically on 2026-10-26: deleted, re-ran the pipeline,
 * profile restored.
 *
 * The retired list is `scripts/retired-profiles.json` — slug → { retired, reason,
 * replaced_by }. Every entry states WHY the person was retired, so a future reader
 * cannot re-add them without knowingly contradicting the record.
 *
 * `reason` is mandatory. An entry without a reason is rejected: retiring a real person
 * is a data-loss event, and the only thing separating that from a correction is the
 * written justification.
 *
 * WHERE IT RUNS
 * -------------
 * In regenerate-data.sh, immediately after convert-markdown.mjs + resolve-refs.mjs and
 * BEFORE the crown-jewel guard. Order matters: the guard then judges the tree WITHOUT
 * the retired people, and finds them declared as renames in scripts/redirect-log.json
 * (so a deliberate retirement reads as a rename, not as data loss).
 *
 * Usage:
 *   node scripts/retire-profiles.mjs            # report
 *   node scripts/retire-profiles.mjs --write    # apply
 *   node scripts/retire-profiles.mjs --check    # exit 1 if any retired slug is present
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PEOPLE_PATH = path.resolve(__dirname, '../src/data/people.json');
const RETIRED_PATH = path.resolve(__dirname, 'retired-profiles.json');

const FIELDS = ['children', 'parents', 'spouses', 'siblings', 'step_children', 'step_parents'];

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const CHECK_ONLY = args.includes('--check');

function die(msg) {
  console.error(`retire-profiles: ${msg}`);
  process.exit(2);
}

function main() {
  if (!fs.existsSync(RETIRED_PATH)) {
    console.log('retire-profiles: no retired-profiles.json — nothing to do');
    return 0;
  }

  const retired = JSON.parse(fs.readFileSync(RETIRED_PATH, 'utf-8'));

  // Validate every entry carries a reason. Refuse to act on an unexplained retirement.
  const unexplained = [];
  for (const [slug, meta] of Object.entries(retired)) {
    if (!meta || typeof meta !== 'object') unexplained.push(`${slug} (no metadata)`);
    else if (!meta.reason || String(meta.reason).trim().length < 20) {
      unexplained.push(`${slug} (no substantive reason)`);
    }
  }
  if (unexplained.length) {
    die(
      `refusing to retire profiles without a written reason:\n  ` +
        unexplained.join('\n  ') +
        `\n\nEvery retirement must state WHY. An unexplained removal is data loss.`
    );
  }

  const people = JSON.parse(fs.readFileSync(PEOPLE_PATH, 'utf-8'));
  const before = people.length;

  const doomed = people.filter((p) => Object.hasOwn(retired, p.slug));
  const keep = people.filter((p) => !Object.hasOwn(retired, p.slug));

  // Scrub back-references so no surviving profile points at a retired slug.
  const dead = new Set(Object.keys(retired));
  let scrubbed = 0;
  const touched = [];
  for (const p of keep) {
    for (const f of FIELDS) {
      if (Array.isArray(p[f])) {
        const n = p[f].length;
        const filtered = p[f].filter((x) => !dead.has(x));
        if (filtered.length !== n) {
          p[f] = filtered;
          scrubbed += n - filtered.length;
          touched.push(`${p.slug}.${f}`);
        }
      }
    }
  }

  if (doomed.length === 0) {
    console.log(`retire-profiles: OK — 0 retired profiles present (${before} profiles)`);
    return 0;
  }

  if (CHECK_ONLY) {
    die(
      `${doomed.length} RETIRED profile(s) present in people.json — the retirer did not run:\n` +
        doomed.map((p) => `  ${p.slug} (${p.display_name || p.slug})`).join('\n')
    );
  }

  console.log(`retire-profiles: ${doomed.length} retired profile(s) removed:`);
  for (const p of doomed) console.log(`  − ${p.slug} — ${p.display_name || '(no name)'}`);
  console.log(`  back-references scrubbed: ${scrubbed} across ${touched.length} field(s)`);
  if (touched.length) console.log(`    ${touched.slice(0, 10).join(', ')}${touched.length > 10 ? ', …' : ''}`);

  if (WRITE) {
    fs.writeFileSync(PEOPLE_PATH, JSON.stringify(keep, null, 2) + '\n', 'utf-8');
    console.log(`  wrote people.json: ${before} → ${keep.length} profiles`);
  } else {
    console.log('  (dry-run — pass --write to apply)');
  }
  return 0;
}

process.exit(main());
