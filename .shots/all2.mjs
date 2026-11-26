import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto('http://localhost:4402/timeline/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
const counts = await p.evaluate(() => {
  const a = {};
  document.querySelectorAll('[data-rd]').forEach(n => a[n.dataset.kind] = (a[n.dataset.kind]||0)+1);
  return a;
});
console.log('KINDS=' + JSON.stringify(counts));
// stratified sample: every family opener is same code path, so test a spread across the page
const idx = await p.evaluate(() => {
  const all = [...document.querySelectorAll('[data-rd]')];
  const pick = [];
  const per = {};
  all.forEach((n,i) => { const k = n.dataset.kind; per[k]=(per[k]||0); if (per[k] < 6) { pick.push(i); per[k]++; } });
  pick.push(all.length-1);
  return pick;
});
let ok=0, bad=[];
for (const i of idx) {
  const els = await p.$$('[data-rd]');
  const e = els[i];
  if (!e) { bad.push({i, why:'detached'}); continue; }
  try { await e.scrollIntoViewIfNeeded({timeout:4000}); await e.click({timeout:4000}); } catch(err){ bad.push({i, why:err.message.split('\n')[0].slice(0,50)}); continue; }
  await p.waitForTimeout(90);
  const st = await p.evaluate(() => {
    const w = document.querySelector('#skippy-reader');
    const win = w.querySelector('.lb-window').getBoundingClientRect();
    const x = w.querySelector('.lb-close').getBoundingClientRect();
    return {open: w.classList.contains('is-open'), t: w.querySelector('.lb-title').textContent,
      h: w.querySelector('.rd-h').textContent.slice(0,30), chars: w.querySelector('.rd-text').textContent.length,
      onScreen: win.top>=-1 && win.left>=-1 && win.bottom<=innerHeight+1 && win.right<=innerWidth+1,
      xOk: x.width>=28 && (win.right-x.right)<=12,
      more: !!w.querySelector('.rd-more')};
  });
  if (st.open && st.onScreen && st.xOk) ok++; else bad.push({i, st});
  await p.click('#skippy-reader .lb-close', {timeout:4000});
  await p.waitForTimeout(50);
}
console.log('TESTED=' + idx.length + ' OK=' + ok);
console.log('BAD=' + JSON.stringify(bad).slice(0,600));
await b.close();
