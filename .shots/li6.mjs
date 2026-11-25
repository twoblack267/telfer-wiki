import { chromium } from "playwright";

const URL = "http://127.0.0.1:4402/freedoms/";

async function run(w, h, tag) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errs = [];
  page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const tabs = page.locator("[data-li-tab]");
  const nTabs = await tabs.count();
  console.log(`${tag} tabs=${nTabs} jsErrors=${errs.length ? JSON.stringify(errs) : "none"}`);

  function check(idx) {
    return page.evaluate((i) => {
      const tab = document.querySelectorAll("[data-li-tab]")[i];
      const item = tab.closest("[data-li-item]");
      const body = item.querySelector("[data-li-card]");
      const deck = item.getAttribute("data-deck");
      const sibs = Array.from(document.querySelectorAll(`[data-li-item][data-deck="${deck}"] [data-li-card]`));
      const tr = tab.getBoundingClientRect();
      const br = body.getBoundingClientRect();
      return {
        expanded: tab.getAttribute("aria-expanded"),
        bodyHidden: body.hidden,
        gap: Math.round(br.top - tr.bottom),
        bodyTop: Math.round(br.top),
        tabTop: Math.round(tr.top),
        sameItem: body.closest("[data-li-item]") === item,
        openInDeck: sibs.filter((b) => !b.hidden).length,
        title: body.getAttribute("data-file").slice(0, 32),
      };
    }, idx);
  }

  async function reachAll() {
    let n = 0;
    for (let j = 0; j < nTabs; j++) {
      const tj = tabs.nth(j);
      await tj.scrollIntoViewIfNeeded();
      await page.waitForTimeout(50);
      const b = await tj.boundingBox();
      const hit = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return !!(el && el.closest("[data-li-tab]"));
      }, { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) });
      if (hit) n++;
    }
    return n;
  }

  // Phase A: for every card, ensure a DIFFERENT card in its deck is open,
  // then click this one. That is genuine "click to reveal" behaviour.
  const rows = [];
  for (let i = 0; i < nTabs; i++) {
    const deck = await tabs.nth(i).getAttribute("aria-controls");
    const deckIdx = deck.split("-")[1];

    // pick another tab in the same deck, prefer one currently closed
    const sibTabs = page.locator(`[data-li-tab][aria-controls^="li-body-${deckIdx}-"]`);
    const nSib = await sibTabs.count();
    let other = -1;
    for (let k = 0; k < nSib; k++) {
      const others = page.locator("[data-li-tab]");
      const allIdx = [];
      for (let m = 0; m < nTabs; m++) {
        const c = await tabs.nth(m).getAttribute("aria-controls");
        if (c.startsWith(`li-body-${deckIdx}-`)) allIdx.push(m);
      }
      const cand = allIdx[k];
      if (cand !== i) { other = cand; break; }
    }
    if (other >= 0) {
      await tabs.nth(other).scrollIntoViewIfNeeded();
      const state = await tabs.nth(other).getAttribute("aria-expanded");
      if (state !== "true") await tabs.nth(other).click();
      await page.waitForTimeout(150);
    }

    const t = tabs.nth(i);
    await t.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    await t.click({ timeout: 8000 });
    await page.waitForTimeout(280);

    const st = await check(i);
    const reach = await reachAll();
    const ok = st.expanded === "true" && !st.bodyHidden && st.sameItem &&
      st.openInDeck === 1 && st.gap >= -1 && st.gap <= 2 && reach === nTabs;
    rows.push({ i, ok, ...st, reach });
  }

  rows.forEach((r) => {
    console.log(`${r.ok ? "PASS" : "FAIL"} i=${r.i} gap=${r.gap} openInDeck=${r.openInDeck} reach=${r.reach}/${nTabs} | ${r.title}`);
  });
  const pass = rows.filter((r) => r.ok).length;
  console.log(`${tag} REVEAL: ${pass}/${rows.length} pass`);

  // Phase B: toggle-off on the open card, then collapse-check.
  const openIdx = rows.find((r) => r.ok)?.i ?? nTabs - 1;
  await tabs.nth(openIdx).scrollIntoViewIfNeeded();
  await tabs.nth(openIdx).click();
  await page.waitForTimeout(250);
  const closed = await check(openIdx);
  console.log(`${tag} toggleOff: expanded=${closed.expanded} hidden=${closed.bodyHidden} openInDeck=${closed.openInDeck}`);

  // Phase C: initial state — exactly one open per decade, all tabs reachable
  const init = await page.evaluate(() => {
    const decks = {};
    document.querySelectorAll("[data-li-item]").forEach((item) => {
      const d = item.getAttribute("data-deck");
      const b = item.querySelector("[data-li-card]");
      decks[d] = (decks[d] || 0) + (b.hidden ? 0 : 1);
    });
    return decks;
  });
  console.log(`${tag} perDeckOpenCounts=${JSON.stringify(init)}`);

  // Screenshot: 2020s deck with the LAST card open (biggest card)
  const last = tabs.nth(nTabs - 1);
  await last.scrollIntoViewIfNeeded();
  const lstate = await last.getAttribute("aria-expanded");
  if (lstate !== "true") await last.click();
  await page.waitForTimeout(350);
  await last.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `/tmp/li5_${tag}_lastopen.png` });

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `/tmp/li5_${tag}_top.png` });

  const ov = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  console.log(`${tag} overflow=${ov.s > ov.c + 1 ? "YES " + JSON.stringify(ov) : "none"}`);
  await browser.close();
}

await run(390, 900, "phone");
await run(1400, 950, "desk");
