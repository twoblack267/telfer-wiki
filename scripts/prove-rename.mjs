#!/usr/bin/env node
// Prove (or refuse) that a vanished bare slug was RENAMED to a dated slug.
//
// The situation this settles: HEAD has a live profile at bare slug S (e.g.
// 'mary-telfer'). Today's regeneration has no record at S at all — the person is now
// at D (e.g. 'mary-telfer-1893'). The crown-jewel guard reads raw slugs, sees S gone,
// and correctly refuses to proceed until something proves the person did not vanish.
//
// THE PROOF: a record's identity is the vault note it was generated from. If HEAD's
// record at S and exactly one live record at D carry the SAME vault_file, then the
// person at S is the person at D. The slug merely gained its year. Nothing was lost.
//
// WHY NOT compare HEAD's D to live D (the first attempt): HEAD often never held D at
// all, because the year suffix is what today's converter added. Requiring HEAD to have
// held D rejects the very renames we are trying to prove.
//
// WHY the "exactly one" clause matters: if two or more live records claim that note,
// the mapping is ambiguous and we must refuse rather than pick one. A wrong redirect
// sends a reader to the wrong ancestor, which is worse than a 404 on a disambiguation
// page. (Measured 28 Oct: 'margaret-telfer -> margaret-telfer-1849' looked plausible
// but HEAD's bare record was Margaret Kaye, b.1962, whose note maps to
// margaret-telfer-1962 — the 1849 Margaret is a different woman entirely.)
//
// Prints JSON {proven, why, target, note}. Exit 0 = proven, 1 = refused.
import { execSync } from "child_process";
import { readFileSync } from "fs";

const bareSlug = process.argv[2];
const explicitTarget = process.argv[3] || null;
if (!bareSlug) {
  console.error("usage: prove-rename.mjs <bareSlug> [expectedDatedSlug]");
  process.exit(2);
}

const head = JSON.parse(
  execSync("git show HEAD:src/data/people.json", {
    encoding: "utf-8",
    maxBuffer: 256 * 1024 * 1024,
  })
);
const live = JSON.parse(readFileSync("src/data/people.json", "utf-8"));

const out = { bareSlug, proven: false, why: "", target: null, note: null };

const headBare = head.find((p) => p.slug === bareSlug);
if (!headBare) {
  out.why = `HEAD has no record at ${bareSlug} — nothing was held, nothing to rename`;
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}
if (!headBare.vault_file) {
  out.why = `HEAD's ${bareSlug} names no vault_file — identity cannot be established`;
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

const note = headBare.vault_file;
out.note = note;

// Still live at the bare slug? Then it never moved and there is no rename to declare.
if (live.some((p) => p.slug === bareSlug)) {
  out.why = `${bareSlug} is still a live slug — not a rename`;
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

// Who carries that note now?
const claimants = live.filter((p) => p.vault_file === note);

if (claimants.length === 0) {
  out.why = `no live record is generated from ${note} — the person may genuinely be gone`;
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}
if (claimants.length > 1) {
  out.why =
    `${claimants.length} live records claim ${note} ` +
    `(${claimants.map((c) => c.slug).join(", ")}) — ambiguous, refusing to pick`;
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

const target = claimants[0].slug;
out.target = target;

if (explicitTarget && explicitTarget !== target) {
  out.why =
    `expected target ${explicitTarget}, but the note ${note} now generates ${target}` +
    (target === bareSlug ? "" : " — REFUSING: that redirect would name the wrong person");
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

if (target === bareSlug) {
  out.why = `${bareSlug} still resolves to itself`;
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

out.proven = true;
out.why = `${bareSlug} -> ${target}: same vault note (${note}), slug gained its year`;
console.log(JSON.stringify(out, null, 2));
process.exit(0);
