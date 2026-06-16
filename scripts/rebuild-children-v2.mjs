import fs from 'fs';
import path from 'path';
import { parse, stringify } from 'yaml';

// Load the private people.json
const people = JSON.parse(fs.readFileSync('src/data/people.json', 'utf-8'));

// Build lookup by display_name
const byDisplayName = new Map(people.map(p => [p.display_name, p]));
const bySlug = new Map(people.map(p => [p.slug, p]));

// CORRECT genealogical parent-child relationships using FULL display names
const correctParents = [
  // Generation 1
  { child: 'James Telfer (1761–1845)', parent: 'John Telfer (of Castleton) (1731–living)' },
  
  // Generation 2 - Children of James (1761)
  { child: 'Adam Francis Telfer (1842–1925)', parent: 'James Telfer (1761–1845)' },
  { child: 'Francis Telfer (1809–1895)', parent: 'James Telfer (1761–1845)' },
  { child: 'James Telfer (1796–1863)', parent: 'James Telfer (1761–1845)' },
  { child: 'John Telfer (1847–1929)', parent: 'James Telfer (1761–1845)' },
  { child: 'Robert Telfer (1803–1878)', parent: 'James Telfer (1761–1845)' },
  
  // Generation 3 - Children of Francis (1809)
  { child: 'James Telfer (1866–1946)', parent: 'Francis Telfer (1809–1895)' },
  { child: 'John Telfer (1847–1929)', parent: 'Francis Telfer (1809–1895)' },
  { child: 'Margaret Dougal Telfer (1849–1936)', parent: 'Francis Telfer (1809–1895)' },
  
  // Children of James (1796)
  { child: 'Adam Francis Telfer (1842–1925)', parent: 'James Telfer (1796–1863)' },
  { child: 'Elizabeth Beattie Telfer (1832–1896)', parent: 'James Telfer (1796–1863)' },
  { child: 'James Telfer (1829–1913)', parent: 'James Telfer (1796–1863)' },
  { child: 'John Telfer (1840–1913)', parent: 'James Telfer (1796–1863)' },
  { child: 'Robert Telfer (1835–1907)', parent: 'James Telfer (1796–1863)' },
  
  // Children of Robert (1803)
  { child: 'Elizabeth Telfer (1868–1950)', parent: 'Robert Telfer (1803–1878)' },
  { child: 'James Telfer (1866–1946)', parent: 'Robert Telfer (1803–1878)' },
  { child: 'John Telfer (1847–1929)', parent: 'Robert Telfer (1803–1878)' },
  
  // Generation 4 - Children of John (1847)
  { child: 'Alan Dale Telfer (1890–1937)', parent: 'John Telfer (1847–1929)' },
  { child: 'Alma Tressy Cullen (1893–1976)', parent: 'John Telfer (1847–1929)' },
  { child: 'Angela Telfer (?–living)', parent: 'John Telfer (1847–1929)' },
  { child: 'Clara Blanche Lane (1883–1974)', parent: 'John Telfer (1847–1929)' },
  { child: 'Colin Roy Telfer (1889–1964)', parent: 'John Telfer (1847–1929)' },
  { child: 'Douglas Telfer (1887–1956)', parent: 'John Telfer (1847–1929)' },
  
  // Children of John (1840)
  { child: 'Alan Dale Telfer (1890–1937)', parent: 'John Telfer (1840–1913)' },
  { child: 'Alma Tressy Cullen (1893–1976)', parent: 'John Telfer (1840–1913)' },
  { child: 'Clara Blanche Lane (1883–1974)', parent: 'John Telfer (1840–1913)' },
  { child: 'Colin Roy Telfer (1889–1964)', parent: 'John Telfer (1840–1913)' },
  { child: 'Douglas Telfer (1887–1956)', parent: 'John Telfer (1840–1913)' },
  
  // Generation 5 - Francis Charles Telfer (1875–1954) children
  { child: 'Murray John Telfer (1911–1982)', parent: 'Francis Charles Telfer (1875–1954)' },
  { child: 'Murray John Telfer (1924–2009)', parent: 'Francis Charles Telfer (1875–1954)' },
  
  // Generation 6 - Murray (1924) children
  { child: 'Daryll William Telfer (?–living)', parent: 'Murray John Telfer (1924–2009)' },
  { child: 'Grantley Keith Telfer (?–living)', parent: 'Murray John Telfer (1924–2009)' },
  { child: 'John Robert Telfer (?–living)', parent: 'Murray John Telfer (1924–2009)' },
  { child: 'Kathryn Mavis Telfer (1961–1965)', parent: 'Murray John Telfer (1924–2009)' },
  { child: 'Susan Shirley Lawrie (?–living)', parent: 'Murray John Telfer (1924–2009)' },
  
  // Generation 7 - Timothy Neil Telfer (1959–) children
  { child: 'Amy Nicole Telfer (?–living)', parent: 'Timothy Neil Telfer (1959–living)' },
  { child: 'Mark Kenneth Telfer (1986–living)', parent: 'Timothy Neil Telfer (1959–living)' },
  
  // Mark Kenneth (1986) children
  { child: 'Levi Leonard Timothy Telfer (2017–living)', parent: 'Mark Kenneth Telfer (1986–living)' },
  { child: 'Mitchell Telfer (2008–living)', parent: 'Mark Kenneth Telfer (1986–living)' },
  { child: 'Zabella Violet Zelda Telfer (2019–living)', parent: 'Mark Kenneth Telfer (1986–living)' },
  
  // Kylie Isabella Telfer (1982) children
  { child: 'Levi Leonard Timothy Telfer (2017–living)', parent: 'Kylie Isabella Telfer (1982–living)' },
  { child: 'Zabella Violet Zelda Telfer (2019–living)', parent: 'Kylie Isabella Telfer (1982–living)' },
  
  // Sheryle Telfer (1961) children - Ivory line
  { child: 'Aaron Paul Ivory (1989–living)', parent: 'Sheryle Telfer (1961–living)' },
  { child: 'Jared Mitchell Ivory (1993–living)', parent: 'Sheryle Telfer (1961–living)' },
  { child: 'Joel Matthew Ivory (1986–living)', parent: 'Sheryle Telfer (1961–living)' },
  { child: 'Lauren Maree Ivory (1994–living)', parent: 'Sheryle Telfer (1961–living)' },
  
  // Murray (1911) children
  { child: 'Daryll William Telfer (?–living)', parent: 'Murray John Telfer (1911–1982)' },
  { child: 'Grantley Keith Telfer (?–living)', parent: 'Murray John Telfer (1911–1982)' },
  { child: 'John Robert Telfer (?–living)', parent: 'Murray John Telfer (1911–1982)' },
  { child: 'Kathryn Mavis Telfer (1961–1965)', parent: 'Murray John Telfer (1911–1982)' },
  { child: 'Susan Shirley Lawrie (?–living)', parent: 'Murray John Telfer (1911–1982)' },
  
  // Grantley Keith children
  { child: 'Kristin Stefanoff', parent: 'Grantley Keith Telfer (?–living)' },
  { child: 'Nick Telfer (?–living)', parent: 'Grantley Keith Telfer (?–living)' },
  
  // John Robert children
  { child: 'Angela Telfer (?–living)', parent: 'John Robert Telfer (?–living)' },
  { child: 'Carissa Telfer (?–2023)', parent: 'John Robert Telfer (?–living)' },
  { child: 'Peter Telfer (?–living)', parent: 'John Robert Telfer (?–living)' },
  
  // Penny Telfer children
  { child: 'Amy Nicole Telfer (?–living)', parent: 'Penny Telfer (?–living)' },
  { child: 'David Telfer (?–living)', parent: 'Penny Telfer (?–living)' },
  { child: 'Mark Kenneth Telfer (1986–living)', parent: 'Penny Telfer (?–living)' },
];

