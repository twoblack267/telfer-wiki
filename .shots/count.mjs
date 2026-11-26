import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
await p.goto("http://127.0.0.1:4402/timeline/",{waitUntil:"networkidle"});
await p.waitForTimeout(800);
const d = await p.evaluate(()=>[...document.querySelectorAll("[data-deck]")].map((x,i)=>({
  deck:i, cards:x.querySelectorAll("[data-fcard]").length, tabs:x.querySelectorAll("[data-ftab]").length,
  y:Math.round(x.getBoundingClientRect().top+scrollY)})));
console.log(JSON.stringify(d));
await b.close();
