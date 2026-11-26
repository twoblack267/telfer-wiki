import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto('http://localhost:4402/timeline/', { waitUntil: 'networkidle' });
const els = await p.$$('[data-rd]');
const n = els.length;
let ok = 0, bad = [];
for (let i = 0; i < n; i++) {
  const e = els[i];
  try { await e.scrollIntoViewIfNeeded({ timeout: 3000 }); await e.click({ timeout: 3000 }); }
  catch (err) { bad.push({i, why: 'click: ' + err.message.split('\n')[0].slice(0,60)}); continue; }
  await p.waitForTimeout(120);
  const st = await p.evaluate(() => {
    const w = document.querySelector('#skippy-reader');
    const win = w.querySelector('.lb-window');
    const rc = win.getBoundingClientRect();
    const x = w.querySelector('.lb-close').getBoundingClientRect();
    return {
      open: w.classList.contains('is-open'),
      title: w.querySelector('.lb-title').textContent,
      h: w.querySelector('.rd-h').textContent.slice(0, 32),
      chars: w.querySelector('.rd-text').textContent.length,
      onScreen: rc.top >= -1 && rc.left >= -1 && rc.bottom <= window.innerHeight + 1 && rc.right <= window.innerWidth + 1,
      xOk: x.width >= 28 && x.height >= 28 && (rc.right - x.right) <= 12,
      hasSrc: !w.querySelector('.rd-src').hidden,
    };
  });
  if (st.open && st.onScreen && st.xOk) ok++; else bad.push({i, st});
  // close via X
  await p.click('#skippy-reader .lb-close', { timeout: 3000 });
  await p.waitForTimeout(60);
  const cl = await p.evaluate(() => document.querySelector('#skippy-reader').classList.contains('is-open'));
  if (cl) bad.push({i, why: 'did not close'});
}
// Escape closes
await (await p.$$('[data-rd]'))[0].click();
await p.waitForTimeout(100);
await p.keyboard.press('Escape');
await p.waitForTimeout(100);
const escOk = await p.evaluate(() => !document.querySelector('#skippy-reader').classList.contains('is-open'));
// closed-card flush check across all decks
const flush = await p.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  return [...document.querySelectorAll('[data-fcard]')].map(c => Math.round(vw - c.getBoundingClientRect().right));
});
console.log('TOTAL=' + n + ' OK=' + ok + ' ESC=' + escOk + ' FLUSH=' + JSON.stringify([...new Set(flush)]));
console.log('BAD=' + JSON.stringify(bad));
await b.close();
