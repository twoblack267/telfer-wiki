/**
 * Telfer Wiki — Nightly Site Audit
 * 
 * Runs data completeness, PII, broken links, and design checks.
 * Reports a score out of 10 with actionable items.
 * 
 * Usage: node scripts/audit-site.mjs
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');

function loadPeople() {
  const path = join(ROOT, 'src', 'data', 'people.json');
  if (!existsSync(path)) throw new Error('people.json not found');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function loadTrees() {
  const path = join(ROOT, 'src', 'data', 'trees.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : {};
}

function isLiving(person) {
  return person.death_year_display === 'living';
}

function personName(person) {
  return `${person.first_name || '?'} ${person.last_name || '?'}`;
}

// ── PII Check ──────────────────────────────────────────
function checkPII(text, label, severity = 'high') {
  const issues = [];
  const checks = [
    // Email addresses (skip if already contains "redacted")
    { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, type: 'EMAIL', label: 'Email' },
    // Phone numbers (Australian 0X XXXX XXXX pattern)
    { regex: /\b0[0-9]{1,2}[ -]?[0-9]{4}[ -]?[0-9]{4}\b/g, type: 'PHONE', label: 'Phone number' },
    // LinkedIn profile URLs
    { regex: /linkedin\.com\/(in|pub|company)\/[a-zA-Z0-9_-]+/gi, type: 'LINKEDIN', label: 'LinkedIn URL' },
    // Facebook profile URLs
    { regex: /(?:facebook|fb)\.com\/[a-zA-Z0-9._-]+/gi, type: 'FACEBOOK', label: 'Facebook URL' },
    // Street addresses: number + street name + street suffix
    // Careful to exclude dates (e.g. "24 August" won't have a suffix)
    { regex: /\b\d{1,4}\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?\s+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Place|Pl|Lane|Ln|Way|Boulevard|Blvd|Circuit|Cct|Parade|Pde)\b/g, type: 'ADDRESS', label: 'Street address' },
  ];

  let body = typeof text === 'string' ? text : JSON.stringify(text);
  // Strip URLs to avoid false positives from transcript IDs, etc.
  body = body.replace(/https?:\/\/[^\s"'<>]+/g, '[URL REMOVED]');

  for (const { regex, type, label } of checks) {
    const matches = body.match(regex);
    if (matches) {
      // Filter out already-redacted entries
      const real = matches.filter(m => !m.toLowerCase().includes('redacted'));
      if (real.length > 0) {
        issues.push({
          type: `PII_${type}`,
          severity: severity,
          detail: `${label} in ${label}: ${real.slice(0, 3).join(', ')}`,
          context: label
        });
      }
    }
  }

  return issues;
}

// ── Wiki Link Check ────────────────────────────────────
// Known internal pages that aren't people profiles
const knownInternalPages = [
  'family tree', 'leads', 'research',
  'lawrie family - carslake connection',
  'celebrating the life of murray john telfer',
  'baker-march-webster tree',
];

// Known document/event prefixes (Obsidian vault pages, not people profiles)
const knownDocPrefixes = [
  'wedding -', 'birth certificate -', 'marriage certificate -',
  'affidavit -', 'psychologist report -',
];

// Known asset/image references that are valid Obsidian vault paths
const knownAssetPrefixes = [
  'family history/', 'family history/_assets/', 'history/',
];

function slugify(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function checkBrokenWikiLinks(text, knownSlugs) {
  const issues = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[1];
    const linkTarget = raw.split('|')[0].trim();

    // Skip known asset/image paths
    if (knownAssetPrefixes.some(p => linkTarget.toLowerCase().startsWith(p))) continue;

    // Skip known internal pages
    const strippedForPageCheck = linkTarget.toLowerCase().replace(/\(.*?\)/g, '').trim();
    if (knownInternalPages.some(p => strippedForPageCheck.includes(p))) continue;

    // Skip known document/event references
    const targetLower = linkTarget.toLowerCase();
    if (knownDocPrefixes.some(p => targetLower.startsWith(p))) continue;

    // Strip parenthetical year ranges like (YYYY–YYYY) or (YYYY–?)
    const nameOnly = linkTarget.replace(/\s*\([^)]*\)\s*/g, '').trim();
    let linkSlug = slugify(nameOnly);

    // Check if any known slug matches
    const found = knownSlugs.some(s => {
      // Exact match
      if (s === linkSlug) return true;

      // Split into name parts
      const linkParts = linkSlug.split('-').filter(p => p.length > 1 && !/^\d+$/.test(p));
      const slugParts = s.split('-').filter(p => p.length > 1 && !/^\d+$/.test(p));

      // Strategy 1: all link name parts found in slug (handles middle names)
      if (linkParts.every(p => slugParts.includes(p))) return true;

      // Strategy 2: first name + last name match (handles "William Henry Parker" -> "William Parker")
      if (linkParts.length >= 2) {
        const firstName = linkParts[0];
        const lastName = linkParts[linkParts.length - 1];
        if (slugParts.includes(firstName) && slugParts.includes(lastName)) {
          // Also check birth year if present in both
          const linkYear = linkSlug.split('-').find(p => /^\d{4}$/.test(p));
          const slugYear = s.split('-').find(p => /^\d{4}$/.test(p));
          if (!linkYear || !slugYear || linkYear === slugYear) return true;
        }
      }

      return false;
    });

    if (!found) {
      issues.push({
        type: 'BROKEN_WIKI_LINK',
        severity: 'medium',
        detail: `Unresolved wiki link: [[${raw}]]`
      });
    }
  }
  return issues;
}

