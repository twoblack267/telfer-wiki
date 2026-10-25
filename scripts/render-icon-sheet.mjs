// Render a contact sheet of the nav icon set for visual review.
// Usage: node scripts/render-icon-sheet.mjs [outfile]
import { chromium } from 'playwright';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const iconDir = process.argv[2] || 'src/components/nav-icons';
const outfile = process.argv[3] || '/tmp/icons-final.png';
const INK = '#8A1B3B';
const CREAM = '#faf8f4';

const files = readdirSync(iconDir)
  .filter(f => f.endsWith('.svg') && f !== 'sprite.svg')
  .sort();

const cells = files.map(f => {
  let svg = readFileSync(join(iconDir, f), 'utf8');
  // strip xml decl, force ink + stroke so the sheet reads like the nav does
  svg = svg.replace(/<\?xml[^>]*\?>/g, '')
           .replace(/<svg/, `<svg width="84" height="84" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`);
  const name = f.replace('.svg', '');
  return `<figure><div style="width:84px;height:84px;background:${CREAM};border-radius:8px;display:grid;place-items:center">${svg}</div>
<figcaption>${name}</figcaption></figure>`;
});

const small = files.map(f => {
  let svg = readFileSync(join(iconDir, f), 'utf8');
  svg = svg.replace(/<\?xml[^>]*\?>/g, '')
           .replace(/<svg/, `<svg width="22" height="22" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`);
  return `<span style="background:${CREAM};padding:6px;border-radius:5px;display:inline-grid;place-items:center">${svg}</span>`;
});

const html = `<!doctype html><meta charset="utf-8">
<style>
 body{background:#fff;font:13px/1.3 -apple-system,sans-serif;margin:24px;color:#333}
 h2{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#888;margin:26px 0 10px}
 .grid{display:flex;flex-wrap:wrap;gap:18px}
 figure{margin:0;text-align:center;width:84px}
 figcaption{margin-top:6px;font-size:11px;color:#666;word-break:break-word}
 .row{display:flex;gap:10px;align-items:center}
</style>
<h2>Nav icons — 84px</h2><div class="grid">${cells.join('')}</div>
<h2>At real nav size — 22px</h2><div class="row">${small.join('')}</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 620, height: 400 }, deviceScaleFactor: 2 });
await page.setContent(html);
await page.waitForTimeout(250);
await page.screenshot({ path: outfile, fullPage: true });
await browser.close();
console.log(`${files.length} icons -> ${outfile}`);
