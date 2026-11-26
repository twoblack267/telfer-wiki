import { chromium } from 'playwright';
const b = await chromium.launch();
const url = process.env.URL || 'http://localhost:4402/timeline/';
for (const [name, w, h] of [['phone',390,1100],['desk',1400,1000]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto(url, { waitUntil: 'networkidle' });
  for (const label of ['A council can call your book in','Permission to stand on the footpath']) {
    const el = p.locator('.freedom-card', { hasText: label }).first();
    await el.scrollIntoViewIfNeeded();
    const box = await el.boundingBox();
    const cls = await el.getAttribute('class');
    const txt = (await el.innerText()).slice(0,90).replace(/\n/g,' | ');
    console.log(name, label, 'y=' + Math.round(box?.y ?? -1), 'x=' + Math.round(box?.x ?? -1), cls, '::', txt);
    await p.screenshot({ path: `/tmp/${name}_${label.split(' ')[0]}.png` });
  }
  await p.close();
}
console.log('cards total:', await (async()=>{const p=await b.newPage();await p.goto(url,{waitUntil:'networkidle'});const n=await p.locator('.freedom-card').count();await p.close();return n;})());
await b.close();
