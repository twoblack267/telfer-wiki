import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 1100 } });
await p.goto("http://localhost:4402/timeline/", { waitUntil: "networkidle" });
await p.waitForTimeout(600);
const el = await p.$(".freedom-card.tone-sage");
await el.scrollIntoViewIfNeeded();
await p.evaluate(() => window.scrollBy(0, -260));
await p.waitForTimeout(400);
await p.screenshot({ path: "/tmp/phone_ctx.png" });
const gap = await p.evaluate(() => {
  const c = document.querySelector(".freedom-card.tone-sage");
  const cell = c.parentElement;
  const head = cell.closest(".tl-row")?.querySelector(".tl-decade, h2, h3");
  return { cellH: cell.getBoundingClientRect().height, headText: head ? head.textContent.trim() : null,
           cols: getComputedStyle(cell.parentElement).gridTemplateColumns };
});
console.log(JSON.stringify(gap));
await b.close();
