import { getLinksForRelationships } from './src/utils/format-body.mjs';
import json from './src/data/people.public.json' with { type: 'json' };

const name = "James Telfer (1796–1863)";
const results = getLinksForRelationships([name], json);
console.log(`Name: ${name}`);
console.log(`Resolved slug: ${results[0].slug}`);

// Check what people have display_name "James Telfer"
const james = json.filter(p => p.display_name?.toLowerCase() === "james telfer");
console.log(`\nPeople with display_name "James Telfer": ${james.length}`);
james.forEach(p => console.log(`  ${p.slug} — birth: ${p.birth_year}, death: ${p.death_year}, living: ${p.is_living}`));

// Debug exact match path
const clean = name.replace(/\([^)]*\d[^)]*\)/g, "").trim().toLowerCase();
console.log(`\nClean name (after date strip): "${clean}"`);
const exactMatches = json.filter(p => p.display_name?.toLowerCase() === clean);
console.log(`Exact matches for "${clean}": ${exactMatches.length}`);
exactMatches.forEach(p => console.log(`  ${p.slug} — birth: ${p.birth_year}`));

// Try first+last match
const [first, ...rest] = clean.split(/\s+/);
const last = rest.pop() || "";
const firstLastMatches = json.filter(p => p.first_name?.toLowerCase() === first && p.last_name?.toLowerCase() === last);
console.log(`\nFirst+last matches for "${first} ${last}": ${firstLastMatches.length}`);
firstLastMatches.forEach(p => console.log(`  ${p.slug} — birth: ${p.birth_year}`));
