#!/usr/bin/env node
/**
 * privacy-comment-integrity.test.mjs
 *
 * Proves check-privacy-comment-integrity.mjs REFUSES what it claims to refuse.
 * Card tw-2026-10-20-001. A guard that has only ever printed "✅" is not a guard.
 *
 * Three fixtures, each a full mini-site so the gate's min-page floor is met:
 *   1. claim WITHOUT robots  → must exit 1  (the /tree/ defect, reproduced)
 *   2. claim WITH robots     → must exit 0  (must not over-refuse a true claim)
 *   3. no claim, no robots   → must exit 0  (ordinary indexed page)
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const GATE = new URL("./check-privacy-comment-integrity.mjs", import.meta.url).pathname;
const PADDING_PAGES = 60;

function buildFixture(dir, { claim, robots }) {
  mkdirSync(join(dir, "filler"), { recursive: true });
  for (let i = 0; i < PADDING_PAGES; i++) {
    writeFileSync(
      join(dir, "filler", `p${i}.html`),
      `<html><head><title>p${i}</title></head><body>ok</body></html>`
    );
  }
  const head = [
    "<!DOCTYPE html><html><head><title>subject</title>",
    claim ? "<!-- Privacy: keep this page out of search engine indexes (living persons) -->" : "",
    robots ? '<meta name="robots" content="noindex, nofollow" />' : "",
    "</head><body>subject</body></html>",
  ].join("");
  writeFileSync(join(dir, "index.html"), head);
}

function runGate(dir) {
  try {
    const out = execFileSync("node", [GATE, "--dir", dir], { encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? -1, out: (e.stdout || "") + (e.stderr || "") };
  }
}

const cases = [
  { name: "claim WITHOUT robots must be REFUSED", opts: { claim: true, robots: false }, expect: 1 },
  { name: "claim WITH robots must be ACCEPTED", opts: { claim: true, robots: true }, expect: 0 },
  { name: "no claim, no robots must be ACCEPTED", opts: { claim: false, robots: false }, expect: 0 },
];

let failed = 0;
const root = mkdtempSync(join(tmpdir(), "privacy-gate-"));
try {
  for (const c of cases) {
    const dir = join(root, c.name.replace(/[^a-z]+/gi, "-").toLowerCase());
    buildFixture(dir, c.opts);
    const { code } = runGate(dir);
    if (code === c.expect) {
      console.log(`  ✅ ${c.name} (exit ${code})`);
    } else {
      console.log(`  ❌ ${c.name} — expected exit ${c.expect}, got ${code}`);
      failed++;
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failed) {
  console.error(`\n❌ privacy-comment-integrity.test: ${failed} case(s) failed — the gate is NOT trustworthy.`);
  process.exit(1);
}
console.log("\n🎉 privacy-comment-integrity.test: gate refuses the /tree/ defect and accepts true claims.");
