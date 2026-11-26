import { chromium } from "playwright";
const b = await chromium.launch();
for (const [nm,W,H] of [["phone",390,844],["desk",1400,1000]]) {
  const p = await b.newPage({ viewport:{width:W,height:H}, deviceScaleFactor:2 });
  await p.goto("http://127.0.0.1:4402/timeline/",{waitUntil:"networkidle"});
  await p.waitForTimeout(700);
  const decks = await p.$$("[data-deck]");
  for (let di=0; di<decks.length; di++){
    const tabs = await decks[di].$$("[data-ftab]");
    if (!tabs.length) continue;
    const before = await decks[di].evaluate(d=>[...d.querySelectorAll("[data-fcard]")].map(c=>{const r=c.getBoundingClientRect();return {l:Math.round(r.left),r:Math.round(r.right)}}));
    await tabs[0].click(); await p.waitForTimeout(500);
    const info = await decks[di].evaluate(d=>{
      const o=d.querySelector(".fcard.is-open");  if(!o) return null;
      const r=o.getBoundingClientRect();
      const fam=[...document.querySelectorAll("[data-tl-card], .tl-card-cell, .tl-ev")].filter(e=>{
        const q=e.getBoundingClientRect(); return q.top<r.bottom && q.bottom>r.top && q.left<r.right && q.right>r.left;
      }).length;
      return {left:Math.round(r.left), right:Math.round(r.right), w:Math.round(r.width),
              offLeft: r.left < 0, offRight: r.right > innerWidth, famOverlapped: fam,
              srcPx: (()=>{const s=o.querySelector(".fc-source");return s?parseFloat(getComputedStyle(s).fontSize):null})()};
    });
    await tabs[0].click(); await p.waitForTimeout(400);
    const closed = await decks[di].evaluate(d=>!d.querySelector(".fcard.is-open"));
    console.log(nm,"deck"+di,"open="+JSON.stringify(info),"closed="+closed);
    if (di===0) console.log("   tabEdges before:",JSON.stringify(before[0]));
  }
  await p.close();
}
await b.close();
