import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:4402/timeline/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p.goto(url, { waitUntil: 'networkidle' });
// skip past early decks to a real card lower down
const tabs = await p.$$('[data-rd]');
console.log('OPENERS=' + tabs.length);
const geo = await p.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  document.querySelectorAll('[data-deck]').forEach(d => {
    const r = d.getBoundingClientRect();
    out.push({deck: d.dataset.deck, right: Math.round(vw - r.right), width: Math.round(r.width), cards: d.querySelectorAll('[data-fcard]').length});
  });
  const sc = document.querySelector('.tl-card-cell');
  const scr = sc ? sc.getBoundingClientRect() : null;
  const grid = document.querySelector('.tl-grid');
  const gr = grid ? grid.getBoundingClientRect() : null;
  return {vw, gridRight: gr ? Math.round(vw - gr.right) : null, decks: out,
    cardCellRight: scr ? Math.round(vw - scr.right) : null};
});
console.log(JSON.stringify(geo, null, 1));
// pick the COVID tab
const target = await p.$('[data-rd][data-kicker*="2020"]');
if (target) {
  await target.scrollIntoViewIfNeeded();
  await target.click();
  await p.waitForTimeout(250);
  const m = await p.evaluate(() => {
    const w = document.querySelector('#skippy-reader');
    const win = w.querySelector('.lb-window').getBoundingClientRect();
    const x = w.querySelector('.lb-close').getBoundingClientRect();
    const body = w.querySelector('.rd-body');
    return {
      open: w.classList.contains('is-open'),
      title: w.querySelector('.lb-title').textContent,
      head: w.querySelector('.rd-h').textContent,
      win: {w: Math.round(win.width), h: Math.round(win.height), top: Math.round(win.top), left: Math.round(win.left)},
      x: {w: Math.round(x.width), h: Math.round(x.height), rightGap: Math.round(win.right - x.right)},
      bodyScrolls: body.scrollHeight > body.clientHeight,
      bodyScrollH: body.scrollHeight,
      textPx: getComputedStyle(w.querySelector('.rd-text')).fontSize,
      srcPx: getComputedStyle(w.querySelector('.rd-src')).fontSize,
      chars: w.querySelector('.rd-text').textContent.length,
      locked: document.body.classList.contains('lb-locked'),
    };
  });
  console.log(JSON.stringify(m, null, 1));
  await p.screenshot({ path: '/tmp/rd_open.png' });
  // close with the X
  await p.click('#skippy-reader .lb-close');
  await p.waitForTimeout(200);
  const closed = await p.evaluate(() => ({
    open: document.querySelector('#skippy-reader').classList.contains('is-open') || document.querySelector('#skippy-reader').offsetParent !== null,
    locked: document.body.classList.contains('lb-locked'),
  }));
  console.log('AFTER_CLOSE=' + JSON.stringify(closed));
  await p.screenshot({ path: '/tmp/rd_closed.png' });
} else {
  console.log('NO 2020 TAB FOUND');
}
// check every opener opens
const kinds = await p.evaluate(() => {
  const acc = {};
  document.querySelectorAll('[data-rd]').forEach(n => { acc[n.dataset.kind] = (acc[n.dataset.kind]||0)+1; });
  return acc;
});
console.log('KINDS=' + JSON.stringify(kinds));
await b.close();
