import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p.goto("http://127.0.0.1:4402/timeline/", { waitUntil: "networkidle" });
await p.waitForTimeout(800);
const r = await p.evaluate(() => {
  const deck = Array.from(document.querySelectorAll("[data-deck]"))[2];
  const cards = Array.from(deck.querySelectorAll("[data-fcard]"));
  const pos = () => cards.map(c => Math.round(c.getBoundingClientRect().top));
  const before = pos();
  const tab = cards[1].querySelector("[data-ftab]");
  tab.click();
  return new Promise(res => setTimeout(() => {
    const card = cards[1];
    const src = card.querySelector(".fc-source");
    res({ before, after: pos(), leaky: deck.className,
      deckH: Math.round(deck.getBoundingClientRect().height),
      openPos: getComputedStyle(card).position,
      srcText: src ? src.textContent.trim().slice(0,70) : "NO-SRC-EL",
      srcFits: src ? src.scrollHeight <= src.getBoundingClientRect().height+2 : null,
      srcStyle: src ? getComputedStyle(src).fontSize : null,
      actText: card.querySelector(".fc-act")?.textContent.trim().slice(0,40) });
  }, 500));
});
console.log(JSON.stringify(r, null, 1));
await b.close();
