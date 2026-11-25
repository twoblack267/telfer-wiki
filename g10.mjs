import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 900 } });
await p.goto('http://localhost:4402/timeline/', { waitUntil: 'networkidle' });
const r = await p.evaluate(() => {
  const titles = [...document.querySelectorAll('.tl-card-cell')].map(e => (e.innerText||'').split('\n').filter(Boolean));
  return { count: titles.length, all: titles };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
