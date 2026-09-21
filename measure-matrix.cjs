// Measure the Family table first-column geometry across viewports and CSS modes.
const { chromium } = require('playwright');
const path = require('path');

const pagePath = 'file://' + path.resolve('dist/people/mark-telfer-1986/index.html');

const OLD_CSS = `
.wiki-content table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; font-size: 0.85rem; }
.wiki-content :not(.table-wrapper) > table {
  display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; white-space: nowrap;
}
`;

const VIEWPORTS = [
  { name: 'desktop-1280', width: 1280 },
  { name: 'laptop-1024', width: 1024 },
  { name: 'tablet-768', width: 768 },
  { name: 'phone-390', width: 390 },
  { name: 'phone-narrow-320', width: 320 },
];

async function probe(browser, mode, vp) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: 900 } });
  await page.goto(pagePath, { waitUntil: 'load' });
  if (mode === 'old') await page.addStyleTag({ content: OLD_CSS });

  const data = await page.evaluate(() => {
    const tbl = Array.from(document.querySelectorAll('table')).find(
      (t) => t.textContent.includes('Relation') && t.textContent.includes('Name')
    );
    if (!tbl) return { error: 'table not found' };
    const th = tbl.querySelector('thead tr th');
    const cs = getComputedStyle(tbl);
    const csTh = getComputedStyle(th);
    const labelTds = Array.from(tbl.querySelectorAll('tbody tr td:first-child')).slice(0, 7);
    // A mid-word split shows up as >1 line box in a nowrap-short label,
    // or a label whose height is a multiple of the line-height.
    const anySplit = labelTds.some((td) => {
      const r = td.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(td).lineHeight) || 17;
      return r.height > lh * 1.6;
    });
    return {
      tableDisplay: cs.display,
      tableW: +tbl.getBoundingClientRect().width.toFixed(1),
      docScrollW: document.documentElement.scrollWidth,
      viewportW: window.innerWidth,
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      thText: th.textContent.trim(),
      thW: +th.getBoundingClientRect().width.toFixed(1),
      thH: +th.getBoundingClientRect().height.toFixed(1),
      thWS: csTh.whiteSpace,
      thMinW: csTh.minWidth,
      labelsH: labelTds.map((td) => +(td.getBoundingClientRect().height.toFixed(1))),
      labelsW: labelTds.map((td) => +(td.getBoundingClientRect().width.toFixed(1))),
      anyLabelWrapped: anySplit,
    };
  });
  await page.close();
  return data;
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const rows = [];
  for (const mode of ['old', 'new']) {
    for (const vp of VIEWPORTS) {
      const d = await probe(browser, mode, vp);
      rows.push({ mode, vp: vp.name, ...d });
    }
  }
  await browser.close();
  for (const r of rows) {
    const flag = r.anyLabelWrapped ? ' ❌MIDWORD-SPLIT' : '';
    const ovf = r.overflowX ? ' ⚠H-OVERFLOW' : '';
    console.log(
      `${r.mode.padEnd(3)} ${r.vp.padEnd(15)} disp=${String(r.tableDisplay).padEnd(10)} thW=${String(r.thW).padEnd(7)} thH=${String(r.thH).padEnd(5)} minW=${String(r.thMinW).padEnd(6)} thWS=${String(r.thWS).padEnd(7)} labelsH=${JSON.stringify(r.labelsH)}${flag}${ovf}`
    );
  }
})();
