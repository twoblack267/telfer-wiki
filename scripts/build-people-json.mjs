#!/usr/bin/env node
/**
 * build-people-json.mjs
 * Converts Obsidian vault markdown files → structured people.json
 *
 * Run: node scripts/build-people-json.mjs
 * Output: src/data/people.json (full, unsanitized)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VAULT_PEOPLE_DIR = '/home/mark/ObsidianVault/Family History/People';
const OUTPUT_PATH = path.resolve(__dirname, '../src/data/people.json');
const IMAGES_BASE = '/home/mark/ObsidianVault/Family History';

// ─── Helpers ────────────────────────────────────────────────────────────────

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-')
    .trim();
}

function parseBirthDeath(display) {
  // Handles: "1731", "c.1731", "~1731", "1731–1845", "1986–", "living"
  const cleaned = display.replace(/[c.~]/g, '').trim();
  if (cleaned === 'living' || cleaned === '') return { birth: null, death: null };
  const parts = cleaned.split('–').map(p => p.trim());
  const birth = parts[0] ? parseInt(parts[0], 10) : null;
  const death = parts[1] && parts[1] !== 'living' ? parseInt(parts[1], 10) : null;
  return { birth, death };
}

function estimateBirthFromBody(body) {
  // Extract estimated birth from body text patterns:
  // "Age: 26 (born ~2000)", "born ~1980", "born c.1975", "born 1990"
  if (!body) return null;
  const patterns = [
    /born\s*[~c\.]?\s*(\d{4})/i,
    /born\s*[~c\.]?\s*[''](\d{2})['']?/i,  // born '80
    /age:\s*\d+\s*\(born\s*[~c\.]?\s*(\d{4})\)/i,
    /\(born\s*[~c\.]?\s*(\d{4})\)/i,
    /\bborn\s+(\d{4})\b/i,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) {
      let year = parseInt(match[1], 10);
      if (year < 100) year += 1900; // handle '80 -> 1980
      if (year >= 1700 && year <= new Date().getFullYear()) return year;
    }
  }
  return null;
}

function parseRelationships(fmRelationships) {
  if (!fmRelationships) return [];
  // fmRelationships is a string like:
  // 'Self: John Telfer | Spouse: Elspeth Young | Father: James Telfer | Mother: Margaret | Children: Child1, Child2 | Siblings: Sib1, Sib2'
  const types = ['Self', 'Spouse', 'Father', 'Mother', 'Children', 'Siblings'];
  const results = [];
  for (const type of types) {
    const regex = new RegExp(`${type}:\\s*([^|]+)`, 'i');
    const match = fmRelationships.match(regex);
    if (match && match[1].trim()) {
      const names = match[1].split(',').map(n => n.trim()).filter(Boolean);
      results.push({ type, names });
    }
  }
  return results;
}

function extractRelationshipsFromBody(body) {
  // Parse markdown tables in body for relationships
  const relationships = [];
  const tableRegex = /\| *Relation *\| *Name *\|([\s\S]*?)(?:\n\n|\n#|$)/g;
  let match;
  while ((match = tableRegex.exec(body)) !== null) {
    const tableContent = match[1];
    const rowRegex = /\| *([^|]+?) *\| *([^|]+?) *\|/g;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
      const relation = rowMatch[1].trim().replace(/\*\*/g, '');
      let name = rowMatch[2].trim().replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\*\*/g, '');
      // Clean up name: remove parenthetical dates, marriage refs, and em-dash notes
      name = name.replace(/\s*\([^)]*\d{4}[^)]*\)\s*$/g, '');        // (1849–1936) at end
      name = name.replace(/\s*\([^)]*\d{4}[^)]*\)\s*—/g, ' —');      // (1829–1913) before em-dash
      name = name.replace(/\s*\(m\.\s*\d{4}\)\s*$/gi, '');          // (m. 1917)
      name = name.replace(/\s*\(married\s+\d{4}\)\s*$/i, '');       // (married 1868)
      name = name.replace(/\s*—.*$/g, '');                          // — emigrated to SA
      name = name.trim();
      if (relation && name && !name.match(/^-+$/)) {
        relationships.push({ type: relation, names: [name] });
      }
    }
  }
  return relationships;
}

