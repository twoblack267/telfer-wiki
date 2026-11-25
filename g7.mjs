import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 900 } });
await p.goto('http://localhost:4402/timeline/', { waitUntil: 'networkidle' });
const rows = await p.$$eval('.tl-grid > *', els => els.map(e => {
  const r = e.getBoundingClientRect();
  return { cls: e.className, dec: e.getAttribute('data-decade'), top: Math.round(r.top + window.scrollY), h: Math.round(r.height) };
}));
const heads = rows.filter(r => r.cls.includes('tl-cell') && !r.cls.includes('tl-card-cell'));
const cards = rows.filter(r => r.cls.includes('tl-card-cell'));
const out = cards.map(c => {
  const own = heads.filter(h => h.dec === c.dec).sort((a,b)=>Math.abs(a.top-c.top)-Math.abs(b.top-c.top))[0];
  return { card: c.dec, top: c.top, headingTop: own ? own.top : null, delta: own ? c.top - own.top : null };
});
const per = {};
for (const c of out) per[c.card] = (per[c.card]||0)+1;
console.log(JSON.stringify({ totalCards: cards.length, totalHeadings: heads.length, perDecade: per, cards: out }, null, 1));
await b.close();
