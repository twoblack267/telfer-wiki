const { chromium } = require('playwright');
const path = require('path');
const pagePath = 'file://' + path.resolve('dist/people/mark-telfer-1986/index.html');

// Is the label ACTUALLY split mid-word? A real mid-word break shows as the
// text occupying >1 line box with nowrap, or the rendered glyph run being
// taller than one line while the word is shorter than the column.
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  for (const w of [1600, 1400, 1280, 1100, 1024, 1000, 900, 800, 768, 700, 640, 600, 560, 520, 480, 430, 414, 390, 360, 320]) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } });
    await page.goto(pagePath, { waitUntil: 'load' });
    const d = await page.evaluate(() => {
      const tbl = Array.from(document.querySelectorAll('table')).find(
        (t) => t.textContent.includes('Relation') && t.textContent.includes('Name')
      );
      if (!tbl) return { error: 'no table' };
      const th = tbl.querySelector('thead tr th');
      const cs = getComputedStyle(th);
      const r = th.getBoundingClientRect();
      // Per-word measurement: measure "Relation" rendered inside the th
      const span = document.createElement('span');
      span.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:' + getComputedStyle(th).font;
      span.textContent = 'Relation';
      document.body.appendChild(span);
      const natural = span.getBoundingClientRect().width;
      span.remove();
      const lh = parseFloat(cs.lineHeight) || 17;
      const lines = Math.round(r.height / lh);
      return {
        colW: +r.width.toFixed(1),
        colH: +r.height.toFixed(1),
        lines,
        naturalTextW: +natural.toFixed(1),
        padL: cs.paddingLeft, padR: cs.paddingRight,
        available: +(r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)).toFixed(1),
      };
    });
    await page.close();
    const tight = d.available < d.naturalTextW;
    const split = tight || d.lines > 1;
    console.log(
      `w=${String(w).padEnd(5)} colW=${String(d.colW).padEnd(7)} avail=${String(d.available).padEnd(7)} needW=${String(d.naturalTextW).padEnd(6)} lines=${d.lines} ${split ? '❌ SPLIT' : '✅ ok'}`
    );
  }
  await browser.close();
})();
