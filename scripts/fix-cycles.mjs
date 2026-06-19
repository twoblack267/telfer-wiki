/**
 * Fix known data issues: self-references and parent cycles.
 */
import fs from 'fs';

const FILE = './src/data/people.json';
const people = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
const find = slug => people.find(p => p.slug === slug);

let changes = [];

// 1. Self-references: william-parker and charles-farrow
['william-parker', 'charles-farrow'].forEach(slug => {
  const p = find(slug);
  if (p && p.children) {
    const filtered = p.children.filter(c => c !== slug);
    if (filtered.length !== p.children.length) {
      changes.push(`${slug}.children: removed self-ref`);
      p.children = filtered;
    }
  }
});

// 2. Ivory family cycles
const paul = find('paul-ivory');
if (paul) {
  const kidsOnly = paul.parents.filter(s => ['aaron-ivory','joel-ivory','lauren-ivory','jared-ivory','jared-ivory-1986','jared-mitchell-ivory-1993'].includes(s));
  if (kidsOnly.length > 0) {
    changes.push(`paul-ivory.parents: removed ${kidsOnly.length} children from parent list (${kidsOnly.join(', ')})`);
    paul.parents = paul.parents.filter(s => !kidsOnly.includes(s));
  }
}

['joel-ivory', 'lauren-ivory'].forEach(slug => {
  const p = find(slug);
  if (p && p.children && p.children.includes('paul-ivory')) {
    changes.push(`${slug}.children: removed paul-ivory (wrong direction)`);
    p.children = p.children.filter(c => c !== 'paul-ivory');
  }
});

// 3. Elizabeth Telfer (1774) cycles with francis and james-17961863
// Elizabeth (born 1774) is the MOTHER of Francis (born 1809) and James (born 1796)
// So she should NOT have them as PARENTS, and they should NOT have her as a CHILD
const eliz = find('elizabeth-telfer-1774');
if (eliz) {
  ['francis', 'james-17961863'].forEach(slug => {
    if (eliz.parents && eliz.parents.includes(slug)) {
      changes.push(`elizabeth-telfer-1774.parents: removed ${slug} (is her child, not parent)`);
      eliz.parents = eliz.parents.filter(p => p !== slug);
    }
  });
}

['francis', 'james-17961863'].forEach(slug => {
  const p = find(slug);
  if (p && p.children && p.children.includes('elizabeth-telfer-1774')) {
    changes.push(`${slug}.children: removed elizabeth-telfer-1774 (is his mother, not child)`);
    p.children = p.children.filter(c => c !== 'elizabeth-telfer-1774');
  }
});

console.log(`Changes made: ${changes.length}`);
changes.forEach(c => console.log('  - ' + c));

fs.writeFileSync(FILE, JSON.stringify(people, null, 2) + '\n');
console.log(`\n✅ Written people.json`);
