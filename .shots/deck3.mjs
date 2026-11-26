import { chromium } from "playwright";
const browser = await chromium.launch();
for (const [name, w, h] of [["desk", 1400, 1000], ["phone", 390, 900]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto("http://127.0.0.1:4402/timeline/", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const g = await page.evaluate(() => {
    const decks = Array.from(document.querySelectorAll("[data-deck]"));
    // Does every deck live inside the survival cell of ITS OWN decade row?
    const checks = decks.map((dk) => {
      const cardCell = dk.closest(".tl-card-cell");
      const famCell = cardCell?.previousElementSibling;
      const fr = famCell?.getBoundingClientRect();
      const cr = cardCell?.getBoundingClientRect();
      return {
        decade: famCell?.querySelector("h2")?.textContent?.trim(),
        nested: !!cardCell,
        beside: fr && cr ? Math.abs(fr.top - cr.top) < 4 : false,
        famRight: fr ? Math.round(fr.right) : null,
        deckLeft: Math.round(dk.getBoundingClientRect().left),
        clears: fr ? dk.getBoundingClientRect().left >= fr.right - 2 : false,
      };
    });
    const cards = Array.from(document.querySelectorAll("[data-fcard]"));
    const ov = [];
    decks.forEach((d, i) => {
      const cs = Array.from(d.querySelectorAll("[data-fcard]"));
      for (let j = 1; j < cs.length; j++) {
        const a = cs[j - 1].getBoundingClientRect(), b = cs[j].getBoundingClientRect();
        ov.push(Math.round((a.bottom - b.top) * 10) / 10);
      }
    });
    const people = document.querySelectorAll("a[href^='/people/']").length;
    return {
      decks: decks.length, cards: cards.length, people,
      allNested: checks.every((c) => c.nested),
      allBeside: checks.every((c) => c.beside),
      allClear: checks.every((c) => c.clears),
      overlaps: ov,
      sample: checks[0],
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  // tap test
  const tap = await page.evaluate(() => {
    const dk = Array.from(document.querySelectorAll("[data-deck]")).find((d) => d.querySelectorAll("[data-fcard]").length > 1);
    if (!dk) return "none";
    const cs = Array.from(dk.querySelectorAll("[data-fcard]"));
    cs[1].querySelector("[data-ftab]").click();
    return { open: cs.findIndex((c) => !c.querySelector("[data-fbody]").hidden), hidden: cs.map((c) => c.querySelector("[data-fbody]").hidden) };
  });
  await page.evaluate(() => {
    const dk = Array.from(document.querySelectorAll("[data-deck]")).find((d) => d.querySelectorAll("[data-fcard]").length > 1);
    dk?.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/fx_${name}.png` });
  console.log(name, JSON.stringify({ ...g, tap }));
  await page.close();
}
await browser.close();
