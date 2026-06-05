#!/usr/bin/env node
/**
 * Telfer Wiki — Data Extraction Pipeline
 * Reads Obsidian vault, filters PII, outputs JSON for Astro build.
 * Run: node src/utils/extract-data.mjs
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────
const VAULT_PATH = "/home/mark/ObsidianVault/Family History";
const OUTPUT_DIR = join(__dirname, "..", "data");
const PEOPLE_DIR = join(VAULT_PATH, "People");
const TREE_FILES = [
  "Telfer Tree.md",
  "Lawrie Tree.md",
  "Parker Tree.md",
  "Baker-March-Webster Tree.md",
];

// PII patterns
const PII_RULES = [
  { re: /U\s*\d+\s+\d+\s+[A-Za-z\s]+(?:Ave|Street|St|Road|Rd|Drive|Dr|Place|Pl|Court|Ct|Lane|Ln|Boulevard|Blvd|Way|Terrace|Tce|Crescent|Cres|Highway|Hwy)\s*,\s*[A-Za-z\s-]+\s+(?:QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\s+\d{4}/g, sub: "[Redacted — Kippa-Ring, QLD]" },
  { re: /PO\s*Box\s+\d+[^,]*,\s*[A-Za-z\s-]+\s+(?:QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\s+\d{4}/g, sub: "[Redacted — PO Box]" },
  { re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, sub: "[redacted email]" },
  { re: /https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9.]+/g, sub: "[Facebook profile — redacted]" },
  { re: /https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9-]+/g, sub: "[LinkedIn — redacted]" },
  { re: /(?:\+61|0)[4-5]\d[\s-]?\d{3}[\s-]?\d{3}/g, sub: "[redacted phone]" },
];

function filterPII(text) {
  let cleaned = text;

  // Strip entire lines containing social media profile links BEFORE the PII
  // replacement loop, so we don't end up with "[Facebook profile — redacted]"
  // embedded inside markdown link syntax like [text](url).
  //
  // Handles:
  //   - **Facebook:** [text](url)           (bold field + markdown link)
  //   - - Facebook: [text](url)             (list field + markdown link)
  //   - **Profile URL:** https://fb.com/... (bold field + raw URL)
  //   - - Facebook profile: https://fb.com/... (list field + raw URL)
  //   - **Facebook:** [Facebook profile — redacted] (already-redacted edge case)
  //   - - TikTok: [text](url)               (all other social platforms too)
  //
  const SOCIAL_LABELS = '(?:Facebook[^:]*|Instagram[^:]*|LinkedIn[^:]*|TikTok|Snapchat|YouTube|Pinterest|Twitter|Profile URL)';
  const SOCIAL_DOMAINS = '(?:facebook|instagram|linkedin|tiktok|snapchat|youtube|pinterest|twitter)\\.com';

  // Pattern 1: markdown link format — [text](url)
  cleaned = cleaned.replace(
    new RegExp(`^.*${SOCIAL_LABELS}\\s*:\\s*(?:\\*\\*)?\\s*\\[[^\\]]*\\]\\(https?:\\/\\/(?:www\\.)?${SOCIAL_DOMAINS}[^)]*\\).*\\n?`, 'gim'),
    ''
  );

  // Pattern 2: raw URL format (no markdown wrapper)
  cleaned = cleaned.replace(
    new RegExp(`^.*${SOCIAL_LABELS}\\s*:\\s*(?:\\*\\*)?\\s*https?:\\/\\/(?:www\\.)?${SOCIAL_DOMAINS}\\S*.*\\n?`, 'gim'),
    ''
  );

  // Pattern 3: already-redacted edge cases where URL was previously replaced
  cleaned = cleaned.replace(
    /^.*(?:Facebook[^:]*|Instagram[^:]*|LinkedIn[^:]*|TikTok|Snapchat|YouTube|Pinterest|Twitter|Profile URL)\s*:\s*(?:\*\*)?\s*\[(?:Facebook|Instagram|LinkedIn|TikTok|Snapchat|YouTube|Pinterest|Twitter)\s*(?:profile|URL|)[\s— -]*redacted[\])].*\n?/gim,
    ''
  );

  // Then apply the standard PII replacement rules for any remaining inline URLs
  for (const { re, sub } of PII_RULES) cleaned = cleaned.replace(re, sub);
  return cleaned;
}

function slugify(first, last, birthYear) {
  const base = `${first}-${last}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 50);
  return birthYear ? `${base}-${birthYear}` : base;
}

function parseRelationships(raw) {
  return raw.split("|").map((part) => {
    const [type, ...names] = part.split(":").map((s) => s.trim());
    return { type: type || "Unknown", names: names.join(":").split(",").map((n) => n.trim()).filter(Boolean) };
  });
}

function stripMarkdown(md) {
  return md.replace(/^---[\s\S]*?---\n*/m, "").replace(/[[\]()]/g, "").replace(/#{1,6}\s*/g, "")
    .replace(/\|.*\|/g, "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1").replace(/`{1,3}[^`]*`{1,3}/g, "").replace(/>\s*/g, "")
    .replace(/[-*+]\s+/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function extractRoles(body) {
  const roles = [];
  const m = body.match(/\*\*Role:\*\*\s*([^\n]+)/);
  if (m) roles.push(m[1].trim());
  const o = body.match(/\*\*Occupation:\*\*\s*([^\n]+)/);
  if (o) roles.push(o[1].trim());
  return roles;
}

function extractPeopleRefs(body) {
  const refs = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(body)) !== null) refs.push(m[1].split("|")[0].trim());
  return [...new Set(refs)];
}

function extractFirstLastFromRef(ref) {
  const base = ref.split("(")[0].trim();
  const parts = base.split(/\s+/);
  return { first: parts[0] || "", last: parts[parts.length - 1] || "" };
}

function slugifyRef(ref) {
  const { first, last } = extractFirstLastFromRef(ref);
  return slugify(first, last, null);
}

function parsePeopleFile(filepath) {
  const raw = readFileSync(filepath, "utf-8");
  const parts = raw.split("---");
  if (parts.length < 3) return null;

  const fm = parseYaml(parts[1]);
  const body = parts.slice(2).join("---").trim();
  const cleanBody = filterPII(body);

  const relationships = fm.relationships ? parseRelationships(fm.relationships) : [];
  const getNames = (type) => relationships.find((r) => r.type.toLowerCase().includes(type.toLowerCase()))?.names || [];
  const parents = [...getNames("mother"), ...getNames("father")];
  const children = getNames("children");
  const spouses = getNames("spouse");
  const siblings = getNames("siblings");

  const currentYear = new Date().getFullYear();
  const isLiving = fm.death_year ? false : fm.birth_year ? (currentYear - fm.birth_year < 120) : true;
  const birthD = fm.birth_year ? `${fm.birth_year}` : "?";
  const deathD = isLiving ? "living" : fm.death_year ? `${fm.death_year}` : "?";
  const lifespan = `${birthD} – ${deathD}`;
  const middle = fm.middle_name ? ` ${fm.middle_name}` : "";
  const displayName = `${fm.first_name}${middle} ${fm.last_name}`;
  const slug = slugify(fm.first_name, fm.last_name, fm.birth_year);

  return {
    id: filepath.split("/").pop().replace(".md", ""),
    slug,
    first_name: fm.first_name,
    middle_name: fm.middle_name || null,
    last_name: fm.last_name,
    birth_year: fm.birth_year || null,
    death_year: fm.death_year || null,
    birth_year_display: birthD,
    death_year_display: deathD,
    display_name: displayName,
    title: fm.title || displayName,
    tags: fm.tags || [],
    relationships,
    roles: extractRoles(cleanBody),
    body_markdown: cleanBody,
    body_stripped: stripMarkdown(cleanBody).substring(0, 500),
    is_living: isLiving,
    lifespan,
    parents,
    children,
    spouses,
    siblings,
    related_trees: [],
  };
}

function build() {
  console.log("Telfer Wiki — Data Extraction\n");

  // ── People ──
  const files = readdirSync(PEOPLE_DIR).filter((f) => f.endsWith(".md"));
  const people = [];
  for (const file of files) {
    const p = parsePeopleFile(join(PEOPLE_DIR, file));
    if (p) { people.push(p); console.log(`  OK ${p.display_name} (${p.lifespan})`); }
    else console.warn(`  SKIP ${file}`);
  }

  // ── Trees ──
  const trees = [];
  for (const tf of TREE_FILES) {
    const tp = join(VAULT_PATH, tf);
    if (!existsSync(tp)) { console.warn(`  NOT FOUND: ${tf}`); continue; }
    const raw = readFileSync(tp, "utf-8");
    const parts = raw.split("---");
    const fm = parts.length >= 3 ? parseYaml(parts[1]) : {};
    const body = parts.length >= 3 ? parts.slice(2).join("---").trim() : raw;
    const cleanBody = filterPII(body);
    const refs = extractPeopleRefs(cleanBody);
    trees.push({
      id: tf.replace(".md", "").toLowerCase().replace(/\s+/g, "-"),
      title: fm.title || tf.replace(".md", ""),
      body_markdown: cleanBody,
      lines: cleanBody.split("\n").filter((l) => l.trim()),
      people_refs: refs,
    });
    console.log(`  OK ${tf} (${refs.length} refs)`);
  }

  // ── Link ──
  for (const tree of trees) {
    const slugRefs = tree.people_refs.map(slugifyRef).filter(Boolean);
    for (const person of people) {
      const pSlugs = [
        slugify(person.first_name, person.last_name, person.birth_year),
        slugify(person.first_name, person.last_name, null),
        ...(person.middle_name ? [slugify(person.first_name, person.middle_name ? `${person.middle_name} ${person.last_name}` : person.last_name, person.birth_year)] : []),
      ];
      if (slugRefs.some((sr) => pSlugs.some((ps) => ps.includes(sr) || sr.includes(ps)))) {
        person.related_trees.push(tree.id);
      }
    }
  }
  for (const p of people) p.related_trees = [...new Set(p.related_trees)];

  // ── Write ──
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(join(OUTPUT_DIR, "people.json"), JSON.stringify(people, null, 2));
  writeFileSync(join(OUTPUT_DIR, "trees.json"), JSON.stringify(trees, null, 2));
  writeFileSync(join(OUTPUT_DIR, "meta.json"), JSON.stringify({
    extracted_at: new Date().toISOString(),
    total_people: people.length,
    total_trees: trees.length,
    living: people.filter((p) => p.is_living).length,
    deceased: people.filter((p) => !p.is_living).length,
    trees: trees.map((t) => t.title),
  }, null, 2));

  console.log(`\nDone → ${OUTPUT_DIR}/`);
  console.log(`  people.json (${people.length} people)`);
  console.log(`  trees.json  (${trees.length} trees)`);
}

build();
