#!/usr/bin/env node
/**
 * check-no-emoji.mjs — the nav icon set is generated SVG; emoji are a regression.
 *
 * Why this exists: page-level emoji kept being missed one at a time (DNA helix,
 * Ballads note, footer links, empty states). Hunting them by hand failed twice.
 * A build gate means the NEXT one fails CI instead of reaching Mark's phone.
 *
 * Scope: user-facing markup only (.astro template text). Comments, console
 * output, data JSON and the extractor are ignored — arrows and console glyphs
 * are typography/tooling, not icons.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

const files = execSync("find src -name '*.astro'", { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);

const violations = [];

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!EMOJI.test(line)) return;
    // Allow tooling output and code comments.
    if (/console\.(log|warn|error)/.test(line)) return;
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    if (/<!--/.test(line) && !/<\/?[a-z]/i.test(line)) return;
    violations.push(`${file}:${i + 1}  ${line.trim().slice(0, 100)}`);
  });
}

if (violations.length) {
  console.error('\n❌ Emoji found in user-facing markup — use the sprite set (#i-name):\n');
  violations.forEach(v => console.error('   ' + v));
  console.error(`\n   ${violations.length} violation(s). See src/components/nav-icons/.`);
  process.exit(1);
}

console.log(`✅ no-emoji: ${files.length} .astro files clean — icons come from the sprite set.`);
