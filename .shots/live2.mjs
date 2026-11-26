import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto('http://localhost:4402/timeline/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);

// find a known family opener by title, scroll it into view, click, read window
const target = process.argv[2] || 'George Wright Telfer';
const idx = await p.evaluate((t) => {
  const all = [...document.querySelectorAll('[data-rd]')];
  return all.findIndex(n => (n.dataset.title||'').includes(t));
}, target);
if (idx < 0) { console.log('NOT FOUND'); await b.close(); process.exit(1); }
const el = (await p.$$('[data-rd]'))[idx];
await el.scrollIntoViewIfNeeded();
await p.waitForTimeout(200);
await el.click();
await p.waitForTimeout(500);
const out = await p.evaluate(() => {
  const r = document.querySelector('#skippy-reader');
  if (!r) return { open:false };
  const vis = getComputedStyle(r).display !== 'none' && r.getBoundingClientRect().height > 40;
  const body = r.querySelector('.rd-body');
  return {
    open: vis,
    title: (r.querySelector('.rd-h')||{}).textContent || '',
    text: (body ? body.innerText : '').slice(0, 1500),
    paras: body ? body.querySelectorAll('p').length : 0,
    moreHref: (r.querySelector('.rd-more')||{}).getAttribute ? r.querySelector('.rd-more').getAttribute('href') : null,
    closeVisible: (() => { const c = r.querySelector('.lb-close'); if(!c) return false; const b=c.getBoundingClientRect(); return b.width>20 && b.height>20; })(),
    windowRect: (() => { const w = r.querySelector('.lb-window'); const b=w.getBoundingClientRect(); return {w:Math.round(b.width),h:Math.round(b.height)}; })(),
  };
});
console.log(JSON.stringify(out, null, 1));
await p.screenshot({ path: '/tmp/rd_content.png' });
await b.close();
