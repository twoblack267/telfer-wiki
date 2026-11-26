import { chromium } from "playwright";
const b = await chromium.launch();
for (const [nm, W, H] of [["desk", 1400, 1000], ["phone", 390, 900]]) {
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await p.goto("http://127.0.0.1:4402/timeline/", { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  // 1. CLIPPING: does any tab's text get cut?
  const clip = await p.evaluate(() => Array.from(document.querySelectorAll("[data-ftab]")).map((t, i) => {
    const title = t.querySelector(".ftab-title");
    return { i, clipped: title.scrollWidth > title.clientWidth + 1, txt: title.textContent.trim().slice(0, 28) };
  }).filter(x => x.clipped));
  // 2. PUSH: does opening move the family text below the deck?
  const posBefore = await p.evaluate(() => {
    const decks = Array.from(document.querySelectorAll("[data-deck]"));
    const d = decks[3];
    return { deckBottom: Math.round(d.getBoundingClientRect().bottom) };
  });
  const tabs = await p.$$("[data-ftab]");
  await tabs[6].scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
  const before = await p.evaluate(() => {
    const t = document.querySelectorAll("[data-ftab]");
    return Math.round(t[t.length-1].getBoundingClientRect().bottom);
  });
  await tabs[6].click(); await p.waitForTimeout(500);
  const after = await p.evaluate(() => {
    const t = document.querySelectorAll("[data-ftab]");
    return Math.round(t[t.length-1].getBoundingClientRect().bottom);
  });
  // 3. CLOSE: re-tap same tab, must shut
  const openNow = await p.evaluate(() => document.querySelectorAll('[aria-expanded="true"]').length);
  await tabs[6].click(); await p.waitForTimeout(500);
  const closedAgain = await p.evaluate(() => document.querySelectorAll('[aria-expanded="true"]').length);
  console.log(nm, JSON.stringify({ clippedTabs: clip, lastTabBottom_before: before, after: after,
    pushedBy: after - before, openAfterTap: openNow, openAfterSecondTap: closedAgain }));
  await p.close();
}
await b.close();
