const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 1000 }, deviceScaleFactor: 2 });
  await p.goto('http://127.0.0.1:8099/people/mark-telfer-1986/', { waitUntil: 'load' });
  await p.waitForTimeout(500);
  const el = await p.$('table');
  const box = await el.boundingBox();
  await p.screenshot({ path: '/tmp/livingpriv/after-mobile.png', clip: { x: 0, y: Math.max(0, box.y - 120), width: 390, height: Math.min(760, box.height + 160) } });
  console.log('  saved /tmp/livingpriv/after-mobile.png');
  await b.close();
})();
