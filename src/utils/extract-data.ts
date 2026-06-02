/**
 * Telfer Wiki — Data Extraction Pipeline
 *
 * Reads person files from the Obsidian vault, parses YAML frontmatter,
 * filters PII, extracts structured relationships, and outputs clean JSON
 * for the Astro site to consume at build time.
 *
 * Run: npx tsx src/utils/extract-data.ts
 * Output: src/data/people.json, src/data/trees.json
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join, basename } from "path";
import { parse } from "yaml";

// ── Config ──────────────────────────────────────────────
const VAULT_PATH = "/home/mark/ObsidianVault/Family History";
const OUTPUT_DIR = join(import.meta.dirname, "..", "data");
const PEOPLE_DIR = join(VAULT_PATH, "People");
const TREE_FILES = [
  "Telfer Tree.md",
  "Lawrie Tree.md",
  "Parker Tree.md",
  "Baker-March-Webster Tree.md",
];

// PII patterns — catch these and replace with safe placeholders
const PII_PATTERNS: { regex: RegExp; replacement: string }[] = [
  // Full street addresses (unit/street number/street name/suburb/state/postcode)
  { regex: /U\s*\d+\s+\d+\s+[A-Za-z\s]+(?:Ave|Street|St|Road|Rd|Drive|Dr|Place|Pl|Court|Ct|Lane|Ln|Boulevard|Blvd|Way|Terrace|Tce|Crescent|Cres|Highway|Hwy)\s*,\s*[A-Za-z\s-]+\s+(?:QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\s+\d{4}/g, replacement: "[Redacted — Kippa-Ring, QLD]" },
  // PO Box addresses
  { regex: /PO\s*Box\s+\d+[^,]*,\s*[A-Za-z\s-]+\s+(?:QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\s+\d{4}/g, replacement: "[Redacted — PO Box]" },
  // Email addresses
  { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "[redacted email]" },
  // Facebook profile URLs
  { regex: /https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9.]+/g, replacement: "[Facebook profile — redacted]" },
  // Phone numbers (Australian format: 04xx xxx xxx, 0x xxxx xxxx, +61...)
  { regex: /(?:\+61|0)[4-5]\d[\s-]?\d{3}[\s-]?\d{3}/g, replacement: "[redacted phone]" },
  // LinkedIn URLs
  { regex: /https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9-]+/g, replacement: "[LinkedIn — redacted]" },
];

// ── Types ───────────────────────────────────────────────
export interface Relationship {
  type: string;
  names: string[];
}

export interface PersonData {
  id: string;
  slug: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  birth_year?: number;
  death_year?: number;
  birth_year_display: string;
  death_year_display: string;
  title: string;
  tags: string[];
  relationships: Relationship[];
  roles: string[];
  body_markdown: string;
  body_stripped: string;
  // Computed
  is_living: boolean;
  lifespan: string;
  generation: number;
  parents: string[];
  children: string[];
  spouses: string[];
  siblings: string[];
  related_trees: string[];
}

export interface TreeData {
  id: string;
  title: string;
  body_markdown: string;
  lines: string[];
  people_refs: string[];
}

// ── Helpers ─────────────────────────────────────────────
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseRelationships(raw: string): Relationship[] {
  return raw.split("|").map((part) => {
    const [type, ...names] = part.split(":").map((s) => s.trim());
    return {
      type: type?.trim() || "Unknown",
      names: names
        .join(":")
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean),
    };
  });
}

function filterPII(text: string): string {
  let cleaned = text;
  for (const { regex, replacement } of PII_PATTERNS) {
    cleaned = cleaned.replace(regex, replacement);
  }
  return cleaned;
}

function stripMarkdown(md: string): string {
  return md
    .replace(/^---[\s\S]*?---\n*/m, "") // frontmatter
    .replace(/[[\]()]/g, "") // wiki links
    .replace(/#{1,6}\s*/g, "") // headings
    .replace(/\|.*\|/g, "") // tables
    .replace(/\*\*(.*?)\*\*/g, "$1") // bold
    .replace(/__(.*?)__/g, "$1") // underline
    .replace(/\*(.*?)\*/g, "$1") // italic
    .replace(/`{1,3}[^`]*`{1,3}/g, "") // code
    .replace(/>\s*/g, "") // blockquotes
    .replace(/[-*+]\s+/g, "") // lists
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractRolesFromBody(body: string): string[] {
  const roles: string[] = [];
  // Look for **Role:** markers
  const roleMatch = body.match(/\*\*Role:\*\*\s*([^\n]+)/);
  if (roleMatch) roles.push(roleMatch[1].trim());
  // Look for **Occupation:** markers
  const occMatch = body.match(/\*\*Occupation:\*\*\s*([^\n]+)/);
  if (occMatch) roles.push(occMatch[1].trim());
  return roles;
}

function determineGeneration(name: string, treeLines: string[]): number {
  // Count indentation depth in the tree to estimate generation
  for (const line of treeLines) {
    if (line.includes(name) || line.includes(slugify(name))) {
      const indent = line.search(/\S/);
      return Math.floor(indent / 2);
    }
  }
  return -1;
}

function extractPeopleRefsFromTree(body: string): string[] {
  const refs: string[] = [];
  const wikiLinkRe = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = wikiLinkRe.exec(body)) !== null) {
    const name = match[1].split("|")[0].trim(); // handle [[Name|alias]]
    refs.push(name);
  }
  return [...new Set(refs)];
}

// ── Main Pipeline ───────────────────────────────────────
function buildPeople(): PersonData[] {
  console.log(`📖 Reading vault: ${PEOPLE_DIR}`);
  const files = readdirSync(PEOPLE_DIR).filter((f) => f.endsWith(".md"));
  const people: PersonData[] = [];

  // Pre-load tree files for generation detection
  const treeLines: string[] = [];
  for (const tf of TREE_FILES) {
    const tp = join(VAULT_PATH, tf);
    if (existsSync(tp)) {
      treeLines.push(...readFileSync(tp, "utf-8").split("\n"));
    }
  }

  for (const file of files) {
    try {
      const raw = readFileSync(join(PEOPLE_DIR, file), "utf-8");
      const parts = raw.split("---");

      if (parts.length < 3) {
        console.warn(`  ⚠️  Skipping ${file} — no valid frontmatter`);
        continue;
      }

      // Parse YAML frontmatter
      const frontmatter = parse(parts[1]) as Record<string, any>;
      const body = parts.slice(2).join("---").trim();

      // Clean PII from body
      const cleanBody = filterPII(body);

      // Parse relationships
      const relationships = frontmatter.relationships
        ? parseRelationships(frontmatter.relationships)
        : [];

      // Extract specific relationship types
      const getNamesFor = (type: string): string[] =>
        relationships.find((r) => r.type.toLowerCase().includes(type.toLowerCase()))
          ?.names || [];

      const parents = getNamesFor("mother").concat(getNamesFor("father"));
      const children = getNamesFor("children");
      const spouses = getNamesFor("spouse");
      const siblings = getNamesFor("siblings");

      // Determine if living
      const isLiving = !frontmatter.death_year;

      // Build display values
      const birthDisplay = frontmatter.birth_year ? `${frontmatter.birth_year}` : "?";
      const deathDisplay = isLiving ? "living" : frontmatter.death_year ? `${frontmatter.death_year}` : "?";
      const lifespan = `${birthDisplay} – ${deathDisplay}`;

      // Build display name
      const middleInitial = frontmatter.middle_name ? ` ${frontmatter.middle_name}` : "";
      const displayName = `${frontmatter.first_name}${middleInitial} ${frontmatter.last_name}`;

      // Slug
      const slug = slugify(`${frontmatter.first_name}-${frontmatter.last_name}`);

      // Roles
      const roles = extractRolesFromBody(cleanBody);

      // Generation
      const generation = determineGeneration(displayName, treeLines);

      const person: PersonData = {
        id: file.replace(".md", ""),
        slug,
        first_name: filterPII(frontmatter.first_name),
        middle_name: frontmatter.middle_name ? filterPII(frontmatter.middle_name) : undefined,
        last_name: filterPII(frontmatter.last_name),
        birth_year: frontmatter.birth_year,
        death_year: frontmatter.death_year,
        birth_year_display: birthDisplay,
        death_year_display: deathDisplay,
        title: frontmatter.title || displayName,
        tags: frontmatter.tags || [],
        relationships,
        roles,
        body_markdown: cleanBody,
        body_stripped: stripMarkdown(cleanBody).substring(0, 500),
        is_living: isLiving,
        lifespan,
        generation,
        parents,
        children,
        spouses,
        siblings,
        related_trees: [],
      };

      people.push(person);
      console.log(`  ✅ ${displayName} (${lifespan})`);
    } catch (err: any) {
      console.error(`  ❌ Error processing ${file}: ${err.message}`);
    }
  }

  console.log(`\n📊 Total: ${people.length} people extracted`);
  return people;
}

function buildTrees(): TreeData[] {
  const trees: TreeData[] = [];

  for (const tf of TREE_FILES) {
    const tp = join(VAULT_PATH, tf);
    if (!existsSync(tp)) {
      console.warn(`  ⚠️  Tree file not found: ${tf}`);
      continue;
    }

    const raw = readFileSync(tp, "utf-8");
    const parts = raw.split("---");
    const frontmatter = parts.length >= 3 ? parse(parts[1]) : {};
    const body = parts.length >= 3
      ? parts.slice(2).join("---").trim()
      : raw;

    const cleanBody = filterPII(body);
    const peopleRefs = extractPeopleRefsFromTree(cleanBody);
    const lines = cleanBody.split("\n").filter((l) => l.trim());

    trees.push({
      id: tf.replace(".md", "").toLowerCase().replace(/\s+/g, "-"),
      title: (frontmatter as any)?.title || tf.replace(".md", ""),
      body_markdown: cleanBody,
      lines,
      people_refs: peopleRefs,
    });

    console.log(`  ✅ Tree: ${tf} (${peopleRefs.length} person refs)`);
  }

  return trees;
}

// ── Assign tree relationships to people ────────────────
function linkTreesToPeople(people: PersonData[], trees: TreeData[]) {
  for (const tree of trees) {
    const treeId = tree.id;
    // Normalize refs to slugs
    const slugRefs = tree.people_refs
      .map((ref) => slugify(ref.split("(")[0].trim()))
      .filter(Boolean);

    for (const person of people) {
      const personSlugs = [
        slugify(`${person.first_name} ${person.last_name}`),
        ...(person.middle_name
          ? [slugify(`${person.first_name} ${person.middle_name} ${person.last_name}`)]
          : []),
        slugify(person.title),
      ];

      if (slugRefs.some((sr) => personSlugs.some((ps) => ps.includes(sr) || sr.includes(ps)))) {
        person.related_trees.push(treeId);
      }
    }
  }

  // Deduplicate
  for (const person of people) {
    person.related_trees = [...new Set(person.related_trees)];
  }
}

// ── Entry ───────────────────────────────────────────────
function main() {
  console.log("━".repeat(50));
  console.log("  🌳 TELFER WIKI — Data Extraction Pipeline");
  console.log("━".repeat(50));

  // Build people data
  console.log("\n👤 Extracting people...");
  const people = buildPeople();

  // Build tree data
  console.log("\n🌲 Extracting trees...");
  const trees = buildTrees();

  // Link them
  console.log("\n🔗 Linking people to trees...");
  linkTreesToPeople(people, trees);

  // Write output
  if (!existsSync(OUTPUT_DIR)) {
    const { mkdirSync } = require("fs");
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const peoplePath = join(OUTPUT_DIR, "people.json");
  const treesPath = join(OUTPUT_DIR, "trees.json");
  const metaPath = join(OUTPUT_DIR, "meta.json");

  writeFileSync(peoplePath, JSON.stringify(people, null, 2));
  writeFileSync(treesPath, JSON.stringify(trees, null, 2));
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        extracted_at: new Date().toISOString(),
        total_people: people.length,
        total_trees: trees.length,
        living_count: people.filter((p) => p.is_living).length,
        deceased_count: people.filter((p) => !p.is_living).length,
        tree_names: trees.map((t) => t.title),
      },
      null,
      2
    )
  );

  console.log("\n━".repeat(50));
  console.log(`  ✅ Written to ${OUTPUT_DIR}`);
  console.log(`     📄 people.json (${people.length} people)`);
  console.log(`     📄 trees.json (${trees.length} trees)`);
  console.log(`     📄 meta.json (stats)`);
  console.log("━".repeat(50));
}

main();