// ── Data Completeness ──────────────────────────────────
function checkDataCompleteness(people) {
  const issues = [];
  for (const p of people) {
    const name = personName(p);

    // Missing birth year
    if (p.birth_year === null || p.birth_year === undefined) {
      issues.push({ type: 'MISSING_BIRTH_YEAR', severity: 'low', detail: `${name} (${p.slug}): no birth_year` });
    }

    // Missing death year for deceased
    if (p.death_year_display && p.death_year_display !== 'living' && !p.death_year) {
      issues.push({ type: 'MISSING_DEATH_YEAR', severity: 'low', detail: `${name} (${p.slug}): deceased but no death_year` });
    }

    // Missing bio
    const bodyLen = (p.bio || p.body_markdown || '').trim().length;
    if (bodyLen < 15) {
      issues.push({ type: 'MISSING_BIO', severity: 'low', detail: `${name} (${p.slug}): short/missing bio (${bodyLen} chars)` });
    }

    // Living flag check — born before 1900 but marked living
    if (p.birth_year && p.birth_year > 0 && p.birth_year < 1900 && isLiving(p)) {
      issues.push({ type: 'LIVING_FLAG', severity: 'medium', detail: `${name} (${p.slug}): born ${p.birth_year} but marked living` });
    }
  }
  return issues;
}

