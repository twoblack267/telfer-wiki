import { chromium } from 'playwright';
import fs from 'fs';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto('http://localhost:4402/timeline/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1000);
const rows = await p.evaluate(() => [...document.querySelectorAll('[data-rd]')].map(n => ({
  kind: n.dataset.kind, title: n.dataset.title || '', slug: n.dataset.slug || '',
  text: n.dataset.text || ''
})));
await b.close();
fs.writeFileSync('/tmp/cards.json', JSON.stringify(rows));

const people = JSON.parse(fs.readFileSync('src/data/people.public.json','utf8'));
const slugs = new Set(people.filter(x=>x.slug).map(x=>x.slug));
const nameOf = new Map(people.filter(x=>x.slug).map(x=>[x.slug, x.display_name||'']));

// 1. every data-slug must exist in the vault-derived data
const badSlugs = rows.filter(r => r.slug && !slugs.has(r.slug));
// 2. no raw slug shapes leaking into visible text
const slugLeak = rows.filter(r => /(^|\s)[a-z0-9]+-[a-z0-9]+-[0-9]{3,4}(\s|$)/.test(r.text));
// 3. no template/placeholder junk
const junk = rows.filter(r => /undefined|null|NaN|\[object|TODO|XXX|\{\{|\}\}/i.test(r.text));
// 4. no empty
const empty = rows.filter(r => !r.text.trim());
// 5. duplication per family person (birth row should equal death row body)
console.log('CARDS=' + rows.length);
console.log('BAD_SLUGS=' + badSlugs.length + ' ' + JSON.stringify(badSlugs.slice(0,5).map(r=>r.slug)));
console.log('SLUG_LEAK=' + slugLeak.length + ' ' + JSON.stringify(slugLeak.slice(0,5).map(r=>({t:r.title,x:r.text.slice(0,80)}))));
console.log('JUNK=' + junk.length + ' ' + JSON.stringify(junk.slice(0,5).map(r=>({t:r.title,x:r.text.slice(0,90)}))));
console.log('EMPTY=' + empty.length);

// 6. factual sanity inside card text: a death year must not precede a birth year
const yr = s => (s.match(/\b(1[5-9]\d{2}|20[0-2]\d)\b/g)||[]).map(Number);
let inverted = [];
for (const r of rows) {
  const born = /Born:\s*([^—\n]*?)(\d{4})/.exec(r.text);
  const died = /Died:\s*([^—\n]*?)(\d{4})/.exec(r.text);
  if (born && died && Number(died[2]) < Number(born[2])) inverted.push({t:r.title,b:born[2],d:died[2]});
}
console.log('INVERTED_DATES=' + inverted.length + ' ' + JSON.stringify(inverted.slice(0,5)));

// 7. ages: any "aged N" over 110 or under 0
const ages = [];
for (const r of rows) { const m = /dies, aged (\d+)/.exec(r.text); if (m) { const a=+m[1]; if (a>110||a<0) ages.push({t:r.title,a}); } }
console.log('BAD_AGES=' + ages.length + ' ' + JSON.stringify(ages.slice(0,5)));
fs.writeFileSync('/tmp/audit.json', JSON.stringify({badSlugs, slugLeak, junk, inverted, ages}, null, 1));
