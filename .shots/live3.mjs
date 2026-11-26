import { chromium } from 'playwright';
const b = await chromium.launch();
for (const [name, w, h, label] of [
  ['l1930', 390, 1100, 'Permission to stand on the footpath'],
  ['lbook', 390, 1100, 'A council can call your book in'],
]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto('https://telferwiki.com/timeline/', { waitUntil: 'networkidle', timeout: 60000 });
  const el = p.locator('.freedom-card', { hasText: label }).first();
  const box = await el.boundingBox();
  await p.evaluate(y => window.scrollTo(0, y), Math.max(0, box.y - 200));
  await p.waitForTimeout(600);
  await p.screenshot({ path: `/tmp/${name}.png` });
  const col = Math.round(box.x / 130) + 1;
  console.log(name, 'x', Math.round(box.x), 'col', col);
  await p.close();
}
console.log('cards on live page:', await (async () => {
  const p = await b.newPage({ viewport: { width: 390, height: 1100 } });
  await p.goto('https://telferwiki.com/timeline/', { waitUntil: 'networkidle', timeout: 60000 });
  const n = await p.locator('.freedom-card').count();
  await p.close();
  return n;
})());
await b.close();
