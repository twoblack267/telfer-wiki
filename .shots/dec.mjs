import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 1100 } });
await p.goto(process.env.URL || 'http://localhost:4402/timeline/', { waitUntil: 'networkidle' });
const info = await p.evaluate(() => {
  const cards = [...document.querySelectorAll('.freedom-card')];
  const out = [];
  for (const c of cards) {
    const t = c.innerText.split('\n')[1] || '';
    let el = c, label = null, depth = 0;
    while (el && depth < 7) {
      const sibs = [...el.parentElement?.children ?? []];
      for (const s of sibs) {
        const m = (s.innerText || '').trim().match(/^(\d{4})s$/m);
        if (m && s !== el) { label = label || m[1] + 's'; }
      }
      if (label) break;
      el = el.parentElement; depth++;
    }
    out.push({ t: t.slice(0, 40), decade: label, x: Math.round(c.getBoundingClientRect().x), col: Math.round(c.getBoundingClientRect().x / 130) + 1 });
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await b.close();
