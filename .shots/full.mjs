import { chromium } from "playwright";
const b = await chromium.launch();
for (const [name, w, h] of [["desk", 1400, 1100], ["phone", 390, 1000]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto("http://127.0.0.1:4402/timeline/", { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  await p.evaluate(() => { const e = document.querySelectorAll("[data-deck]")[3]; e && e.scrollIntoView({ block: "center" }); });
  await p.waitForTimeout(500);
  await p.screenshot({ path: `/tmp/F_${name}.png` });
  const m = await p.evaluate(() => {
    const c = document.querySelector(".tl-cell");
    const deck = document.querySelector("[data-deck]");
    const cr = c.getBoundingClientRect(), dr = deck.getBoundingClientRect();
    return { familyW: Math.round(cr.width), familyX: Math.round(cr.x), deckW: Math.round(dr.width),
      deckX: Math.round(dr.x), hscroll: document.documentElement.scrollWidth > window.innerWidth,
      people: document.querySelectorAll('a[href^="/people/"]').length };
  });
  console.log(name, JSON.stringify(m));
  await p.close();
}
await b.close();
