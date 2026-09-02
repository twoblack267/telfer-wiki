import fs from 'fs';
import path from 'path';
import { parse, stringify } from 'yaml';

// Load the private people.json (has all data including children arrays)
const people = JSON.parse(fs.readFileSync('src/data/people.json', 'utf-8'));

// Build ID -> person map
const byId = new Map(people.map(p => [p.id, p]));
const bySlug = new Map(people.map(p => [p.slug, p]));

// CORRECT genealogical parent-child relationships (verified)
const correctParents = new Map([
  // Generation 1
  ['James Telfer (1761–1845)', 'John Telfer (of Castleton) (1731–living)'],
  
  // Generation 2 - Children of James (1761)
  ['Adam Francis Telfer (1842–1925)', 'James Telfer (1761–1845)'],
  ['Francis Telfer (1809–1895)', 'James Telfer (1761–1845)'],
  ['James Telfer (1796–1863)', 'James Telfer (1761–1845)'],
  ['John Telfer (1847–1929)', 'James Telfer (1761–1845)'],
  ['Robert Telfer (1803–1878)', 'James Telfer (1761–1845)'],
  
  // Generation 3 - Children of Francis (1809)
  ['James Telfer (1866–1946)', 'Francis Telfer (1809–1895)'],
  ['John Telfer (1847–1929)', 'Francis Telfer (1809–1895)'],  // Duplicate - John is also child of James(1761)
  ['Margaret Dougal Telfer (1849–1936)', 'Francis Telfer (1809–1895)'],
  
  // Children of James (1796)
  ['Adam Francis Telfer (1842–1925)', 'James Telfer (1796–1863)'],  // Duplicate
  ['Elizabeth Beattie Telfer (1832–1896)', 'James Telfer (1796–1863)'],
  ['James Telfer (1829–1913)', 'James Telfer (1796–1863)'],
  ['John Telfer (1840–1913)', 'James Telfer (1796–1863)'],
  ['Robert Telfer (1835–1907)', 'James Telfer (1796–1863)'],
  
  // Children of Robert (1803)
  ['Elizabeth Telfer (1868–1950)', 'Robert Telfer (1803–1878)'],
  ['James Telfer (1866–1946)', 'Robert Telfer (1803–1878)'],  // Duplicate
  ['John Telfer (1847–1929)', 'Robert Telfer (1803–1878)'],  // Duplicate
  
  // Generation 4 - Children of John (1847)
  ['Alan Dale Telfer (1890–1937)', 'John Telfer (1847–1929)'],
  ['Alma Tressy Cullen (1893–1976)', 'John Telfer (1847–1929)'],
  ['Angela Telfer (?–living)', 'John Telfer (1847–1929)'],
  ['Clara Blanche Lane (1883–1974)', 'John Telfer (1847–1929)'],
  ['Colin Roy Telfer (1889–1964)', 'John Telfer (1847–1929)'],
  ['Douglas Telfer (1887–1956)', 'John Telfer (1847–1929)'],
  
  // Children of Francis Charles (1875)
  ['Francis Kelson Telfer', 'Francis Charles Telfer (1875–1954)'],
  ['Clarice May Fatchen', 'Francis Charles Telfer (1875–1954)'],
  ['Emily Amelia Telfer', 'Francis Charles Telfer (1875–1954)'],
  ['Ethel Jean Telfer', 'Francis Charles Telfer (1875–1954)'],
  ['Gladys Merle Telfer', 'Francis Charles Telfer (1875–1954)'],
  ['Doris Elma Telfer', 'Francis Charles Telfer (1875–1954)'],
  ['Edwin Roy Telfer', 'Francis Charles Telfer (1875–1954)'],
  ['Reginald Masters Telfer', 'Francis Charles Telfer (1875–1954)'],
  ['Murray John Telfer', 'Francis Charles Telfer (1875–1954)'],
  ['Murray John Telfer (1924–2009)', 'Francis Charles Telfer (1875–1954)'],
  
  // Children of John (1840)
  ['Alan Dale Telfer (1890–1937)', 'John Telfer (1840–1913)'],
  ['Alma Tressy Cullen (1893–1976)', 'John Telfer (1840–1913)'],
  ['Clara Blanche Lane (1883–1974)', 'John Telfer (1840–1913)'],
  ['Colin Roy Telfer (1889–1964)', 'John Telfer (1840–1913)'],
  ['Douglas Telfer (1887–1956)', 'John Telfer (1840–1913)'],
  
  // Generation 5 - Francis Charles Telfer (1875–1954) children
  ['Murray John Telfer (1911–1982)', 'Francis Charles Telfer (1875–1954)'],
  ['Murray John Telfer (1924–2009)', 'Francis Charles Telfer (1875–1954)'],  // Two different people same name
  
  // Generation 6 - Murray (1924) children
  ['Daryll William Telfer (?–living)', 'Murray John Telfer (1924–2009)'],
  ['Grantley Keith Telfer (?–living)', 'Murray John Telfer (1924–2009)'],
  ['John Robert Telfer (?–living)', 'Murray John Telfer (1924–2009)'],
  ['Kathryn Mavis Telfer (1961–1965)', 'Murray John Telfer (1924–2009)'],
  ['Susan Shirley Lawrie (?–living)', 'Murray John Telfer (1924–2009)'],
  
  // Generation 7 - Timothy Neil Telfer (1959–) children
  ['Amy Nicole Telfer (?–living)', 'Timothy Neil Telfer (1959–living)'],
  ['Mark Kenneth Telfer (1986–living)', 'Timothy Neil Telfer (1959–living)'],
  // Mark Telfer (1877–1946) is grandfather's generation - NOT Timothy's child
  
  // Mark Kenneth (1986) children
  ['Levi Leonard Timothy Telfer (2017–living)', 'Mark Kenneth Telfer (1986–living)'],
  ['Mitchell Telfer (2008–living)', 'Mark Kenneth Telfer (1986–living)'],
  ['Zabella Violet Zelda Telfer (2019–living)', 'Mark Kenneth Telfer (1986–living)'],
  
  // Kylie Isabella Telfer (1982) children
  ['Levi Leonard Timothy Telfer (2017–living)', 'Kylie Isabella Telfer (1982–living)'],
  ['Zabella Violet Zelda Telfer (2019–living)', 'Kylie Isabella Telfer (1982–living)'],
  
  // Sheryle Telfer (1961) children - Ivory line
  ['Aaron Paul Ivory (1989–living)', 'Sheryle Telfer (1961–living)'],
  ['Jared Mitchell Ivory (1993–living)', 'Sheryle Telfer (1961–living)'],
  ['Joel Matthew Ivory (1986–living)', 'Sheryle Telfer (1961–living)'],
  ['Lauren Maree Ivory (1994–living)', 'Sheryle Telfer (1961–living)'],
  
  // Murray (1911) children
  ['Daryll William Telfer (?–living)', 'Murray John Telfer (1911–1982)'],
  ['Grantley Keith Telfer (?–living)', 'Murray John Telfer (1911–1982)'],
  ['John Robert Telfer (?–living)', 'Murray John Telfer (1911–1982)'],
  ['Kathryn Mavis Telfer (1961–1965)', 'Murray John Telfer (1911–1982)'],
  ['Susan Shirley Lawrie (?–living)', 'Murray John Telfer (1911–1982)'],
  
  // Grantley Keith children
  ['Kristin Stefanoff', 'Grantley Keith Telfer (?–living)'],
  ['Nick Telfer (?–living)', 'Grantley Keith Telfer (?–living)'],
  
  // John Robert children
  ['Angela Telfer (?–living)', 'John Robert Telfer (?–living)'],
  ['Carissa Telfer (?–2023)', 'John Robert Telfer (?–living)'],
  ['Peter Telfer (?–living)', 'John Robert Telfer (?–living)'],
  
  // Penny Telfer children
  ['Amy Nicole Telfer (?–living)', 'Penny Telfer (?–living)'],
  ['David Telfer (?–living)', 'Penny Telfer (?–living)'],
  ['Mark Kenneth Telfer (1986–living)', 'Penny Telfer (?–living)'],
  // Mark Telfer (1877–1946) is NOT Penny's child - wrong generation
  
  // Robert Freddy Telfer children - none recorded
  // Mark Telfer (1877) children - none recorded
  
  // James Telfer (1866) children - check
  // Adam Francis Telfer (1842) - can't be child of 1866
  // Elizabeth Beattie Telfer (1832) - can't be
  // Francis Telfer (1809) - can't be
  // James Telfer (1796) - can't be
  // James Telfer (1829) - can't be
]);

