import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p.goto("http://127.0.0.1:4402/timeline/", { waitUntil: "networkidle" });
await p.waitForTimeout(800);
const r = await p.evaluate(() => {
  // every open fcard body: font sizes actually used
  const deck = Array.from(document.querySelectorAll("[data-deck]"))[2];
  deck.querySelectorAll("[data-ftab]")[1].click();
  return new Promise(res=>setTimeout(()=>{
    const card = deck.querySelector(".fcard.is-open");
    const out = {};
    ["\.fc-act",".fc-power",".sc-detail",".fc-source"].forEach(s=>{
      const el = card.querySelector(s);
      if(!el) return;
      const cs = getComputedStyle(el);
      out[s] = { size: cs.fontSize, color: cs.color, opacity: cs.opacity,
                 vis: el.offsetHeight>0 && el.offsetWidth>0,
                 chars: el.textContent.trim().length };
    });
    // does a survival-card carry a source?
    const surv = document.querySelector(".survival-card");
    out.survivalHasSource = !!surv?.querySelector(".fc-source, .sc-source, .fc-src, cite");
    out.survivalHTMLend = surv ? surv.innerHTML.slice(-220) : null;
    res(out);
  },500));
});
console.log(JSON.stringify(r,null,1));
await b.close();
