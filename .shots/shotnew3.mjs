import { chromium } from 'playwright';
const b = await chromium.launch();
for (const [name, w, h, label] of [
  ['ph1930', 390, 1100, 'Permission to stand on the footpath'],
  ['dk1930', 1400, 1400, 'Permission to stand on the footpath'],
]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto('http://localhost:4402/timeline/', { waitUntil: 'networkidle' });
  const box = await p.locator('.freedom-card', { hasText: label }).first().boundingBox();
  await p.evaluate(y => window.scrollTo(0, y), Math.max(0, box.y - 200));
  await p.waitForTimeout(500);
  await p.screenshot({ path: `/tmp/v_${name}.png` });
  console.log(name, 'y', Math.round(box.y), 'x', Math.round(box.x));
  await p.close();
}
await b.close();