function computeGenerations(people) {
  // Build lookup maps
  const slugToPerson = new Map(people.map(p => [p.slug, p]));
  
  // Find root: John Telfer (of Castleton) (1731–?)
  let root = people.find(p => p.id === 'John Telfer (of Castleton)' || p.slug.includes('castleton'));
  if (!root) {
    // Fallback: oldest Telfer by birth year
    root = people
      .filter(p => p.last_name?.toLowerCase() === 'telfer' && p.birth_year)
      .sort((a, b) => a.birth_year - b.birth_year)[0];
  }
  if (!root) {
    console.log('   ⚠️  No root found, skipping generation computation');
    return 0;
  }
  
  // BFS from root to assign generations
  const queue = [{ slug: root.slug, gen: 1 }];
  const visited = new Set();
  let computed = 0;
  
  while (queue.length > 0) {
    const { slug, gen } = queue.shift();
    if (visited.has(slug)) continue;
    visited.add(slug);
    
    const person = slugToPerson.get(slug);
    if (!person) continue;
    
    // Only assign if not already set or if lower generation (closer to root)
    if (person.generation === null || person.generation > gen) {
      person.generation = gen;
      computed++;
    }
    
    // Add children to queue
    for (const childSlug of person.children || []) {
      if (!visited.has(childSlug)) {
        queue.push({ slug: childSlug, gen: gen + 1 });
      }
    }
    
    // Add spouses (same generation)
    for (const spouseSlug of person.spouses || []) {
      if (!visited.has(spouseSlug)) {
        queue.push({ slug: spouseSlug, gen: gen });
      }
    }
  }
  
  // For any remaining unassigned people, try to infer from birth_year
  for (const person of people) {
    if (person.generation === null && person.birth_year) {
      // Estimate generation from birth year (roughly 30 years per generation from root ~1731)
      const rootBirth = root.birth_year || 1731;
      const estimatedGen = Math.max(1, Math.floor((person.birth_year - rootBirth) / 30) + 1);
      person.generation = estimatedGen;
      computed++;
    }
  }
  
  return computed;
}

function resolveWikiLinks(text, slugMap) {
  if (!text) return text;
  return text.replace(/\[\[([^\]]+)\]\]/g, (match, link) => {
    const display = link.includes('|') ? link.split('|')[1] : link;
    const target = link.includes('|') ? link.split('|')[0] : link;
    const slug = slugMap.get(target.trim());
    return slug ? `[${display.trim()}](#${slug})` : display.trim();
  });
}

function findVaultFile(personName, files) {
  // Try exact match first
  for (const file of files) {
    if (file.name === `${personName}.md`) return file.name;
    if (file.name.startsWith(personName + ' ')) return file.name;
    // Handle parenthetical variants
    const baseName = personName.replace(/ \([^)]+\)$/, '');
    if (file.name.startsWith(baseName + ' ')) return file.name;
  }
  return null;
}

function inferBranch(slug, lastName, relationships) {
  const telferNames = ['telfer'];
  const parkerNames = ['parker'];
  const lawrieNames = ['lawrie', 'hosking', 'dunlop'];
  const bakerNames = ['baker', 'march', 'webster'];
  const provisNames = ['provis'];
  const mastersNames = ['masters'];
  const wrightNames = ['wright'];
  const sporerNames = ['sporer', 'spehr'];
  const cullenNames = ['cullen'];
  const henstridgeNames = ['henstridge'];
  const ivoryNames = ['ivory'];
  const virgenNames = ['virgen', 'wode'];

  const name = (lastName || '').toLowerCase();
  const slugLower = slug.toLowerCase();

  if (telferNames.some(n => name.includes(n) || slugLower.includes(n))) return 'telfer';
  if (parkerNames.some(n => name.includes(n) || slugLower.includes(n))) return 'parker';
  if (lawrieNames.some(n => name.includes(n) || slugLower.includes(n))) return 'lawrie';
  if (bakerNames.some(n => name.includes(n) || slugLower.includes(n))) return 'baker';
  if (provisNames.some(n => name.includes(n) || slugLower.includes(n))) return 'provis';
  if (mastersNames.some(n => name.includes(n) || slugLower.includes(n))) return 'masters';
  if (wrightNames.some(n => name.includes(n) || slugLower.includes(n))) return 'wright';
  if (sporerNames.some(n => name.includes(n) || slugLower.includes(n))) return 'sporer';
  if (cullenNames.some(n => name.includes(n) || slugLower.includes(n))) return 'cullen';
  if (henstridgeNames.some(n => name.includes(n) || slugLower.includes(n))) return 'henstridge';
  if (ivoryNames.some(n => name.includes(n) || slugLower.includes(n))) return 'ivory';
  if (virgenNames.some(n => name.includes(n) || slugLower.includes(n))) return 'virgen';

  // Check spouse relationships
  for (const rel of relationships) {
    if (rel.type === 'Spouse') {
      for (const spouse of rel.names) {
        const spouseSlug = slugify(spouse);
        const inferred = inferBranch(spouseSlug, '', []);
        if (inferred !== 'other') return inferred;
      }
    }
  }

  return 'other';
}