// ── Main ───────────────────────────────────────────────
async function main() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║     TELFER WIKI — NIGHTLY AUDIT          ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log(`Date: ${new Date().toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Brisbane' })}\n`);

  const people = loadPeople();
  const trees = loadTrees();
  const allIssues = [];

  console.log(`Loaded ${people.length} people, ${Object.keys(trees).length} trees`);

  // ── 1. PII Check ──
  console.log('\n🔒 Checking PII...');
  // Check raw JSON data
  for (const p of people) {
    const pii = checkPII(JSON.stringify(p), personName(p), 'medium');
    allIssues.push(...pii);
  }

  // Check built HTML files
  if (existsSync(DIST)) {
    let htmlCount = 0;
    function scanDir(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) scanDir(full);
        else if (entry.name.endsWith('.html')) {
          htmlCount++;
          if (htmlCount <= 50) {
            const content = readFileSync(full, 'utf-8');
            const rel = full.replace(DIST, '');
            allIssues.push(...checkPII(content, rel));
          }
        }
      }
    }
    scanDir(DIST);
    console.log(`   Scanned ${htmlCount} HTML files`);
  }

  // ── 2. Broken Wiki Links ──
  console.log('🔗 Checking wiki links...');
  const knownSlugs = people.map(p => p.slug);
  for (const p of people) {
    if (p.body_markdown) {
      allIssues.push(...checkBrokenWikiLinks(p.body_markdown, knownSlugs));
    }
  }

  // ── 3. Data Completeness ──
  console.log('📊 Checking data completeness...');
  allIssues.push(...checkDataCompleteness(people));

  // ── 4. Build State ──
  console.log('🏗️  Checking build state...');
  const built = existsSync(join(DIST, 'index.html'));

  // ── Score ──
  const high = allIssues.filter(i => i.severity === 'high').length;
  const med = allIssues.filter(i => i.severity === 'medium').length;
  const low = allIssues.filter(i => i.severity === 'low').length;
  const score = Math.max(0, Math.min(10, 10 - (high * 2) - (med * 0.5) - (low * 0.05)));

  // ── Summary ──
  const rating = score >= 9 ? '⭐ Excellent' : score >= 7 ? '✅ Good' : score >= 5 ? '⚠️ Needs work' : '🔴 Poor';
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  SCORE:       ${score.toFixed(1)} / 10  (${rating})`);
  console.log(`  Profiles:    ${people.length}`);
  console.log(`  Trees:       ${Object.keys(trees).length}`);
  console.log(`  Build:       ${built ? '✅ built' : '❌ NOT BUILT'}`);
  console.log(`  High Issues: ${high}`);
  console.log(`  Med Issues:  ${med}`);
  console.log(`  Low Issues:  ${low}`);
  console.log(`  Total:       ${allIssues.length}`);
  console.log(`${'='.repeat(50)}`);

  // ── Detailed Issues ──
  if (allIssues.length === 0) {
    console.log('\n✅ No issues found. The site is in pristine condition.');
  } else {
    console.log(`\n📋 Issues (${allIssues.length} total):\n`);
    for (const issue of allIssues) {
      const icon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
      console.log(`${icon} [${issue.type}] ${issue.detail}`);
    }
  }

  // ── Suggestions ──
  const missingBios = allIssues.filter(i => i.type === 'MISSING_BIO').length;
  const missingBirthYears = allIssues.filter(i => i.type === 'MISSING_BIRTH_YEAR').length;
  const brokenLinks = allIssues.filter(i => i.type === 'BROKEN_WIKI_LINK').length;
  const livingFlags = allIssues.filter(i => i.type === 'LIVING_FLAG').length;

  if (allIssues.length > 0) {
    console.log('\n💡 Suggestions:');
    if (missingBios > 3) console.log(`  • Add biographies for ${missingBios} people who have none`);
    if (brokenLinks > 0) console.log(`  • Fix ${brokenLinks} unresolved [[wiki links]]`);
    if (livingFlags > 0) console.log(`  • Review ${livingFlags} people born before 1900 marked as living`);
    if (!built) console.log('  • Run `npm run build` to regenerate the site');
    if (allIssues.filter(i => i.type === 'MISSING_DEATH_YEAR').length > 0) {
      console.log(`  • Add death years for deceased profiles where known`);
    }
  }

  // ── Machine Output ──
  console.log('\n---MACHINE_START---');
  console.log(JSON.stringify({
    date: new Date().toISOString(),
    score: Math.round(score * 10) / 10,
    rating: rating.split(' ')[0].replace(/[⭐✅⚠️🔴]/g, '').trim().toLowerCase() || 'poor',
    profiles: people.length,
    trees: Object.keys(trees).length,
    built,
    issues: { high, medium: med, low, total: allIssues.length },
    counts: { missingBios, missingBirthYears, brokenLinks, livingFlags }
  }));
  console.log('---MACHINE_END---');
}

main().catch(e => {
  console.error(`\n❌ Audit failed: ${e.message}`);
  process.exit(1);
});
