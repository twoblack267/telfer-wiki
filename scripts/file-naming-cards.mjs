#!/usr/bin/env node
/**
 * file-naming-cards.mjs — turn naming/identity findings into Can Do Board cards.
 *
 * WHY THIS EXISTS (Mark, 2026-10-29): "if there's a problem it files a card to the can
 * do board, let it run on the local AI." A naming defect is a RESEARCH problem. It must
 * not freeze the pipeline at 03:00 and leave every other page unpublished. So the
 * verifier reports, and this helper puts the finding where work actually gets done.
 *
 * The board is ~/.hermes/kanban/board.yaml. The ONLY supported writer is
 * ~/.hermes/scripts/board-add.py, which is idempotent (content-hash keyed), atomic, and
 * preserves unknown keys. Do not hand-edit board.yaml — a previous agent corrupted it
 * that way (board.yaml.CORRUPT-20261025-0855 is still sitting in the directory).
 *
 * Usage:
 *   node scripts/file-naming-cards.mjs --from-duplicates "<verifier stdout>"
 *   node scripts/file-naming-cards.mjs --file /tmp/duplicate-report.txt
 *
 * Exit 0 = cards filed or nothing to file. Exit 1 = verifier crashed (caller decides).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BOARD_ADD = path.join(os.homedir(), '.hermes', 'scripts', 'board-add.py');

function readReport(argv) {
  const i = argv.indexOf('--from-duplicates');
  if (i !== -1 && argv[i + 1] !== undefined) return argv[i + 1];
  const f = argv.indexOf('--file');
  if (f !== -1 && argv[f + 1]) return fs.readFileSync(argv[f + 1], 'utf8');
  return '';
}

/**
 * Parse the verifier's grouped output:
 *   <reason line>
 *     • slug  "Display Name"  life=...  parents=[...]
 */
function parseGroups(text) {
  const groups = [];
  let current = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const bullet = line.match(/^\s*•\s+(\S+)\s+"([^"]*)"(.*)$/);
    if (bullet) {
      if (!current) continue;
      current.members.push({
        slug: bullet[1],
        name: bullet[2],
        rest: bullet[3].trim(),
      });
      continue;
    }
    // reason lines are indented and not bullets, and not our own trailing advice
    if (/^\s{2,}\S/.test(line) && !/FIX IN THE VAULT|no script reads|New permanent gate|Redirect:|See docs/i.test(line) && !/^─/.test(line)) {
      current = { reason: line.trim(), members: [] };
      groups.push(current);
    }
  }
  return groups.filter((g) => g.members.length >= 2);
}

function fileCard(group) {
  const slugs = group.members.map((m) => m.slug);
  const names = group.members.map((m) => `${m.name} [${m.slug}]`).join(' vs ');
  const detail = group.members
    .map((m) => `  - ${m.slug} "${m.name}" ${m.rest}`)
    .join('\n');

  // Local-AI summary (Mark, 2026-10-29: "let it run on the local AI").
  // Ollama on this Mac, qwen3.5-bender. Free, private, and no family data leaves the
  // machine — which matters because these cards name living and dead relatives.
  // Failure is non-fatal: the card is still worth filing without a summary.
  let localNote = '';
  try {
    const prompt =
      `A family-history website is publishing one person as two separate pages. ` +
      `Evidence: ${group.reason}. Names/records: ${names}. ` +
      `In ONE sentence, state the single worst consequence for people researching this family.`;
    const out = execFileSync(
      'curl',
      ['-s', '--max-time', '60', 'http://127.0.0.1:11434/api/generate',
       '-d', JSON.stringify({
         model: 'qwen3.5-bender:latest',
         prompt,
         stream: false,
         think: false,
         options: { num_predict: 90, temperature: 0.3 },
       })],
      { encoding: 'utf8', timeout: 70000 }
    );
    const parsed = JSON.parse(out);
    const text = String(parsed.response || '').trim().replace(/\s+/g, ' ');
    if (text) localNote = text.slice(0, 400);
  } catch {
    localNote = ''; // ollama down or slow — the card does not depend on it
  }

  const title = `Duplicate identity: ${group.members[0].name} published as ${group.members.length} people`;
  const desc = [
    localNote ? `LOCAL CHECK (qwen3.5-bender): ${localNote}` : null,
    localNote ? `` : null,
    `WHY: ${group.reason}`,
    ``,
    `RECORDS:`,
    detail,
    ``,
    `WHY IT MATTERS: one human being is published on telferwiki.com as two pages that can`,
    `contradict each other about parents. A dead person cannot object to a site stating two`,
    `different things about who their family was.`,
    ``,
    `HOW TO FIX (vault, then data — never hand-edit JSON):`,
    `  1. Decide which note holds the real life record (dates, photo, funeral, sources).`,
    `  2. Add the \`redirect\` tag to the OTHER note's frontmatter. A body line saying`,
    `     "**Canonical profile:** [[...]]" is prose for humans — NO SCRIPT READS IT.`,
    `  3. Declare the merge in src/data/removed-redirects.json (to: <surviving slug>)`,
    `     and in scripts/redirect-log.json so the old URL still lands on the survivor.`,
    `  4. Log the correction in the vault's Corrections Log.`,
    `  5. Run bash scripts/regenerate-data.sh — the duplicate gate must go quiet.`,
    ``,
    `REFERENCE: telfer-wiki/docs/NAMING-RULES.md §6 (canonical record) and §2 (a name is`,
    `not an identity). Gate: scripts/verify-duplicate-identity.mjs.`,
    ``,
    `Filed automatically by the duplicate-identity gate. The pipeline did NOT halt.`,
  ].join('\n');

  const args = [
    BOARD_ADD,
    '--title', title,
    '--type', 'family',
    '--severity', 'high',
    '--source', 'Duplicate-Identity Gate (naming rules)',
    '--desc', desc,
    '--id', `dup-identity-${slugs.sort().join('-')}`.slice(0, 120),
  ];

  try {
    const out = execFileSync('python3', args, { encoding: 'utf8', timeout: 60000 });
    return { ok: true, title, out: out.trim() };
  } catch (e) {
    return { ok: false, title, out: (e.stderr || e.message || '').toString().trim() };
  }
}

function main() {
  const text = readReport(process.argv);
  if (!text.trim()) {
    console.log('file-naming-cards: nothing to file');
    return 0;
  }
  const groups = parseGroups(text);
  if (!groups.length) {
    console.log('file-naming-cards: no duplicate groups parsed — nothing filed');
    return 0;
  }
  if (!fs.existsSync(BOARD_ADD)) {
    console.error(`file-naming-cards: board writer missing at ${BOARD_ADD}`);
    return 1;
  }
  let filed = 0;
  let failed = 0;
  for (const g of groups) {
    const r = fileCard(g);
    if (r.ok) {
      filed += 1;
      console.log(`  📋 card filed: ${r.title}`);
    } else {
      failed += 1;
      console.error(`  ❌ card failed: ${r.title}\n     ${r.out}`);
    }
  }
  console.log(`file-naming-cards: ${filed} filed, ${failed} failed`);
  return failed ? 1 : 0;
}

process.exit(main());
