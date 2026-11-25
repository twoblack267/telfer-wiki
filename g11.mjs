import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto('http://localhost:4402/timeline/', { waitUntil: 'networkidle' });
const r = await p.evaluate(() => {
  const kids = [...document.querySelectorAll('.tl-grid > *')].map((e, i) => {
    const rc = e.getBoundingClientRect();
    return { i, cls: e.className, dec: e.getAttribute('data-decade'),
             top: Math.round(rc.top + window.scrollY), left: Math.round(rc.left), w: Math.round(rc.width) };
  });
  const out = [];
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (k.cls.includes('tl-card-cell') && !k.cls.includes('is-empty')) {
      const h = kids[i-1];
      out.push({ dec: h.dec, delta: k.top - h.top, cardLeft: k.left, cardW: k.w, headLeft: h.left });
    }
  }
  return { cards: out.length, out };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
