import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 1100 } });
await p.goto('http://localhost:4402/timeline/', { waitUntil: 'networkidle' });
const rows = await p.evaluate(() => {
  const out = [];
  document.querySelectorAll('.tl-cell').forEach(cell => {
    const free = cell.nextElementSibling?.nextElementSibling;
    const titles = [...(free?.querySelectorAll('.sc-title')||[])].map(t => t.innerText);
    if (titles.length) out.push(cell.dataset.decade + 's -> ' + titles.join(' | ') + '  [freecell at y=' + Math.round(free.getBoundingClientRect().y) + ' cell y=' + Math.round(cell.getBoundingClientRect().y) + ']');
  });
  return out;
});
console.log(rows.join('\n'));
await b.close();
