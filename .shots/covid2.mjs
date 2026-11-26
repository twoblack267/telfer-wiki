import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:390,height:900}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
await p.goto('http://localhost:4402/timeline/', { waitUntil:'networkidle' });
const idx = await p.evaluate(() => [...document.querySelectorAll('[data-fcard]')].findIndex(c=>c.textContent.includes('not asked')));
const info = await p.evaluate((i)=>{const cards=[...document.querySelectorAll('[data-fcard]')];const c=cards[i];const deck=c.closest('[data-deck]');return {deckIdx:[...document.querySelectorAll('[data-deck]')].indexOf(deck),cardInDeck:[...deck.querySelectorAll('[data-fcard]')].indexOf(c)};}, idx);
await p.evaluate(({d,k})=>{const deck=document.querySelectorAll('[data-deck]')[d];deck.querySelectorAll('[data-ftab]')[k].click();},{d:info.deckIdx,k:info.cardInDeck});
await p.waitForTimeout(500);
const y = await p.evaluate(({d,k})=>{const deck=document.querySelectorAll('[data-deck]')[d];const c=deck.querySelectorAll('[data-fcard]')[k];return c.getBoundingClientRect().top+scrollY;},{d:info.deckIdx,k:info.cardInDeck});
await p.evaluate(y=>scrollTo(0,y-120), y);
await p.waitForTimeout(400);
await p.screenshot({ path:'/tmp/covid_where.png' });
// measure font + source line box
const m = await p.evaluate(({d,k})=>{
  const deck=document.querySelectorAll('[data-deck]')[d];const c=deck.querySelectorAll('[data-fcard]')[k];
  const det=c.querySelector('.sc-detail'); const src=c.querySelector('.fc-source')||c.querySelector('.sc-source');
  const r=c.getBoundingClientRect(); const sr=src?src.getBoundingClientRect():null;
  return { detailPx: det?getComputedStyle(det).fontSize:'n/a', srcPx: src?getComputedStyle(src).fontSize:'n/a',
    cardRight:Math.round(r.right), srcRight: sr?Math.round(sr.right):null, srcOverflow: src? src.scrollWidth>src.clientWidth+2 : null,
    srcBottom: sr?Math.round(sr.bottom):null, cardBottom:Math.round(r.bottom) };
},{d:info.deckIdx,k:info.cardInDeck});
console.log(JSON.stringify(m));
await b.close();
