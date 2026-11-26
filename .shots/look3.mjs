import { chromium } from "playwright";
const b = await chromium.launch();
for (const [name, w, h] of [["desk", 1400, 1000], ["phone", 390, 900]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await p.goto("http://127.0.0.1:4402/timeline/", { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  const deck = await p.$("[data-deck]");
  await deck.scrollIntoViewIfNeeded();
  await p.waitForTimeout(400);
  const bx = await deck.boundingBox();
  console.log(name, "deck", JSON.stringify({x:Math.round(bx.x),y:Math.round(bx.y),w:Math.round(bx.width),h:Math.round(bx.height)}));
  await p.screenshot({ path: `/tmp/D_${name}_deck.png`, clip: { x: Math.max(0,bx.x-30), y: Math.max(0,bx.y-30), width: Math.min(w-(Math.max(0,bx.x-30)), 480), height: bx.height+60 } });
  await p.click("[data-ftab]"); await p.waitForTimeout(600);
  const bx2 = await deck.boundingBox();
  await p.screenshot({ path: `/tmp/D_${name}_tapped.png`, clip: { x: Math.max(0,bx2.x-30), y: Math.max(0,bx2.y-30), width: Math.min(w-(Math.max(0,bx2.x-30)), 480), height: bx2.height+60 } });
  await p.close();
}
await b.close();
