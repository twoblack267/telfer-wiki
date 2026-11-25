import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 900 } });
await p.goto('http://localhost:4402/timeline/', { waitUntil: 'networkidle' });
const r = await p.evaluate(() => {
  const kids = [...document.querySelectorAll('.tl-grid > *')].map((e, i) => {
    const rc = e.getBoundingClientRect();
    return { i, cls: e.className, dec: e.getAttribute('data-decade'),
             top: Math.round(rc.top + window.scrollY), left: Math.round(rc.left) };
  });
  const out = [];
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (k.cls.includes('tl-card-cell') && !k.cls.includes('is-empty')) {
      const head = kids[i-1];
      out.push({ headDecade: head ? head.dec : null, cardTop: k.top, headTop: head ? head.top : null,
                 delta: head ? k.top - head.top : null, left: k.left });
    }
  }
  const heads = kids.filter(k => k.dec !== null).length;
  const cards = kids.filter(k => k.cls.includes('tl-card-cell') && !k.cls.includes('is-empty')).length;
  const empty = kids.filter(k => k.cls.includes('is-empty')).length;
  return { heads, cards, emptyCells: empty, pairs: out };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
