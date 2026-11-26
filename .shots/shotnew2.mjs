import { chromium } from 'playwright';
const b = await chromium.launch();
for (const [name, label] of [
  ['desk1930b', 'Permission to stand on the footpath'],
  ['deskbookb', 'A council can call your book in'],
]) {
  const p = await b.newPage({ viewport: { width: 1400, height: 1400 } });
  await p.goto('http://localhost:4402/timeline/', { waitUntil: 'networkidle' });
  const box = await p.locator('.freedom-card', { hasText: label }).first().boundingBox();
  await p.evaluate(y => window.scrollTo(0, y), Math.max(0, box.y - 220));
  await p.waitForTimeout(500);
  await p.screenshot({ path: `/tmp/v_${name}.png` });
  console.log(name, 'card y', Math.round(box.y), 'x', Math.round(box.x));
  await p.close();
}
await b.close();