// Clear ALL children first
for (const p of people) {
  p.children = [];
}

// Build children from correct parent relationships using DISPLAY NAMES
for (const { child, parent } of correctParents) {
  const parentPerson = byDisplayName.get(parent);
  const childPerson = byDisplayName.get(child);
  
  if (!parentPerson) {
    console.log(`Parent not found: ${parent}`);
    continue;
  }
  if (!childPerson) {
    console.log(`Child not found: ${child}`);
    continue;
  }
  
  // Use child's display_name for the children array (so findPerson can disambiguate by birth year)
  if (!parentPerson.children.includes(childPerson.display_name)) {
    parentPerson.children.push(childPerson.display_name);
  }
}

// Sort children by birth year
for (const p of people) {
  p.children.sort((a, b) => {
    const pa = byDisplayName.get(a);
    const pb = byDisplayName.get(b);
    return (pa?.birth_year || 9999) - (pb?.birth_year || 9999);
  });
}

// Save updated people.json
fs.writeFileSync('src/data/people.json', JSON.stringify(people, null, 2));
console.log('Updated people.json with corrected children (display names)');

// Verify root
const root = people.find(p => p.display_name === 'John Telfer (of Castleton) (1731–living)');
console.log('Root children:', root?.children);

// Now update the vault YAML files
const vaultDir = '/home/mark/ObsidianVault/Family History/People/';
const yamlFiles = fs.readdirSync(vaultDir).filter(f => f.endsWith('.md'));

let updated = 0;
for (const file of yamlFiles) {
  const filePath = path.join(vaultDir, file);
  const content = fs.readFileSync(filePath, 'utf-8');
  
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) continue;
  
  const fm = parse(match[1]);
  if (!fm.id) continue;
  
  // Get corrected children from people.json (by matching display_name)
  const person = people.find(p => p.id === fm.id);
  if (!person) continue;
  
  const newChildren = person.children || [];
  const oldChildren = fm.children || [];
  
  const newNorm = JSON.stringify(newChildren.sort());
  const oldNorm = JSON.stringify(oldChildren.sort());
  
  if (newNorm !== oldNorm) {
    fm.children = newChildren.map(c => c.replace(/,/g, '\\,').replace(/:/g, '\\:')); // YAML escape
    const newFm = stringify(fm);
    const newContent = content.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}---`);
    fs.writeFileSync(filePath, newContent);
    updated++;
  }
}

console.log(`Updated ${updated} vault YAML files`);
