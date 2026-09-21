// Measure the Family table across viewports using ONLY the page's real stylesheet.
// No CSS injection — this measures whatever is actually built.
const { chromium } = require('playwright');
const path = require('path');

const pagePath = 'file://' + path.resolve('dist/people/mark-telfer-1986/index.html');

const VIEWPORTS = [
  { name: 'desktop-1280', width: 1280 },
  { name: 'tablet-768', width: 768 },
  { name: 'phone-390', width: 390 },
  { name: 'phone-320', width: 320 },
  { name: 'phone-280', width: 280 },
];

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: 900 } });
    await page.goto(pagePath, { waitUntil: 'load' });
    const d = await page.evaluate(() => {
      const tbl = Array.from(document.querySelectorAll('table')).find(
        (t) => t.textContent.includes('Relation') && t.textContent.includes('Name')
      );
      if (!tbl) return { error: 'table not found' };
      const cs = getComputedStyle(tbl);
      const th = tbl.querySelector('thead tr th');
      const csTh = getComputedStyle(th);
      const tds = Array.from(tbl.querySelectorAll('tbody tr td:first-child')).slice(0, 7);
      // count LINE BOXES per cell — that is what reveals a mid-word split
      const lineBoxes = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        // client rects of the text node splits at line breaks
        return Array.from(range.getClientRects()).length;
      };
      const thLines = lineBoxes(th);
      return {
        tableDisplay: cs.display,
        tableWS: cs.whiteSpace,
        tableW: +tbl.getBoundingClientRect().width.toFixed(1),
        vpW: window.innerWidth,
        docScrollW: document.documentElement.scrollWidth,
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
        thText: th.textContent.trim(),
        thW: +th.getBoundingClientRect().width.toFixed(1),
        thH: +th.getBoundingClientRect().height.toFixed(1),
        thWS: csTh.whiteSpace,
        thWordBreak: csTh.wordBreak,
        thMinW: csTh.minWidth,
        thLineBoxes: thLines,
        labelLines: tds.map((td) => ({
          t: td.textContent.trim(),
          lb: lineBoxes(td),
          w: +td.getBoundingClientRect().width.toFixed(1),
        })),
      };
    });
    await page.close();
    const split = d.thLineBoxes > 1 || d.labelLines.some((l) => l.lb > 1);
    console.log(
      `${vp.name.padEnd(13)} disp=${String(d.tableDisplay).padEnd(7)} tblWS=${String(d.tableWS).padEnd(8)} thW=${String(d.thW).padEnd(7)} thLineBoxes=${String(d.thLineBoxes).padEnd(3)} thWS=${String(d.thWS).padEnd(7)} wordBreak=${String(d.thWordBreak).padEnd(9)} minW=${String(d.thMinW).padEnd(6)} ${split ? '❌SPLIT' : '✅ok'}${d.overflowX ? ' ⚠H-OVERFLOW' : ''}`
    );
    console.log(`              labels: ${d.labelLines.map((l) => `${l.t}=${l.lb}lb`).join('  ')}`);
  }
  await browser.close();
})();
