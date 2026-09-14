#!/usr/bin/env node
/**
 * validate-manifest-keys.mjs — the gate that makes a dead manifest key
 * impossible to ship.
 *
 * BACKGROUND
 * ----------
 * `sameas.json` and `faqs.json` are keyed by short name; page slugs are dated.
 * An exact-match lookup silently produced NO structured data for most people.
 * Nothing failed — the site just quietly lost its rich results.
 *
 * This script fails the build if ANY key in either manifest fails to resolve
 * to exactly one real person page. Mutation-prove it by adding a bogus key.
 *
 * Exit 0 = every key resolves. Exit 1 = at least one dead/ambiguous key.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertManifestKeysResolve, resolvePersonKey } from "../src/lib/resolve-person-key.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

let people;
try {
  people = read("src/data/people.public.json");
} catch (e) {
  console.error(`❌ MANIFEST-KEY GUARD: cannot read people.public.json — ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(people)) people = people.people || [];
const slugs = people.map((p) => p.slug).filter(Boolean);
if (!slugs.length) {
  console.error("❌ MANIFEST-KEY GUARD: zero slugs to resolve against (refusing to pass vacuously)");
  process.exit(1);
}

const manifests = [];
for (const name of ["sameas.json", "faqs.json"]) {
  try {
    manifests.push({ name, data: read(`src/data/${name}`) });
  } catch (e) {
    console.error(`❌ MANIFEST-KEY GUARD: cannot read src/data/${name} — ${e.message}`);
    process.exit(1);
  }
}

// Report the shape of every resolution so a reviewer sees HOW it matched.
let total = 0;
const how = { exact: 0, dated: 0 };
for (const { name, data } of manifests) {
  const keys = Object.keys(data?.people || {});
  total += keys.length;
  console.log(`\n${name} — ${keys.length} key(s)`);
  for (const k of keys) {
    try {
      const r = resolvePersonKey(k, slugs);
      if (r) {
        how[r.how]++;
        console.log(`   ✓ ${k}  →  ${r.slug}   (${r.how}${r.how === "dated" ? "" : ""})`);
      } else {
        console.log(`   ✗ ${k}  →  NO MATCHING PAGE`);
      }
    } catch (e) {
      console.log(`   ✗ ${k}  →  ${e.message}`);
    }
  }
}

try {
  const checked = assertManifestKeysResolve(manifests, slugs);
  console.log(
    `\n✅ MANIFEST KEYS: ${checked} key(s) all resolve ` +
      `(${how.exact} exact · ${how.dated} dated) against ${slugs.length} page slug(s)`
  );
  process.exit(0);
} catch (e) {
  console.error(`\n❌ MANIFEST-KEY GUARD FAILED\n${e.message}`);
  console.error(
    "\nFix: make the manifest key match the page slug, or rely on the single" +
      " dated variant. Do NOT create a second dated page to satisfy a key."
  );
  process.exit(1);
}
