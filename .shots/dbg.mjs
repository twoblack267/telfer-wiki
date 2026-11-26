import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
p.on('pageerror', e => console.log('PAGEERROR: ' + e.message.split('\n')[0]));
p.on('console', m => { if (m.type()==='error') console.log('CONSOLE: ' + m.text().slice(0,200)); });
await p.goto('http://localhost:4402/timeline/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
const st = await p.evaluate(() => ({
  gapVar: getComputedStyle(document.documentElement).getPropertyValue('--wrap-gap'),
  hasReader: !!document.querySelector('#skippy-reader'),
  openers: document.querySelectorAll('[data-rd]').length,
  firstKind: document.querySelector('[data-rd]')?.dataset.kind,
  firstTag: document.querySelector('[data-rd]')?.tagName,
}));
console.log('STATE=' + JSON.stringify(st));
// find a family entry
const fam = await p.$$eval('[data-rd][data-kind="family"]', els => els.slice(0,3).map(e => ({
  title: e.dataset.title, slug: e.dataset.slug, textLen: (e.dataset.text||'').length, h: Math.round(e.getBoundingClientRect().height)
})));
console.log('FAMILY=' + JSON.stringify(fam));
await b.close();
