const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8099/people/mark-telfer-1986/';

// Ground truth: render the label cell and count the REAL wrapped lines using
// Range.getClientRects() over the text node itself (excluding padding boxes).
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  for (const w of [1280, 390, 320]) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } });
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const out = await page.evaluate(() => {
      const tbl = Array.from(document.querySelectorAll('table')).find((t) =>
        t.textContent.includes('Relation')
      );
      const cells = Array.from(tbl.querySelectorAll('thead th:first-child, tbody td:first-child'));
      return cells.map((c) => {
        // walk text nodes, measure each range's rects
        let lineCount = 0;
        const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
          if (!n.textContent.trim()) continue;
          const r = document.createRange();
          r.selectNodeContents(n);
          lineCount += r.getClientRects().length;
        }
        return { text: c.textContent.trim(), textLines: lineCount, h: +c.getBoundingClientRect().height.toFixed(1) };
      });
    });
    console.log(`\n  ── viewport ${w}px ──`);
    for (const c of out) {
      console.log(`    ${String(c.text).padEnd(14)} textLines=${String(c.textLines).padEnd(3)} cellH=${c.h}  ${c.textLines > 1 ? '❌ SPLIT' : '✅ one line'}`);
    }
    await page.close();
  }
  await browser.close();
})();
