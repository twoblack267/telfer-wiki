import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
await p.goto("http://127.0.0.1:4402/timeline/", { waitUntil: "networkidle" });
await p.waitForTimeout(900);
const decks = await p.evaluate(() => Array.from(document.querySelectorAll("[data-deck]")).map((d, i) => {
  const cards = d.querySelectorAll("[data-fcard]");
  const r = d.getBoundingClientRect();
  return { i, key: d.dataset.deck, n: cards.length, h: Math.round(r.height),
    decade: d.closest(".tl-card-cell")?.previousElementSibling?.querySelector("h2")?.textContent?.trim() || "?" };
}));
console.log(JSON.stringify(decks));
const big = decks.filter(d => d.n > 1).pop() || decks.pop();
const dk = (await p.$$("[data-deck]"))[big.i];
await dk.scrollIntoViewIfNeeded(); await p.waitForTimeout(400);
let bx = await dk.boundingBox();
await p.screenshot({ path: "/tmp/E_deck_closed.png", clip: { x: Math.max(0,bx.x-20), y: Math.max(0,bx.y-20), width: 400, height: Math.min(700, bx.height+40) } });
await (await dk.$("[data-ftab]")).click(); await p.waitForTimeout(600);
bx = await dk.boundingBox();
await p.screenshot({ path: "/tmp/E_deck_tapped.png", clip: { x: Math.max(0,bx.x-20), y: Math.max(0,bx.y-20), width: 400, height: Math.min(760, bx.height+40) } });
console.log("SHOT_DECADE", big.decade, "n", big.n);
await b.close();
