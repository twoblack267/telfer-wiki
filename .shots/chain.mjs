import { chromium } from 'playwright';
const b = await chromium.launch();
for (const w of [390, 820, 1440]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
  await p.goto('http://localhost:4402/timeline/', { waitUntil: 'networkidle' });
  const r = await p.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const card = document.querySelector('[data-fcard]');
    const out = [];
    let n = card;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      const rc = n.getBoundingClientRect();
      out.push({cls: (n.className+'').split(' ').slice(0,3).join('.') || n.tagName,
        gap: Math.round(vw - rc.right), pr: cs.paddingRight, mr: cs.marginRight, w: Math.round(rc.width)});
      n = n.parentElement;
    }
    return {vw, gapVar: getComputedStyle(document.documentElement).getPropertyValue('--wrap-gap'), chain: out.slice(0,7)};
  });
  console.log('== ' + w, 'gapVar=' + r.gapVar);
  r.chain.forEach(c => console.log('   ' + c.cls.padEnd(28) + ' gap=' + String(c.gap).padStart(4) + ' pr=' + c.pr.padEnd(7) + ' mr=' + c.mr.padEnd(8) + ' w=' + c.w));
  await p.close();
}
await b.close();
