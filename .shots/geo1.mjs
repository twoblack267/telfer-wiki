import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto("http://127.0.0.1:4402/timeline/", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
const geo = await page.evaluate(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width) }; };
  const grid = document.querySelector(".tl-grid");
  const rows = [];
  document.querySelectorAll(".tl-cell").forEach((cell, i) => {
    if (i > 3) return;
    const card = cell.nextElementSibling;
    const deck = card?.nextElementSibling;
    rows.push({
      row: i,
      family: r(cell),
      survival: card ? r(card) : null,
      deck: deck ? r(deck) : null,
      familyText: cell.querySelector("h2")?.textContent?.trim(),
    });
  });
  const leg = Array.from(document.querySelectorAll(".tl-legend > div")).map((d) => ({ t: d.textContent.trim(), ...r(d) }));
  return {
    cols: getComputedStyle(grid).gridTemplateColumns,
    grid: r(grid),
    rows,
    legend: leg,
    vw: window.innerWidth,
    docW: document.documentElement.scrollWidth,
  };
});
console.log(JSON.stringify(geo, null, 1));
await browser.close();