function createStubPerson(name, slug, sourceSlug, relationshipType) {
  // Skip if name looks like a placeholder
  if (!name || name === '?' || name.toLowerCase() === 'unknown') return null;
  if (name.match(/^\(?\d{4}[\-–]\d{4}\)?$/)) return null; // just dates
  if (name.match(/^(Self|Spouse|Father|Mother|Children|Siblings)$/i)) return null;

  // Skip marriage records, maiden-name refs, family-group refs, wedding-party refs
  // These are not people but metadata artifacts from Obsidian tables
  const slugLower = slug.toLowerCase();
  if (slugLower.includes('-m-') && slugLower.match(/-m-\\d{1,2}-[a-z]{3}-\\d{4}/)) return null; // marriage date pattern
  if (slugLower.includes('-ne-')) return null; // née/maiden name reference
  if (slugLower.match(/-[a-z]+-[a-z]+-[a-z]+-[a-z]+-[a-z]+-[a-z]+/)) return null; // family group with 6+ names
  if (slugLower.includes('george-wright-telfer') || slugLower.includes('margaret-dougal-telfer')) return null; // wedding party

  // Extract birth/death years from name if present: "Name (1800–1850)"
  const yearMatch = name.match(/\\((\\d{4})[\\-–](\\d{4}|living|\\?)\\)/i);
  const birthYear = yearMatch ? parseInt(yearMatch[1], 10) : null;
  const deathYear = yearMatch ? (yearMatch[2] === 'living' ? null : parseInt(yearMatch[2], 10)) : null;

  // Skip generic stubs with no proper birth/death years (e.g., "John (~1839–)", "John Telfer", "John (?)")
  // These create catch-all stubs that absorb unrelated people
  if (!birthYear && !deathYear) {
    return null;
  }

  const cleanName = name.replace(/\\s*\\([^)]+\\)$/, '').trim();
  const isLiving = !deathYear && birthYear && birthYear >= 1940;

  return {
    id: cleanName,
    slug,
    first_name: cleanName.split(' ')[0] || '',
    middle_name: cleanName.split(' ').slice(1, -1).join(' ') || null,
    last_name: cleanName.split(' ').pop() || '',
    birth_year: birthYear,
    death_year: deathYear,
    birth_year_display: birthYear ? String(birthYear) : '?',
    death_year_display: deathYear ? String(deathYear) : (isLiving ? 'living' : '?'),
    display_name: `${cleanName} (${birthYear ? String(birthYear) : '?'}–${deathYear ? String(deathYear) : (isLiving ? 'living' : '?')})`,
    title: `${cleanName} — Family & Biography`,
    tags: ['bio', 'family', 'person', 'stub', 'needs-research'],
    relationships: [{ type: relationshipType, names: [name] }],
    roles: [],
    body_markdown: null,
    body_stripped: null,
    is_living: isLiving,
    lifespan: `${birthYear ? String(birthYear) : '?'} – ${deathYear ? String(deathYear) : (isLiving ? 'living' : '?')}`,
    generation: null,
    branch: inferBranch(slug, cleanName.split(' ').pop() || '', []),
    confidence: 'low',
    parents: [],
    children: [],
    spouses: [],
    siblings: [],
    related_trees: ['telfer-main'],
    vault_file: null,
    images: [],
    person_photo: null,
    _stub_source: sourceSlug,
    _stub_relationship: relationshipType
  };
}

function extractImages(body, vaultFile) {
  const images = [];
  const imgRegex = /!\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = imgRegex.exec(body)) !== null) {
    const imgPath = match[1];
    // Handle: "Family History/_assets/Shirley Telfer - Portrait.jpg"
    // or: "images/people/adam-francis-telfer-grave.jpg"
    const fullPath = path.join(IMAGES_BASE, imgPath);
    if (fs.existsSync(fullPath)) {
      const filename = path.basename(fullPath);
      images.push({
        src: `images/people/${filename}`,
        alt: filename.replace(/\.[^.]+$/, ''),
        caption: '',
        vault_path: fullPath,
        filename
      });
    }
  }
  // Also check for standard markdown images
  const mdImgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  while ((match = mdImgRegex.exec(body)) !== null) {
    const alt = match[1];
    const src = match[2];
    if (src.startsWith('images/people/')) {
      const filename = path.basename(src);
      images.push({
        src,
        alt: alt || filename,
        caption: '',
        vault_path: path.join(VAULT_PEOPLE_DIR, '..', src),
        filename
      });
    }
  }
  return images;
}

