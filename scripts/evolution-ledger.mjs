#!/usr/bin/env node
/**
 * evolution-ledger.mjs
 *
 * Appends a dated, structured entry to the evolution ledger after each
 * Night Watch / self-evolution run. This is "the memory of the system":
 * every run's findings are recorded here so nothing is lost.
 *
 * Usage:
 *   node scripts/evolution-ledger.mjs record \
 *     --score 9.8 --people 96 --trees 45 \
 *     --high 0 --medium 1 --low 3 \
 *     --duplicates 2 --broken 0 \
 *     --summary "Merged Amy Ellen Telfer; fixed 2 truncated names"
 *
 *   node scripts/evolution-ledger.mjs prune      # monthly compression
 *   node scripts/evolution-ledger.mjs tail       # last 5 entries
 *   node scripts/evolution-ledger.mjs today      # today's file
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, renameSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LEDGER_DIR = join(ROOT, 'evolution-ledger');
const MONTHLY_SUMMARY = join(LEDGER_DIR, 'monthly-summaries.md');
const DAILY_PREFIX = 'daily-';

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isoDateTime() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function readArgs() {
  const args = process.argv.slice(2);
  const out = { command: args[0], opts: {} };
  for (let i = 1; i < args.length; i++) {
    const k = args[i];
    if (k.startsWith('--')) {
      const key = k.slice(2);
      const val = args[i + 1];
      if (val !== undefined && !val.startsWith('--')) {
        out.opts[key] = val;
        i++;
      } else {
        out.opts[key] = true;
      }
    }
  }
  return out;
}

function record(day, opts) {
  mkdirSync(LEDGER_DIR, { recursive: true });
  const file = join(LEDGER_DIR, `${DAILY_PREFIX}${day}.md`);

  const score = opts.score ?? '?';
  const people = opts.people ?? '?';
  const trees = opts.trees ?? '?';
  const issues = {
    high: Number(opts.high ?? 0),
    medium: Number(opts.medium ?? 0),
    low: Number(opts.low ?? 0),
    duplicates: Number(opts.duplicates ?? 0),
    broken: Number(opts.broken ?? 0),
  };
  const summary = opts.summary ?? 'Night Watch ran.';

  const entry = `## ${isoDateTime()}
- **Score:** ${score}/10
- **Profiles:** ${people} · **Trees:** ${trees}
- **Issues:** 🔴${issues.high} 🟡${issues.medium} 🟢${issues.low} · Duplicates: ${issues.duplicates} · Broken links: ${issues.broken}
- **Notes:** ${summary}

`;

  if (existsSync(file)) {
    writeFileSync(file, readFileSync(file, 'utf-8') + entry, 'utf-8');
  } else {
    writeFileSync(file, `# Evolution Ledger — ${day}\n\n`, 'utf-8');
    writeFileSync(file, readFileSync(file, 'utf-8') + entry, 'utf-8');
  }
  console.log(`📒 Recorded ${entry.trim().split('\n')[0]}`);
}

function prune() {
  mkdirSync(LEDGER_DIR, { recursive: true });
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const files = readdirSync(LEDGER_DIR).filter(f => f.startsWith(DAILY_PREFIX) && f.endsWith('.md'));

  // Group by month (from filename daily-YYYY-MM-DD.md)
  const byMonth = {};
  for (const f of files) {
    const m = f.match(/daily-(\d{4}-\d{2})-\d{2}\.md/);
    if (!m) continue;
    const month = m[1];
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push(f);
  }

  let pruned = 0;
  for (const [month, monthFiles] of Object.entries(byMonth)) {
    // Skip current month and last month (keep recent history readable)
    const [y, mo] = month.split('-').map(Number);
    const monthDate = new Date(y, mo - 1);
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    if (monthDate >= cutoff) continue;

    // Compress all files for this older month into one summary entry
    let scoreSum = 0, scoreN = 0, dupSum = 0, brkSum = 0, issueHigh = 0, issueMed = 0, issueLow = 0, runs = 0;
    const notes = [];
    for (const f of monthFiles) {
      const body = readFileSync(join(LEDGER_DIR, f), 'utf-8');
      runs++;
      const s = body.match(/\*\*Score:\*\* ([0-9.]+)\/10/);
      if (s) { scoreSum += parseFloat(s[1]); scoreN++; }
      const d = body.match(/Duplicates: (\d+)/);
      if (d) dupSum += parseInt(d[1]);
      const b = body.match(/Broken links: (\d+)/);
      if (b) brkSum += parseInt(b[1]);
      const h = body.match(/🔴(\d+)/);
      if (h) issueHigh += parseInt(h[1]);
      const md = body.match(/🟡(\d+)/);
      if (md) issueMed += parseInt(md[1]);
      const lw = body.match(/🟢(\d+)/);
      if (lw) issueLow += parseInt(lw[1]);
      const note = body.match(/\*\*Notes:\*\* (.+)/g);
      if (note) notes.push(...note.map(n => n.replace(/\*\*Notes:\*\* /, '- ')));
    }

    const avgScore = scoreN ? (scoreSum / scoreN).toFixed(1) : '?';
    const summaryEntry = `## ${month} · Monthly Summary
- **Runs:** ${runs} · **Avg Score:** ${avgScore}/10
- **Total issues:** 🔴${issueHigh} 🟡${issueMed} 🟢${issueLow}
- **Duplicates found:** ${dupSum} · **Broken links:** ${brkSum}
- **Highlights:**
${notes.slice(0, 10).join('\n')}

`;

    mkdirSync(dirname(MONTHLY_SUMMARY), { recursive: true });
    const sep = existsSync(MONTHLY_SUMMARY) ? '\n' : '';
    writeFileSync(MONTHLY_SUMMARY, (existsSync(MONTHLY_SUMMARY) ? readFileSync(MONTHLY_SUMMARY, 'utf-8') : '') + sep + summaryEntry, 'utf-8');

    // Remove the compressed daily files
    for (const f of monthFiles) rmSync(join(LEDGER_DIR, f));
    pruned += monthFiles.length;
  }

  // Report current size
  const sizeMB = (() => {
    let bytes = 0;
    for (const f of readdirSync(LEDGER_DIR)) bytes += existsSync(join(LEDGER_DIR, f)) ? statSync(join(LEDGER_DIR, f)).size : 0;
    if (existsSync(MONTHLY_SUMMARY)) bytes += statSync(MONTHLY_SUMMARY).size;
    return (bytes / 1024 / 1024).toFixed(2);
  })();

  console.log(`🧹 Pruned ${pruned} old daily files. Ledger now ${sizeMB} MB.`);
}

function tail() {
  if (!existsSync(LEDGER_DIR)) { console.log('No ledger yet.'); return; }
  const files = readdirSync(LEDGER_DIR).filter(f => f.startsWith(DAILY_PREFIX) && f.endsWith('.md')).sort();
  if (files.length === 0) { console.log('No daily entries (all pruned to summaries).'); readLedgerSummary(); return; }
  const last = files[files.length - 1];
  console.log(readFileSync(join(LEDGER_DIR, last), 'utf-8').trim());
}

function readLedgerSummary() {
  if (existsSync(MONTHLY_SUMMARY)) {
    const body = readFileSync(MONTHLY_SUMMARY, 'utf-8').trim().split('\n');
    console.log(body.slice(-30).join('\n'));
  }
}

function today() {
  const day = isoDate();
  const file = join(LEDGER_DIR, `${DAILY_PREFIX}${day}.md`);
  if (!existsSync(file)) { console.log('No entry today yet.'); return; }
  console.log(readFileSync(file, 'utf-8').trim());
}

const { command, opts } = readArgs();
switch (command) {
  case 'record': record(isoDate(), opts); break;
  case 'prune': prune(); break;
  case 'tail': tail(); break;
  case 'today': today(); break;
  default:
    console.log('Usage: node scripts/evolution-ledger.mjs <record|prune|tail|today> [--opts]');
}
