import { chromium } from 'playwright';
const b = await chromium.launch();
for (const vp of [{w:1440,h:900,n:'desk'},{w:820,h:1180,n:'tab'}]) {
  const p = await b.newPage({ viewport: { width: vp.w, height: vp.h } });
  await p.goto('http://localhost:4402/timeline/', { waitUntil: 'networkidle' });
  const flush = await p.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...new Set([...document.querySelectorAll('[data-fcard]')].map(c => Math.round(vw - c.getBoundingClientRect().right)))];
  });
  const t = await p.$('[data-rd][data-kind="family"]');
  await t.scrollIntoViewIfNeeded(); await t.click(); await p.waitForTimeout(200);
  const m = await p.evaluate(() => {
    const w = document.querySelector('#skippy-reader');
    const win = w.querySelector('.lb-window').getBoundingClientRect();
    return {open: w.classList.contains('is-open'), title: w.querySelector('.lb-title').textContent,
      h: w.querySelector('.rd-h').textContent, winW: Math.round(win.width), winH: Math.round(win.height),
      onScreen: win.top >= -1 && win.bottom <= innerHeight + 1,
      more: !!w.querySelector('.rd-more'), moreHref: w.querySelector('.rd-more')?.getAttribute('href')};
  });
  console.log(vp.n + ' FLUSH=' + JSON.stringify(flush) + ' ' + JSON.stringify(m));
  await p.screenshot({ path: '/tmp/rd_' + vp.n + '.png' });
  await p.close();
}
await b.close();
