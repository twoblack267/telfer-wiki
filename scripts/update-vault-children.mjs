import fs from 'fs';
import path from 'path';
import { parse, stringify } from 'yaml';

// Load corrected people.json with display_name children
const people = JSON.parse(fs.readFileSync('src/data/people.json', 'utf-8'));
const byDisplayName = new Map(people.map(p => [p.display_name, p]));

// Build display_name -> children (display_names) map from corrected people.json
const childrenMap = new Map();
for (const p of people) {
  if (p.children && p.children.length > 0) {
    childrenMap.set(p.display_name, p.children);
  }
}

console.log(`People with children in people.json: ${childrenMap.size}`);

// Update vault YAML frontmatter
const vaultDir = '/home/mark/ObsidianVault/Family History/People/';
const yamlFiles = fs.readdirSync(vaultDir).filter(f => f.endsWith('.md'));

let updated = 0;
let skipped = 0;

for (const file of yamlFiles) {
  const filePath = path.join(vaultDir, file);
  const content = fs.readFileSync(filePath, 'utf-8');
  
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    skipped++;
    continue;
  }
  
  const fm = parse(match[1]);
  if (!fm) {
    skipped++;
    continue;
  }
  
  // Match vault person to people.json by first_name + last_name + birth_year
  const vaultName = `${fm.first_name || ''} ${fm.middle_name || ''} ${fm.last_name || ''}`.trim();
  const vaultBirth = fm.birth_year;
  const vaultDeath = fm.death_year;
  
  // Build display_name to match
  let displayName;
  if (vaultBirth && vaultDeath) {
    displayName = `${vaultName} (${vaultBirth}–${vaultDeath})`;
  } else if (vaultBirth) {
    displayName = `${vaultName} (${vaultBirth}–living)`;
  } else if (vaultDeath) {
    displayName = `${vaultName} (?–${vaultDeath})`;
  } else {
    displayName = `${vaultName} (?–?)`;
  }
  
  // Handle unknown death/living
  if (!vaultDeath) {
    // Try to find in people.json
    const person = byDisplayName.get(displayName);
    if (person) {
      if (person.death_year) {
        displayName = `${vaultName} (${vaultBirth}–${person.death_year})`;
      } else if (person.is_living) {
        displayName = `${vaultName} (${vaultBirth}–living)`;
      }
    }
  }
  
  const children = childrenMap.get(displayName);
  
  if (children && children.length > 0) {
    fm.children = children;
    const newFm = stringify(fm);
    const newContent = content.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}---`);
    fs.writeFileSync(filePath, newContent);
    updated++;
  } else {
    // Ensure children field exists (empty array)
    if (!fm.children) {
      fm.children = [];
      const newFm = stringify(fm);
      const newContent = content.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}---`);
      fs.writeFileSync(filePath, newContent);
      updated++;
    }
  }
}

console.log(`Updated ${updated} vault files, skipped ${skipped} (no frontmatter)`);
