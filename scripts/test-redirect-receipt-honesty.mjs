// Proves the redirect receipt is honest, and that withdrawn people get NO page.
//
// Two failures this guards, both of which shipped green at some point:
//
//   1. The build printed "N written" while silently discarding redirects. The
//      counter reported the PLAN (filteredRedirects.length), not the disk. A
//      receipt you cannot fail is not a receipt.
//   2. The six privacy-withdrawn slugs got meta-refresh stubs emitted at their
//      own URLs, contradicting the owner's ruling that a withdrawn person gets
//      no page at all. CI's check-withdrawn-names caught it; this test keeps it
//      caught locally, before a push.
//
// Run standalone or via postbuild.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DIST = 'dist/people';
const WITHDRAWN = [
  'aaron-ivory-1989',
  'joel-ivory-1986',
  'jared-ivory-1993',
  'lauren-ivory-1994',
  'karina-ivory',
  'sheryle-telfer-1961',
];

const fail = (msg) => {
  console.error(`  ❌ ${msg}`);
  process.exit(1);
};

// ── 1. The receipt must be read off the disk, and must be able to fail ───────
let out = '';
let code = 0;
try {
  out = execFileSync('node', ['scripts/generate-redirects.mjs'], { encoding: 'utf8' });
} catch (e) {
  out = (e.stdout || '') + (e.stderr || '');
  code = e.status ?? 1;
}

const m = out.match(/(\d+) redirect\(s\) verified on disk \((\d+) considered, (\d+) missing\)/);
if (!m) fail('no disk-verified receipt line — the counter may have reverted to counting the plan');

const onDisk = Number(m[1]);
const considered = Number(m[2]);
const missing = Number(m[3]);
if (missing !== 0) fail(`receipt reports ${missing} announced-but-absent redirects`);
if (code !== 0) fail(`generator exited ${code}`);

// CROSS-CHECK THE NUMBER AGAINST THE DISK ITSELF.
// Without this the counter can lie and this test agrees with the lie: the
// regex happily accepts "407 verified on disk (407 considered, 0 missing)"
// even when the plan said 401 and four were dropped. Parity with the plan is
// the tell — a correct run has onDisk === considered + 1 (the static
// /families/ redirect) and NEVER onDisk > considered, because you cannot write
// more files than you considered emitting.
if (onDisk > considered + 1) {
  fail(`counter claims ${onDisk} written but only ${considered} were considered (+1 static) — the receipt is reporting the plan, not the disk`);
}
if (onDisk !== considered + 1) {
  fail(`expected ${considered + 1} on disk (${considered} considered + 1 static), got ${onDisk} — some announced writes did not land`);
}

// And verify independently: every one of those directories must actually exist.
const peopleDir = 'dist/people';
const actualDirs = fs
  .readdirSync(peopleDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(peopleDir, e.name, 'index.html'))).length;
if (actualDirs < onDisk) {
  fail(`receipt claims ${onDisk} on disk but only ${actualDirs} page dirs exist — counter is fiction`);
}
console.log(`  ✅ receipt is disk-verified: ${onDisk} on disk (${considered} considered + 1 static), 0 missing`);
console.log(`  ✅ cross-checked against ${actualDirs} real page dirs on disk`);

// ── 2. Withdrawn people must have NO page — not a stub, not anything ────────
for (const slug of WITHDRAWN) {
  const dir = path.join(DIST, slug);
  if (fs.existsSync(dir)) {
    fail(`withdrawn slug "${slug}" has a page at ${dir} — ruling is NO PAGE, not even a redirect stub`);
  }
}
console.log(`  ✅ all ${WITHDRAWN.length} withdrawn slugs have NO page on disk (strict ruling)`);

// ── 3. They must not appear in the sitemap either ───────────────────────────
const sitemap = 'dist/sitemap-0.xml';
if (fs.existsSync(sitemap)) {
  const xml = fs.readFileSync(sitemap, 'utf8');
  for (const slug of WITHDRAWN) {
    if (xml.includes(`/people/${slug}`)) fail(`withdrawn slug "${slug}" is in the sitemap`);
  }
  console.log('  ✅ no withdrawn slug in the sitemap');
} else {
  console.log('  ⚠️  sitemap not found — skipped sitemap assertion');
}

// ── 4. The skip must be LOUD, not silent ────────────────────────────────────
// A quiet drop is how the original bug hid. Demand an explicit reason line.
const skippedLoudly = (out.match(/SKIP \(privacy strip: withdrawn person gets no page/g) || []).length;
if (skippedLoudly === 0) {
  fail('no loud privacy-strip skip line — the drop went silent, which is how the bug hid before');
}
console.log(`  ✅ ${skippedLoudly} privacy-strip skip(s) reported loudly (no silent drops)`);

console.log('\n🎉 redirect-receipt-honesty: PASS — honest counter, no page for withdrawn people.');
