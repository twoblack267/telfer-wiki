// Measure the Family table's first-column geometry on the built page.
// Usage: node measure-table.mjs <cssMode: old|new>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const mode = process.argv[2] || 'new';
const pagePath = 'file://' + path.resolve('dist/people/mark-telfer-1986/index.html');

// The OLD (buggy) rules, re-injected to reproduce the bug from the SAME markup.
const OLD_CSS = `
.wiki-content table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; font-size: 0.85rem; }
.wiki-content :not(.table-wrapper) > table {
  display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; white-space: nowrap;
}
`;

(async () => {
  const browser = await chromium.launch({ channel: undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(pagePath, { waitUntil: 'load' });

  if (mode === 'old') {
    await page.addStyleTag({ content: OLD_CSS });
  }

  const data = await page.evaluate(() => {
    const tbl = Array.from(document.querySelectorAll('table')).find(
      (t) => t.textContent.includes('Relation') && t.textContent.includes('Name')
    );
    if (!tbl) return { error: 'Family table not found' };
    const th = tbl.querySelector('thead tr th');
    const tds = Array.from(tbl.querySelectorAll('tbody tr td:first-child')).slice(0, 6);
    const cs = getComputedStyle(tbl);
    const csTh = getComputedStyle(th);
    return {
      tableDisplay: cs.display,
      tableLayout: cs.tableLayout,
      tableWidth: tbl.getBoundingClientRect().width,
      headerText: th.textContent.trim(),
      headerWidth: th.getBoundingClientRect().width,
      headerHeight: th.getBoundingClientRect().height,
      headerWhiteSpace: csTh.whiteSpace,
      headerMinWidth: csTh.minWidth,
      headerClientRects: th.getClientRects().length,
      labelCells: tds.map((td) => ({
        text: td.textContent.trim(),
        w: +td.getBoundingClientRect().width.toFixed(1),
        h: +td.getBoundingClientRect().height.toFixed(1),
        rects: td.getClientRects().length,
      })),
    };
  });

  await browser.close();
  console.log(JSON.stringify({ mode, ...data }, null, 2));
})();
