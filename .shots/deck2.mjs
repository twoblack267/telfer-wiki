import { chromium } from "playwright";

const browser = await chromium.launch();
for (const [name, w, h] of [["desk", 1400, 1000], ["phone", 390, 900]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto("http://127.0.0.1:4402/timeline/", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  const info = await page.evaluate(() => {
    const deck = Array.from(document.querySelectorAll("[data-fcard]"))
      .find((c) => c.parentElement.querySelectorAll("[data-fcard]").length > 1)
      ?.parentElement;
    if (!deck) return { err: "no multi deck" };
    const cell = deck.closest(".tl-free-cell");
    const cards = Array.from(deck.querySelectorAll("[data-fcard]"));
    deck.scrollIntoView({ block: "center", behavior: "instant" });
    const b = deck.getBoundingClientRect();
    return {
      cardCount: cards.length,
      titles: cards.map((c) => c.querySelector(".ftab-title")?.textContent?.trim()),
      deckBox: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
      cellFound: !!cell,
    };
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `/tmp/dk_${name}.png` });
  console.log(name, JSON.stringify(info));
  await page.close();
}
await browser.close();
