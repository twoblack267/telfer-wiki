import { personCardText } from '../src/utils/timeline-card-text.mjs';
import fs from 'fs';
const p = JSON.parse(fs.readFileSync('src/data/people.public.json','utf8'));
const tel = p.filter(x => (x.branch==='telfer' || !x.branch) && x.id);
const idx = new Map(p.filter(x=>x.slug).map(x=>[x.slug,x]));
const pick = ['john-ernest-telfer','margaret-dougal-smith-1868','jennifer-bunston','crystal-rose-mcdonald','janet-welsh-1826','george-telfer-1850'];
for (const s of pick) {
  const person = tel.find(x=>x.slug===s);
  if (!person) { console.log('MISSING ' + s); continue; }
  console.log('\n########## ' + s + ' | living=' + person.is_living + ' | span=' + person.lifespan);
  console.log(personCardText(person, idx));
}
// stats
let lens=[], emptyish=0;
for (const x of tel) { const t = personCardText(x, idx); lens.push(t.length); if (t.length < 60) emptyish++; }
lens.sort((a,b)=>a-b);
console.log('\n=== STATS over ' + tel.length + ' ===');
console.log('min', lens[0], 'p05', lens[Math.floor(lens.length*.05)], 'median', lens[Math.floor(lens.length/2)], 'max', lens[lens.length-1]);
console.log('under 60 chars:', emptyish);
