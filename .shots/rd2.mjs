import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:4402/timeline/', { waitUntil: 'networkidle' });
const t = await p.$('[data-rd][data-kicker*="2020"][data-kind="freedom"]') || await p.$('[data-rd][data-kind="freedom"]');
await t.scrollIntoViewIfNeeded();
await t.click();
await p.waitForTimeout(300);
const m = await p.evaluate(() => {
  const w = document.querySelector('#skippy-reader');
  const win = w.querySelector('.lb-window').getBoundingClientRect();
  const tb = w.querySelector('.lb-titlebar').getBoundingClientRect();
  const x = w.querySelector('.lb-close').getBoundingClientRect();
  const body = w.querySelector('.rd-body');
  return {winW: Math.round(win.width), winH: Math.round(win.height),
    titlebarH: Math.round(tb.height), titlebarBg: getComputedStyle(w.querySelector('.lb-titlebar')).backgroundImage.slice(0,60),
    xW: Math.round(x.width), xH: Math.round(x.height), xRightGap: Math.round(win.right - x.right),
    bodyClientH: body.clientHeight, bodyScrollH: body.scrollHeight, scrolls: body.scrollHeight > body.clientHeight,
    chars: w.querySelector('.rd-text').textContent.length,
    allFilled: {k: !w.querySelector('.rd-kicker').hidden, h: !w.querySelector('.rd-h').hidden, l: !w.querySelector('.rd-lede').hidden, p: !w.querySelector('.rd-power').hidden, s: !w.querySelector('.rd-src').hidden}};
});
console.log(JSON.stringify(m, null, 1));
await p.screenshot({ path: '/tmp/rd_win.png' });
await b.close();
