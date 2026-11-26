import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p.goto("https://telferwiki.com/timeline/", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(1500);
const out = [];
const decks = await p.$$("[data-deck]");
for (let i=0;i<decks.length;i++){
  const d = decks[i];
  const n = await d.evaluate(el=>el.querySelectorAll("[data-fcard]").length);
  if(n<2) continue;
  await d.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
  const pos = () => d.evaluate(el=>Array.from(el.querySelectorAll("[data-fcard]")).map(c=>Math.round(c.getBoundingClientRect().top)));
  const b4 = await pos();
  const tabs = await d.$$("[data-ftab]");
  await tabs[1].click(); await p.waitForTimeout(500);
  const af = await pos();
  const chk = await d.evaluate(el=>{
    const o = el.querySelector(".fcard.is-open");
    const s = o?.querySelector(".fc-source");
    return { open: !!o, pos: o?getComputedStyle(o).position:null,
      srcPx: s?getComputedStyle(s).fontSize:null,
      anyClip: Array.from(el.querySelectorAll(".ftab-title")).some(t=>t.scrollWidth>t.clientWidth+1) };
  });
  await tabs[1].click(); await p.waitForTimeout(500);
  const closedOk = await d.evaluate(el=>!el.classList.contains("is-leaky") && !el.querySelector(".fcard.is-open"));
  out.push({deck:i, n, movedDown: af.map((v,j)=>v-b4[j]), ...chk, closedOk});
}
console.log("LIVE", JSON.stringify(out,null,1));
await b.close();
