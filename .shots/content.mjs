import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto('http://localhost:4402/timeline/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(900);
const rows = await p.evaluate(() => {
  return [...document.querySelectorAll('[data-rd]')].map((n, i) => {
    const t = (n.dataset.text || '');
    return {
      i, kind: n.dataset.kind,
      title: (n.dataset.title || '').slice(0, 60),
      slug: n.dataset.slug || '',
      textLen: t.length,
      para: t.split(/\n\n+/).filter(x => x.trim()).length,
      head: t.trim().slice(0, 60).replace(/\s+/g, ' ')
    };
  });
});
console.log('TOTAL=' + rows.length);
const byKind = {};
rows.forEach(r => byKind[r.kind] = (byKind[r.kind] || 0) + 1);
console.log('BY_KIND=' + JSON.stringify(byKind));
const empty = rows.filter(r => r.textLen === 0);
const thin = rows.filter(r => r.textLen > 0 && r.textLen < 60);
const dupes = {};
rows.filter(r => r.textLen > 0).forEach(r => {
  const k = (r.text||"").trim().toLowerCase();
  dupes[k] = (dupes[k] || 0) + 1;
});
console.log('EMPTY=' + empty.length + ' THIN=' + thin.length);
if (empty.length) console.log('EMPTY_SAMPLE=' + JSON.stringify(empty.slice(0,8).map(r => ({i:r.i,kind:r.kind,title:r.title}))));
if (thin.length) console.log('THIN_SAMPLE=' + JSON.stringify(thin.slice(0,8).map(r => ({i:r.i,kind:r.kind,title:r.title,len:r.textLen,head:r.head}))));
const lens = rows.filter(r=>r.textLen>0).map(r=>r.textLen).sort((a,b)=>a-b);
console.log('LEN p05=' + lens[Math.floor(lens.length*0.05)] + ' median=' + lens[Math.floor(lens.length/2)] + ' max=' + lens[lens.length-1]);
// store for next step
await p.evaluate((r) => { window.__rows = r; }, rows);
await b.close();
import('fs').then(fs => fs.writeFileSync('/tmp/rows.json', JSON.stringify(rows)));
