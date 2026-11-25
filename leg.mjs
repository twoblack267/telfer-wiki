import { chromium } from 'playwright';
const b=await chromium.launch();
for (const w of [1440,390]) {
  const p=await b.newPage({viewport:{width:w,height:900}});
  await p.goto('http://localhost:4402/timeline/',{waitUntil:'load'});
  await p.waitForTimeout(400);
  const r=await p.evaluate(()=>{
    const el=document.querySelector('.tl-legend');
    if(!el) return {found:false};
    const b=el.getBoundingClientRect();
    return {found:true, top:Math.round(b.top+window.scrollY), h:Math.round(b.height),
      labels:[...el.children].map(c=>{const r=c.getBoundingClientRect();return {t:c.textContent.trim(),x:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)}}),
      overflow:[...el.children].map(c=>c.scrollWidth>c.clientWidth+1)};
  });
  console.log(w, JSON.stringify(r));
  await p.close();
}
await b.close();
