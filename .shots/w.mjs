import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
await p.goto("http://127.0.0.1:4402/timeline/",{waitUntil:"networkidle"});
await p.waitForTimeout(700);
const deck = (await p.$$("[data-deck]"))[0];
await (await deck.$$("[data-ftab]"))[0].click();
await p.waitForTimeout(500);
console.log(JSON.stringify(await deck.evaluate(d=>{
  const o=d.querySelector(".fcard.is-open"); const cs=getComputedStyle(o); const r=o.getBoundingClientRect();
  const dr=d.getBoundingClientRect();
  return {width:cs.width, maxW:cs.maxWidth, minW:cs.minWidth, left:cs.left, right:cs.right,
    pos:cs.position, box:cs.boxSizing, border:cs.borderLeftWidth, padding:cs.paddingLeft,
    rectL:Math.round(r.left), rectW:Math.round(r.width), deckR:Math.round(dr.right),
    openRightVar:cs.getPropertyValue("--open-right")||d.style.getPropertyValue("--open-right"),
    innerW:innerWidth, scrollW:document.documentElement.scrollWidth};
}),null,1));
await b.close();
