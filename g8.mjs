import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 900 } });
await p.goto('http://localhost:4402/timeline/', { waitUntil: 'networkidle' });
const info = await p.evaluate(() => {
  const kids = [...document.querySelectorAll('.tl-grid > *')];
  return kids.slice(0, 6).map(e => ({ cls: e.className, attrs: [...e.attributes].map(a => a.name + '=' + a.value), text: (e.innerText||'').slice(0,60).replace(/\n/g,' | ') }));
});
console.log(JSON.stringify(info, null, 1));
await b.close();
