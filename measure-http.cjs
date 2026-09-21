const { chromium } = require('playwright');

const URL = 'http://127.0.0.1:8099/people/mark-telfer-1986/';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  console.log('width  | colW   avail  needW  lines | disp       tblWS    | verdict');
  console.log('-------+-----------------------------+------------------+--------');
  for (const w of [1600, 1400, 1280, 1100, 1024, 1000, 900, 800, 768, 700, 640, 600, 560, 520, 480, 430, 414, 390, 360, 320]) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } });
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle').catch(() => {});
    const d = await page.evaluate(() => {
      const tbl = Array.from(document.querySelectorAll('table')).find(
        (t) => t.textContent.includes('Relation') && t.textContent.includes('Name')
      );
      if (!tbl) return { error: 'no table' };
      const th = tbl.querySelector('thead tr th');
      const csT = getComputedStyle(tbl);
      const cs = getComputedStyle(th);
      const r = th.getBoundingClientRect();
      const span = document.createElement('span');
      span.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:' + cs.font;
      span.textContent = 'Relation';
      document.body.appendChild(span);
      const natural = span.getBoundingClientRect().width;
      span.remove();
      const lh = parseFloat(cs.lineHeight) || 17;
      const lines = Math.round(r.height / lh);
      return {
        loadedSheets: document.styleSheets.length,
        disp: csT.display,
        tblWS: csT.whiteSpace,
        colW: +r.width.toFixed(1),
        colH: +r.height.toFixed(1),
        lines,
        natural: +natural.toFixed(1),
        avail: +(r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)).toFixed(1),
        matchesBlockRule: tbl.matches('.wiki-content :not(.table-wrapper) > table'),
      };
    });
    await page.close();
    if (d.error) { console.log(`w=${w} ERROR ${d.error}`); continue; }
    const split = d.avail < d.natural;
    console.log(
      `${String(w).padEnd(6)} | ${String(d.colW).padEnd(6)} ${String(d.avail).padEnd(6)} ${String(d.natural).padEnd(6)} ${String(d.lines).padEnd(5)} | ${String(d.disp).padEnd(10)} ${String(d.tblWS).padEnd(8)} | ${split ? '❌ SPLIT (avail<need)' : '✅ ok'}${d.matchesBlockRule ? ' [block-rule MATCHES]' : ''}`
    );
  }
  await browser.close();
})();
