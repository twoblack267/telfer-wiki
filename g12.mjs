import { chromium } from 'playwright';
import fs from 'fs';

const browser = await chromium.launch();
const out = {};
for (const [name, w] of [['desktop', 1440], ['phone', 390]]) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } });
  await page.goto('http://localhost:4402/timeline/', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  out[name] = await page.evaluate(() => {
    const rows = [];
    const grid = document.querySelector('.tl-grid');
    const kids = [...grid.children];
    // group children in threes: cell, survival, freedom
    for (let i = 0; i < kids.length; i += 3) {
      const cell = kids[i], surv = kids[i + 1], free = kids[i + 2];
      if (!cell) continue;
      const h = cell.querySelector('h2');
      const hr = h ? h.getBoundingClientRect() : null;
      const sr = surv ? surv.getBoundingClientRect() : null;
      const fr = free ? free.getBoundingClientRect() : null;
      const sc = surv ? [...surv.querySelectorAll('.survival-card')] : [];
      const fc = free ? [...free.querySelectorAll('.freedom-card')] : [];
      rows.push({
        decade: cell.dataset.decade,
        heading: h ? h.textContent.trim() : null,
        headingTop: hr ? Math.round(hr.top + window.scrollY) : null,
        headingX: hr ? Math.round(hr.left) : null,
        survN: sc.length,
        survFirstTop: sc.length ? Math.round(sc[0].getBoundingClientRect().top + window.scrollY) : null,
        survX: sr && sc.length ? Math.round(sc[0].getBoundingClientRect().left) : null,
        freeN: fc.length,
        freeFirstTop: fc.length ? Math.round(fc[0].getBoundingClientRect().top + window.scrollY) : null,
        freeX: fr && fc.length ? Math.round(fc[0].getBoundingClientRect().left) : null,
      });
    }
    return {
      gridChildren: kids.length,
      gridCols: getComputedStyle(grid).gridTemplateColumns,
      rows,
    };
  });
  await page.close();
}
await browser.close();
fs.writeFileSync('/tmp/g12.json', JSON.stringify(out, null, 1));
for (const k of Object.keys(out)) {
  const o = out[k];
  console.log(`\n=== ${k} | children=${o.gridChildren} | cols=${o.gridCols}`);
  console.log(`survival cards: ${o.rows.reduce((a, r) => a + r.survN, 0)} | freedom cards: ${o.rows.reduce((a, r) => a + r.freeN, 0)}`);
  for (const r of o.rows) {
    if (!r.survN && !r.freeN) continue;
    const dS = r.survN ? r.survFirstTop - r.headingTop : null;
    const dF = r.freeN ? r.freeFirstTop - r.headingTop : null;
    console.log(`${r.decade}s ${String(r.heading).padEnd(6)} headT=${r.headingTop} surv=${r.survN}@${r.survFirstTop}(d=${dS},x=${r.survX}) free=${r.freeN}@${r.freeFirstTop}(d=${dF},x=${r.freeX})`);
  }
}
