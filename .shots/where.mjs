import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:4402/timeline/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
const info = await p.evaluate(() => {
  const d = [...document.querySelectorAll('[data-deck]')].map((el,i) => {
    const r = el.getBoundingClientRect();
    return {i, top: Math.round(r.top + scrollY), w: Math.round(r.width), right: Math.round(r.right), cards: el.querySelectorAll('[data-fcard]').length};
  });
  return {decks: d, vw: innerWidth};
});
console.log(JSON.stringify(info));
// scroll to the biggest deck and shoot it
await p.evaluate((t) => window.scrollTo(0, t - 220), info.decks[info.decks.length-1].top);
await p.waitForTimeout(400);
await p.screenshot({ path: '/tmp/rd_deck.png' });
await b.close();
