import { chromium } from "playwright";
const b = await chromium.launch();
for (const [nm, W, H] of [["desk", 1400, 1000], ["phone", 390, 900]]) {
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await p.goto("http://127.0.0.1:4402/timeline/", { waitUntil: "networkidle" });
  await p.waitForTimeout(1000);
  const decks = await p.$$("[data-deck]");
  const d = decks[3];
  await d.scrollIntoViewIfNeeded(); await p.waitForTimeout(400);
  const bb = await d.boundingBox();
  // tab heights + card widths of this deck, closed
  const closed = await d.evaluate(el => Array.from(el.querySelectorAll("[data-fcard]")).map(c => {
    const r = c.getBoundingClientRect(); return {w: Math.round(r.width), h: Math.round(r.height)};
  }));
  // trace the push: what sits below the deck and how far does it move
  const belowBefore = await d.evaluate(el => {
    const nxt = el.closest(".tl-card-cell")?.nextElementSibling;
    return nxt ? Math.round(nxt.getBoundingClientRect().top) : null;
  });
  const box = { x: Math.max(0, bb.x - 30), y: Math.max(0, bb.y - 10), width: 420, height: Math.min(760, bb.height + 260) };
  await p.screenshot({ path: `/tmp/X_${nm}_closed.png`, clip: box });
  const tabs = await d.$$("[data-ftab]");
  await tabs[1].click(); await p.waitForTimeout(600);
  const belowAfter = await d.evaluate(el => {
    const nxt = el.closest(".tl-card-cell")?.nextElementSibling;
    return nxt ? Math.round(nxt.getBoundingClientRect().top) : null;
  });
  const bb2 = await d.boundingBox();
  const box2 = { x: Math.max(0, bb2.x - 30), y: Math.max(0, bb2.y - 10), width: 420, height: Math.min(900, bb2.height + 260) };
  await p.screenshot({ path: `/tmp/X_${nm}_open.png`, clip: box2 });
  // does the body text overflow its own box?
  const body = await d.evaluate(el => {
    const o = el.querySelector(".fcard.is-open .fcard-body");
    if (!o) return null;
    const r = o.getBoundingClientRect();
    return { h: Math.round(r.height), scrollH: o.scrollHeight, clipped: o.scrollHeight > r.height + 2};
  });
  console.log(nm, JSON.stringify({closed, deckH_before: Math.round(bb.height), deckH_after: Math.round(bb2.height), belowBefore, belowAfter, push: belowAfter - belowBefore, body}));
  await p.close();
}
await b.close();
