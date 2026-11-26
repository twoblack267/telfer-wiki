import { chromium } from 'playwright';
const b = await chromium.launch();
// phone: closed state showing flush tabs + family line
const p1 = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p1.goto('http://localhost:4402/timeline/', { waitUntil: 'domcontentloaded' });
await p1.waitForTimeout(800);
const deck = await p1.$('[data-deck]');
await deck.scrollIntoViewIfNeeded();
await p1.evaluate(() => window.scrollBy(0, -140));
await p1.waitForTimeout(200);
await p1.screenshot({ path: '/tmp/rd_page.png' });
console.log('page shot');
await p1.close();
// desktop open window
const p2 = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p2.goto('http://localhost:4402/timeline/', { waitUntil: 'domcontentloaded' });
await p2.waitForTimeout(800);
const ts = await p2.$$('[data-rd][data-kind="freedom"]');
await ts[0].scrollIntoViewIfNeeded(); await ts[0].click(); await p2.waitForTimeout(300);
await p2.screenshot({ path: '/tmp/rd_desk_open.png' });
// family page link works
const href = await p2.evaluate(() => document.querySelector('#skippy-reader .rd-more')?.href || null);
console.log('MORE_HREF=' + href);
await b.close();
