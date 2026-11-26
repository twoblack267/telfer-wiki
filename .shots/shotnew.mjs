import { chromium } from 'playwright';
const b = await chromium.launch();
const jobs = [
  ['phone1930', 390, 1100, 'Permission to stand on the footpath'],
  ['desk1930', 1400, 1000, 'Permission to stand on the footpath'],
  ['phonebook', 390, 1100, 'A council can call your book in'],
  ['deskbook', 1400, 1000, 'A council can call your book in'],
];
for (const [name, w, h, label] of jobs) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto('http://localhost:4402/timeline/', { waitUntil: 'networkidle' });
  const el = p.locator('.freedom-card', { hasText: label }).first();
  await el.scrollIntoViewIfNeeded();
  await p.evaluate(() => window.scrollBy(0, -60));
  await p.waitForTimeout(400);
  await p.screenshot({ path: `/tmp/v_${name}.png` });
  console.log(name, 'ok');
  await p.close();
}
await b.close();
