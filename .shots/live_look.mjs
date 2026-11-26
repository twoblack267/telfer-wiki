import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
await p.goto("https://telferwiki.com/timeline/?cb=final2", { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
const st = await p.evaluate(() => {
  const all = Array.from(document.querySelectorAll("[data-fcard]"));
  const open = all.filter(c => !c.querySelector("[data-fbody]").hidden);
  const c0 = all.find(c => c.closest("[data-deck]")?.querySelectorAll("[data-fcard]").length > 2) || all[0];
  const r = c0.getBoundingClientRect(), t = c0.querySelector("[data-ftab]").getBoundingClientRect();
  return { total: all.length, openNow: open.length,
    w: Math.round(r.width), h: Math.round(r.height), tabH: Math.round(t.height) };
});
console.log("PROD", JSON.stringify(st));
const dk = (await p.$$("[data-deck]"))[3];
await dk.scrollIntoViewIfNeeded(); await p.waitForTimeout(500);
let bx = await dk.boundingBox();
await p.screenshot({ path: "/tmp/P_deck.png", clip: { x: Math.max(0,bx.x-20), y: Math.max(0,bx.y-20), width: 400, height: Math.min(700, bx.height+40) } });
await (await dk.$("[data-ftab]")).click(); await p.waitForTimeout(700);
bx = await dk.boundingBox();
await p.screenshot({ path: "/tmp/P_tapped.png", clip: { x: Math.max(0,bx.x-20), y: Math.max(0,bx.y-20), width: 400, height: Math.min(760, bx.height+40) } });
await b.close();
