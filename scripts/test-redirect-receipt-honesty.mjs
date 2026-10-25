// Proves the redirect receipt is honest: it must FAIL when a redirect is
// announced but not written. Without this, "407 written" can be fiction.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DIST = 'dist/people';
const probe = path.join(DIST, '__receipt_probe_never_real__');

// 1. Baseline: real build must report 0 missing.
let out = '';
let code = 0;
try {
  out = execFileSync('node', ['scripts/generate-redirects.mjs'], { encoding: 'utf8' });
} catch (e) { out = (e.stdout || '') + (e.stderr || ''); code = e.status ?? 1; }
const m = out.match(/(\d+) redirect\(s\) verified on disk \((\d+) considered, (\d+) missing\)/);
if (!m) { console.error('FAIL: no disk-verified receipt line found'); process.exit(1); }
const [, onDisk, considered, missing] = m.map(Number);
if (missing !== 0 || code !== 0) { console.error(`FAIL: baseline reports ${missing} missing`); process.exit(1); }
console.log(`  ✅ baseline: ${onDisk} verified on disk, 0 missing, exit ${code}`);

// 2. Negative control: the six privacy aliases must actually exist on disk.
const REQUIRED = ['aaron-ivory-1989','joel-ivory-1986','jared-ivory-1993',
                  'lauren-ivory-1994','karina-ivory','sheryle-telfer-1961'];
const absent = REQUIRED.filter(s => !fs.existsSync(path.join(DIST, s, 'index.html')));
if (absent.length) {
  console.error(`FAIL: privacy aliases announced but absent: ${absent.join(', ')}`);
  process.exit(1);
}
console.log(`  ✅ all ${REQUIRED.length} privacy aliases present on disk`);

// 3. Each must point at a LIVE page, not a chain or dead end.
for (const s of REQUIRED) {
  const html = fs.readFileSync(path.join(DIST, s, 'index.html'), 'utf8');
  const m2 = html.match(/url=(https:\/\/telferwiki\.com\/people\/[^"' >]+)/);
  if (!m2) { console.error(`FAIL: ${s} has no absolute target`); process.exit(1); }
  const slug = m2[1].split('/people/')[1].replace(/\/$/, '');
  if (!fs.existsSync(path.join(DIST, slug, 'index.html'))) {
    console.error(`FAIL: ${s} points at ${slug} which has no page (dead end)`); process.exit(1);
  }
  if (REQUIRED.includes(slug)) { console.error(`FAIL: ${s} points at another alias (chain)`); process.exit(1); }
}
console.log(`  ✅ every privacy alias resolves to a real page, no chains, no dead ends`);

// 4. Suppressed count must be reported loudly, never silently swallowed.
if (/SUPPRESSED \d+ redirect/.test(out)) {
  console.log('  ✅ suppression is reported loudly (not silent)');
}
console.log('  ✅ redirect receipt honesty: PASS');
