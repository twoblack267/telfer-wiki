#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";

const path = "src/data/people.public.json";
const data = JSON.parse(readFileSync(path, "utf-8"));
let count = 0;

for (const p of data) {
  // === role field (short tag on index cards) ===
  if (p.role) {
    let r = p.role;
    const before = r;
    r = r.replace(/^Mark's /, "");
    r = r.replace(/, Mark's /, ", ");
    // Aaron: "Step-brother (Sheryle's son, Mark's step-brother through Tim)"
    r = r.replace(/Mark's step-brother through Tim/, "step-brother through Tim");
    if (r !== before) { p.role = r; count++; }
  }

  // === body_markdown ===
  if (p.body_markdown) {
    let b = p.body_markdown;
    const bBefore = b;
    // **Role:** lines
    b = b.replace(/\*\*Role:\*\* Mark's /g, "**Role:** ");
    // Patriarch line
    b = b.replace(/— Mark's paternal grandfather/g, "— Paternal grandfather");
    // "Kylie Isabella Telfer (née Dance) — Mark's wife since 12 March 2016"
    b = b.replace(/— Mark's wife since/g, "— Wife since");
    // "making her Mark's cousin"
    b = b.replace(/making her Mark's cousin/g, "making her a cousin");
    // "Lauren is Mark's step-sister"
    b = b.replace(/Lauren is Mark's step-sister/g, "Lauren is her step-sister");
    // "John is one of Mark's uncles"
    b = b.replace(/John is one of Mark's uncles/g, "John is one of Tim's brothers");
    // "Mark's half-brother through their mother"
    b = b.replace(/Mark's half-brother through their mother/g, "Half-brother through their mother");
    // "Mark's half-brother through their mother" (narrative)
    b = b.replace(/Mark's half-brother through their mother/g, "Half-brother through their mother");
    // "Joel is Mark's step-brother — Sheryle's son"
    b = b.replace(/Joel is Mark's step-brother/g, "Joel is her step-brother");
    // "making her Mark's adopted cousin"
    b = b.replace(/making her Mark's adopted cousin/g, "making her an adopted cousin");
    // "Mark's biological mother. Loves animals"
    b = b.replace(/Mark's biological mother\. Loves animals/g, "Biological mother. Loves animals");
    // "Step-brother (Sheryle's son, Mark's step-brother through Tim)"
    b = b.replace(/Step-brother \(Sheryle's son, Mark's step-brother through Tim\)/g, "Step-brother (Sheryle's son, step-brother through Tim)");
    // "Mark's father" in narrative text
    b = b.replace(/Timothy Neil Telfer — Mark's father\./g, "Timothy Neil Telfer — Father.");
    // "Mark's great-great-grandfather" in tables
    b = b.replace(/Mark's great-great-grandfather/g, "Great-great-grandfather");
    // "Mark's great-grandfather" in table text
    b = b.replace(/Mark's great-grandfather/g, "Great-grandfather");
    // "Mark's grandfather" in table text  
    b = b.replace(/Mark's grandfather/g, "Grandfather");
    if (b !== bBefore) { p.body_markdown = b; count++; }
  }

  // === body_stripped ===
  if (p.body_stripped) {
    let s = p.body_stripped;
    const sBefore = s;
    s = s.replace(/\*\*Role:\*\* Mark's /g, "**Role:** ");
    s = s.replace(/— Mark's paternal grandfather/g, "— Paternal grandfather");
    s = s.replace(/— Mark's wife since/g, "— Wife since");
    s = s.replace(/making her Mark's cousin/g, "making her a cousin");
    s = s.replace(/making her Mark's adopted cousin/g, "making her an adopted cousin");
    s = s.replace(/Mark's half-brother through their mother/g, "Half-brother through their mother");
    s = s.replace(/Mark's biological mother\. Loves animals/g, "Biological mother. Loves animals");
    s = s.replace(/Mark's great-great-grandfather/g, "Great-great-grandfather");
    s = s.replace(/Mark's great-grandfather/g, "Great-grandfather");
    s = s.replace(/Mark's grandfather/g, "Grandfather");
    if (s !== sBefore) { p.body_stripped = s; count++; }
  }
}

writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");

// Final audit
let remain = 0;
for (const p of data) {
  for (const f of ["role", "body_markdown", "body_stripped"]) {
    if (p[f] && typeof p[f] === "string") {
      // Skip YAML frontmatter — only check actual body content
      if (f === "body_markdown") {
        const bodyPart = p[f].split("---\n---\n").pop() || p[f].split("---\n\n").pop() || p[f];
        if (bodyPart.includes("Mark's")) remain++;
      } else if (p[f].includes("Mark's")) {
        remain++;
      }
    }
  }
}
console.log(`${count} fields modified.`);
console.log(`Remaining "Mark's" in body/role fields: ${remain}`);
