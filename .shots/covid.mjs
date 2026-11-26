import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:390,height:900}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
await p.goto('http://localhost:4402/timeline/', { waitUntil:'networkidle' });
const card = await p.$('.survival-card, .freedom-card[data-ftab]');
// find the covid card by its title
const idx = await p.evaluate(() => {
  const cs=[...document.querySelectorAll('[data-fcard]')];
  return cs.findIndex(c=>c.textContent.includes('not asked'));
});
console.log('covid card index:', idx);
if (idx < 0) { await b.close(); process.exit(1); }
const sel = `[data-fcard]:nth-of-type(${idx+1})`;
// get deck + tab handles by evaluating
const info = await p.evaluate((i) => {
  const cards=[...document.querySelectorAll('[data-fcard]')];
  const c=cards[i];
  const deck=c.closest('[data-deck]');
  const tab=c.querySelector('[data-ftab]');
  const dcardIdx=[...deck.querySelectorAll('[data-fcard]')].indexOf(c);
  return { deckIdx:[...document.querySelectorAll('[data-deck]')].indexOf(deck), cardInDeck:dcardIdx, deckCount:deck.querySelectorAll('[data-fcard]').length, closedW:c.getBoundingClientRect().width, closedH:c.getBoundingClientRect().height };
}, idx);
console.log(JSON.stringify(info));
await p.evaluate(({d,k}) => {
  const deck=document.querySelectorAll('[data-deck]')[d];
  deck.querySelectorAll('[data-ftab]')[k].click();
}, {d:info.deckIdx,k:info.cardInDeck});
await p.waitForTimeout(400);
const open = await p.evaluate(({d,k}) => {
  const deck=document.querySelectorAll('[data-deck]')[d];
  const c=deck.querySelectorAll('[data-fcard]')[k];
  const r=c.getBoundingClientRect();
  const body=c.querySelector('[data-fbody]');
  const src=c.querySelector('.fc-source');
  const cardScroll=c.scrollHeight, cardClient=c.clientHeight;
  return { openW:Math.round(r.width), left:Math.round(r.left), right:Math.round(r.right), top:Math.round(r.top),
    docW:document.documentElement.scrollWidth, vw:innerWidth,
    anyClip: cardScroll>cardClient+2, bodyClip: body? body.scrollHeight>body.clientHeight+2 : null,
    srcText: src? src.textContent.trim().slice(0,70) : 'NO SOURCE',
    detailLen: body? body.textContent.trim().length : 0,
    isOpen: c.classList.contains('is-open') };
}, {d:info.deckIdx,k:info.cardInDeck});
console.log('OPEN:', JSON.stringify(open));
await p.screenshot({ path:'/tmp/covid_open.png' });
// close again
await p.evaluate(({d,k}) => {
  const deck=document.querySelectorAll('[data-deck]')[d];
  deck.querySelectorAll('[data-ftab]')[k].click();
}, {d:info.deckIdx,k:info.cardInDeck});
await p.waitForTimeout(300);
const closed = await p.evaluate(({d,k}) => {
  const deck=document.querySelectorAll('[data-deck]')[d];
  const c=deck.querySelectorAll('[data-fcard]')[k];
  return { isOpen:c.classList.contains('is-open'), h:Math.round(c.getBoundingClientRect().height) };
}, {d:info.deckIdx,k:info.cardInDeck});
console.log('CLOSED AGAIN:', JSON.stringify(closed));
await p.screenshot({ path:'/tmp/covid_closed.png' });
await b.close();
