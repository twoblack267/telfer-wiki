const { chromium } = require('playwright');
const path = require('path');
const pagePath = 'file://' + path.resolve('dist/people/mark-telfer-1986/index.html');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(pagePath, { waitUntil: 'load' });

  const d = await page.evaluate(() => {
    const tbl = Array.from(document.querySelectorAll('table')).find(
      (t) => t.textContent.includes('Relation') && t.textContent.includes('Name')
    );
    if (!tbl) return { error: 'no table' };
    // Walk ancestors to see if a .table-wrapper exists
    let anc = [], el = tbl;
    while (el && el !== document.body) { anc.push(el.tagName + (el.className ? '.' + String(el.className).split(' ').join('.') : '')); el = el.parentElement; }
    // does the :not(.table-wrapper)>table selector match THIS table?
    const matchesRule = tbl.matches('.wiki-content :not(.table-wrapper) > table');
    const cs = getComputedStyle(tbl);
    // count how many stylesheets loaded
    return {
      ancestors: anc,
      matchesRule,
      computedDisplay: cs.display,
      computedWhitespace: cs.whiteSpace,
      inlineDisplay: tbl.style.display,
      sheets: Array.from(document.styleSheets).map((s) => {
        let rules = 0;
        try { rules = s.cssRules ? s.cssRules.length : -1; } catch (e) { rules = 'CORS'; }
        return { href: s.href ? s.href.split('/').pop() : '(inline)', rules };
      }),
    };
  });
  console.log(JSON.stringify(d, null, 2));
  await browser.close();
})();
