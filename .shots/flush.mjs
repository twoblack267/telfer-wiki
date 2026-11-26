import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto('http://localhost:4402/timeline/', { waitUntil: 'networkidle' });
const r = await p.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const grid = document.querySelector('.tl-grid');
  const cell = document.querySelector('.tl-free-cell') || document.querySelectorAll('.tl-grid > *')[1];
  const deck = document.querySelector('[data-deck]');
  const card = document.querySelector('[data-fcard]');
  const chain = [];
  let n = card;
  while (n && n !== document.body) {
    const cs = getComputedStyle(n);
    const rc = n.getBoundingClientRect();
    chain.push({tag: n.className || n.tagName, gapRight: Math.round(vw - rc.right), w: Math.round(rc.width),
      pr: cs.paddingRight, mr: cs.marginRight, border: cs.borderRightWidth});
    n = n.parentElement;
  }
  return {vw, gridPadding: getComputedStyle(grid).paddingRight, gridGap: getComputedStyle(grid).columnGap, chain};
});
console.log(JSON.stringify(r, null, 1));
await b.close();
