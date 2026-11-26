import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:4402/timeline/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(700);
let ok=0, bad=[], longest=null;
for (let i=0;i<10;i++){
  const els = await p.$$('[data-rd][data-kind="freedom"]');
  if (!els[i]) break;
  await els[i].scrollIntoViewIfNeeded({timeout:5000});
  await els[i].click({timeout:5000});
  await p.waitForTimeout(120);
  const st = await p.evaluate(() => {
    const w = document.querySelector('#skippy-reader');
    const body = w.querySelector('.rd-body');
    return {title: w.querySelector('.rd-h').textContent.slice(0,40), chars: w.querySelector('.rd-text').textContent.length,
      scrolls: body.scrollHeight > body.clientHeight, bodyH: body.clientHeight,
      winH: Math.round(w.querySelector('.lb-window').getBoundingClientRect().height),
      open: w.classList.contains('is-open')};
  });
  if (st.open) ok++; else bad.push({i,st});
  if (!longest || st.chars > longest.chars) longest = st;
  await p.click('#skippy-reader .lb-close', {timeout:4000}); await p.waitForTimeout(60);
}
console.log('FREEDOM OK=' + ok + ' BAD=' + JSON.stringify(bad));
console.log('LONGEST=' + JSON.stringify(longest));
// night mode
await p.evaluate(() => document.documentElement.setAttribute('data-theme','dark'));
await p.waitForTimeout(200);
const t = await p.$$('[data-rd][data-kind="freedom"]');
await t[0].scrollIntoViewIfNeeded(); await t[0].click(); await p.waitForTimeout(250);
const nm = await p.evaluate(() => {
  const w = document.querySelector('#skippy-reader');
  const win = w.querySelector('.lb-window');
  const body = w.querySelector('.rd-body');
  return {winBg: getComputedStyle(win).backgroundColor, bodyBg: getComputedStyle(body).backgroundColor,
    text: getComputedStyle(w.querySelector('.rd-text')).color,
    bar: getComputedStyle(w.querySelector('.lb-titlebar')).backgroundImage.slice(0,45)};
});
console.log('NIGHT=' + JSON.stringify(nm));
await p.screenshot({ path: '/tmp/rd_night.png' });
await b.close();