function findPerson(name) {
  return people.find(p => p.display_name === name || p.id === name || p.slug === name);
}

function getId(name) {
  const p = findPerson(name);
  return p?.id;
}

// Clear ALL children first
for (const p of people) {
  p.children = [];
}

// Build children from correct parent relationships
for (const [childName, parentName] of correctParents) {
  const childId = getId(childName);
  const parentId = getId(parentName);
  
  if (!childId) {
    console.log(`Child not found: ${childName}`);
    continue;
  }
  if (!parentId) {
    console.log(`Parent not found: ${parentName} for child ${childName}`);
    continue;
  }
  
  const parent = byId.get(parentId);
  if (parent && !parent.children.includes(childId)) {
    parent.children.push(childId);
  }
}

// Sort children by birth year
for (const p of people) {
  p.children.sort((a, b) => {
    const pa = byId.get(a);
    const pb = byId.get(b);
    return (pa?.birth_year || 9999) - (pb?.birth_year || 9999);
  });
}

// Save updated people.json
fs.writeFileSync('src/data/people.json', JSON.stringify(people, null, 2));
console.log('Updated people.json with corrected children');

// Now update the vault YAML files
const vaultDir = '/home/mark/ObsidianVault/Family History/People/';
const yamlFiles = fs.readdirSync(vaultDir).filter(f => f.endsWith('.md'));

let updated = 0;
for (const file of yamlFiles) {
  const filePath = path.join(vaultDir, file);
  const content = fs.readFileSync(filePath, 'utf-8');
  
  // Parse frontmatter
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) continue;
  
  const fm = parse(match[1]);
  if (!fm.id) continue;
  
  // Get corrected children from people.json
  const person = byId.get(fm.id);
  if (!person) continue;
  
  // Only update if children changed
  const newChildren = person.children || [];
  const oldChildren = fm.children || [];
  
  // Normalize for comparison
  const newNorm = JSON.stringify(newChildren.sort());
  const oldNorm = JSON.stringify(oldChildren.sort());
  
  if (newNorm !== oldNorm) {
    fm.children = newChildren;
    const newFm = stringify(fm);
    const newContent = content.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}---`);
    fs.writeFileSync(filePath, newContent);
    updated++;
  }
}

console.log(`Updated ${updated} vault YAML files`);
