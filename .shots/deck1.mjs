import { chromium } from "playwright";

const URL = "http://127.0.0.1:4402/timeline/";
const browser = await chromium.launch();
const out = [];

for (const [name, w, h] of [["desk", 1400, 1000], ["phone", 390, 900]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  const m = await page.evaluate(() => {
    const grid = document.querySelector(".tl-grid");
    const cs = grid ? getComputedStyle(grid).gridTemplateColumns : "";
    const cells = Array.from(document.querySelectorAll(".tl-cell")).slice(0, 2);
    const decks = Array.from(document.querySelectorAll("[data-deck]"));
    const cards = Array.from(document.querySelectorAll("[data-fcard]"));
    // overlap: card X top sits above (smaller y) the previous card's bottom
    const overlaps = [];
    decks.forEach((d, di) => {
      const cds = Array.from(d.querySelectorAll("[data-fcard]"));
      for (let i = 1; i < cds.length; i++) {
        const a = cds[i - 1].getBoundingClientRect();
        const b = cds[i].getBoundingClientRect();
        overlaps.push({ deck: di, i, overlapPx: Math.round((a.bottom - b.top) * 10) / 10 });
      }
    });
    // does the deck sit to the RIGHT of the family cell, never over it?
    const r = [];
    document.querySelectorAll(".tl-cell").forEach((cell, i) => {
      const deck = cell.nextElementSibling?.querySelector?.("[data-deck]");
      if (!deck) return;
      const c = cell.getBoundingClientRect();
      const d = deck.getBoundingClientRect();
      r.push({ row: i, cellRight: Math.round(c.right), deckLeft: Math.round(d.left), clears: d.left >= c.right - 1 });
    });
    const sizes = cards.slice(0, 4).map((c) => {
      const b = c.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height) };
    });
    const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    const firstTitle = document.querySelector(".tl-cell .sc-title, .tl-cell h2")?.textContent?.trim()?.slice(0, 60);
    return { cs, cellCount: cells.length, decks: decks.length, cards: cards.length, overlaps, clears: r, sizes, overflow, firstTitle, peopleVisible: !!document.querySelector("a[href^='/people/']") && document.querySelectorAll("a[href^='/people/']").length };
  });

  // tap the 2nd card's tab in the first multi-card deck and re-measure
  const tapped = await page.evaluate(() => {
    const deck = Array.from(document.querySelectorAll("[data-deck]")).find((d) => d.querySelectorAll("[data-fcard]").length > 1);
    if (!deck) return "no multi deck";
    const cds = Array.from(deck.querySelectorAll("[data-fcard]"));
    const before = cds.map((c) => c.querySelector("[data-fbody]")?.hidden);
    cds[1].querySelector("[data-ftab]").click();
    const after = cds.map((c) => c.querySelector("[data-fbody]")?.hidden);
    return { before, after, openIdx: cds.findIndex((c) => !c.querySelector("[data-fbody]").hidden) };
  });

  await page.screenshot({ path: `/tmp/deck_${name}_top.png` });
  await page.evaluate(() => document.querySelector("[data-deck]")?.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `/tmp/deck_${name}_deck.png` });

  out.push({ name, errors, ...m, tapped });
  await page.close();
}

await browser.close();
console.log(JSON.stringify(out, null, 1));