// ─── Main Build ────────────────────────────────────────────────────────────

async function build() {
  console.log('📚 Reading vault people directory...');
  const files = fs.readdirSync(VAULT_PEOPLE_DIR)
    .filter(f => f.endsWith('.md') && f !== 'Leads.md' && f !== '_Index.md')
    .map(f => ({ name: f, path: path.join(VAULT_PEOPLE_DIR, f) }));

  console.log(`Found ${files.length} person files`);

  // Build name → slug map for wiki-link resolution
  const nameToSlug = new Map();
  const fileData = [];

  // First pass: parse frontmatter, build slug map
  for (const file of files) {
    const content = fs.readFileSync(file.path, 'utf-8');
    const { data: fm } = matter(content);

    const firstName = fm.first_name || '';
    const middleName = fm.middle_name || '';
    const lastName = fm.last_name || '';
    const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ');

    // Generate slug from filename (remove .md)
    const baseSlug = slugify(file.name.replace(/\.md$/, ''));
    nameToSlug.set(fullName, baseSlug);
    nameToSlug.set(fm.title || '', baseSlug);

    // Also map common variants
    if (fm.birth_year && fm.death_year) {
      nameToSlug.set(`${fullName} (${fm.birth_year}–${fm.death_year})`, baseSlug);
    } else if (fm.birth_year) {
      nameToSlug.set(`${fullName} (${fm.birth_year}–?)`, baseSlug);
    }

    fileData.push({ file, fm, content });
  }

  console.log('🔗 Resolving relationships and building person objects...');

  // Second pass: build full person objects
  const people = [];
  const slugToPerson = new Map();

  for (const { file, fm, content } of fileData) {
    const firstName = fm.first_name || '';
    const middleName = fm.middle_name || '';
    const lastName = fm.last_name || '';
    const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ');

    const birthYear = fm.birth_year || null;
    const deathYear = fm.death_year || null;
    const slug = slugify(file.name.replace(/\.md$/, ''));

    // Parse relationships from frontmatter + body
    const fmRels = parseRelationships(fm.relationships);
    const bodyRels = extractRelationshipsFromBody(content);
    const allRels = [...fmRels, ...bodyRels];

    // Deduplicate relationships by type
    const relMap = new Map();
    for (const rel of allRels) {
      const existing = relMap.get(rel.type) || { type: rel.type, names: [] };
      for (const name of rel.names) {
        if (!existing.names.includes(name)) existing.names.push(name);
      }
      relMap.set(rel.type, existing);
    }
    const relationships = Array.from(relMap.values());

    // Extract parents, children, spouses, siblings for easy linking
    const parents = [];
    const children = [];
    const spouses = [];
    const siblings = [];

    for (const rel of relationships) {
      for (const name of rel.names) {
        const targetSlug = nameToSlug.get(name);
        if (!targetSlug) continue;

        switch (rel.type) {
          case 'Father':
          case 'Mother':
            if (!parents.includes(targetSlug)) parents.push(targetSlug);
            break;
          case 'Children':
            if (!children.includes(targetSlug)) children.push(targetSlug);
            break;
          case 'Spouse':
            if (!spouses.includes(targetSlug)) spouses.push(targetSlug);
            break;
          case 'Siblings':
            if (!siblings.includes(targetSlug)) siblings.push(targetSlug);
            break;
        }
      }
    }

    // Determine branch
    const branch = inferBranch(slug, lastName, relationships);
    // Ensure telfer branch for Telfer surname
    const finalBranch = lastName.toLowerCase() === 'telfer' ? 'telfer' : branch;

    // Confidence from tags
    const confidence = fm.tags?.includes('mystery-resolved') ? 'high' :
                       fm.tags?.includes('stub') || fm.tags?.includes('needs-research') ? 'low' : 'medium';

    // Images
    const images = extractImages(content, file.name);
    const personPhoto = images[0]?.src || null;

    // Estimate birth year from body if not in frontmatter
    let estimatedBirth = null;
    if (!birthYear) {
      estimatedBirth = estimateBirthFromBody(content);
      if (estimatedBirth) {
        console.log(`   📅 Estimated birth for ${fullName}: ${estimatedBirth}`);
      }
    }

    // Determine living status - use estimated birth if available
    const effectiveBirthYear = birthYear || estimatedBirth;
    const isLiving = !deathYear && effectiveBirthYear && effectiveBirthYear >= 1940;
    const birthDisplay = effectiveBirthYear ? String(effectiveBirthYear) : '?';
    const deathDisplay = deathYear ? String(deathYear) : (deathYear === 0 ? '?' : (isLiving ? 'living' : '?'));

    // Build person object
    const person = {
      id: fullName,
      slug,
      first_name: firstName,
      middle_name: middleName || null,
      last_name: lastName,
      birth_year: effectiveBirthYear,
      death_year: deathYear,
      birth_year_display: birthDisplay,
      death_year_display: deathDisplay,
      display_name: `${fullName} (${birthDisplay}–${deathDisplay === 'living' ? 'living' : deathDisplay})`,
      title: fm.title || `${fullName} — Family & Biography`,
      tags: fm.tags || ['bio', 'family', 'person'],
      relationships,
      roles: fm.roles || [],
      body_markdown: isLiving ? null : content,
      body_stripped: isLiving ? null : content.replace(/^---[\s\S]*?---/, '').trim(),
      is_living: isLiving,
      lifespan: `${birthDisplay} – ${deathDisplay === 'living' ? 'living' : deathDisplay}`,
      generation: null, // computed later
      branch: finalBranch,
      confidence,
      parents,
      children,
      spouses,
      siblings,
      related_trees: [...new Set([finalBranch, 'telfer-main'])], // will expand
      vault_file: file.name,
      images,
      person_photo: personPhoto,
      // DNA connections
      dna_matches: fm.dna_matches || [],
      haplogroup_mt: fm.haplogroup_mt || null,
      haplogroup_y: fm.haplogroup_y || null
    };

    people.push(person);
    slugToPerson.set(slug, person);
  }

  console.log(`Built ${people.length} person objects`);

  // Third pass: create stub entries for referenced people not in vault
  console.log('🔧 Creating stub entries for referenced people...');
  const allSlugs = new Set(slugToPerson.keys());
  const stubPeople = [];
  let unresolved = 0;

  for (const person of people) {
    for (const rel of person.relationships) {
      for (const name of rel.names) {
        const cleanName = name.trim();
        if (!cleanName || cleanName === '?' || cleanName.toLowerCase() === 'unknown') continue;

        const targetSlug = nameToSlug.get(cleanName) || slugify(cleanName);
        if (allSlugs.has(targetSlug)) continue;

        // Create stub person
        const stub = createStubPerson(cleanName, targetSlug, person.slug, rel.type);
        if (stub) {
          stubPeople.push(stub);
          allSlugs.add(targetSlug);
          nameToSlug.set(cleanName, targetSlug);
          slugToPerson.set(targetSlug, stub);
        } else {
          console.log(`   ⚠️  Unresolved: ${person.slug} → ${rel.type}: ${cleanName}`);
          unresolved++;
        }
      }
    }
  }

  // Add stubs to people array
  people.push(...stubPeople);
  console.log(`Created ${stubPeople.length} stub entries`);
  console.log(`Unresolved relationships: ${unresolved}`);

  // Compute generations from tree structure
  console.log('🌳 Computing generations from tree structure...');
  const generationsComputed = computeGenerations(people);
  console.log(`   Computed generations for ${generationsComputed} people`);

  // Log generation distribution
  const genCounts = {};
  for (const p of people) {
    if (p.generation) genCounts[p.generation] = (genCounts[p.generation] || 0) + 1;
  }
  console.log('\n📊 Generation Distribution:');
  for (let g = 1; g <= Math.max(...Object.keys(genCounts).map(Number)); g++) {
    console.log(`   Gen ${g}: ${genCounts[g] || 0}`);
  }

  // Write output
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(people, null, 2));
  console.log(`✅ Written to ${OUTPUT_PATH}`);

  // Summary stats
  const living = people.filter(p => p.is_living).length;
  const deceased = people.filter(p => !p.is_living).length;
  const branches = [...new Set(people.map(p => p.branch))];
  console.log(`\n📊 Summary:`);
  console.log(`   Total: ${people.length}`);
  console.log(`   Living: ${living}`);
  console.log(`   Deceased: ${deceased}`);
  console.log(`   Branches: ${branches.join(', ')}`);

  return people;
}

build().catch(err => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});