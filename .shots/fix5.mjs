import { chromium } from "playwright";
const b = await chromium.launch();
for (const [nm, W, H] of [["phone", 390, 900], ["desk", 1400, 1000]]) {
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await p.goto("http://127.0.0.1:4402/timeline/", { waitUntil: "networkidle" });
  await p.waitForTimeout(1000);
  const res = [];
  const decks = await p.$$("[data-deck]");
  for (let i = 0; i < decks.length; i++) {
    const d = decks[i];
    const nd = await d.evaluate(el => el.querySelectorAll("[data-fcard]").length);
    if (nd < 2) continue;
    await d.scrollIntoViewIfNeeded(); await p.waitForTimeout(200);
    const before = await d.evaluate(el => {
      const r = el.getBoundingClientRect();
      const nb = el.closest("div")?.nextElementSibling;
      return { deckBottom: Math.round(r.bottom), nextTop: nb ? Math.round(nb.getBoundingClientRect().top) : null,
               docH: Math.round(document.documentElement.scrollHeight) };
    });
    const tabs = await d.$$("[data-ftab]");
    await tabs[1].click(); await p.waitForTimeout(450);
    const after = await d.evaluate(el => {
      const r = el.getBoundingClientRect();
      const nb = el.closest("div")?.nextElementSibling;
      const open = el.querySelector(".fcard.is-open");
      const body = open?.querySelector(".fcard-body");
      const clippedTitle = Array.from(el.querySelectorAll(".ftab-title")).filter(t => t.scrollWidth > t.clientWidth + 1).map(t=>t.textContent.trim());
      return { deckBottom: Math.round(r.bottom), nextTop: nb ? Math.round(nb.getBoundingClientRect().top) : null,
               docH: Math.round(document.documentElement.scrollHeight),
               openW: open ? Math.round(open.getBoundingClientRect().width) : 0,
               bodyClipped: body ? body.scrollHeight > body.getBoundingClientRect().height + 2 : null,
               clippedTitles: clippedTitle };
    });
    await tabs[1].click(); await p.waitForTimeout(450);
    const closed = await d.evaluate(el => document.querySelectorAll('[aria-expanded="true"]').length);
    res.push({ deck: i, n: nd, push: after.nextTop - before.nextTop, docPush: after.docH - before.docH,
               openW: after.openW, bodyClipped: after.bodyClipped, clippedTitles: after.clippedTitles,
               openAfter2ndTap: closed });
  }
  console.log(nm, JSON.stringify(res));
  await p.close();
}
await b.close();
