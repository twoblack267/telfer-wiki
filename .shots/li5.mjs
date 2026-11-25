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

  // Geometry: left edge, sliver height, ordering
  const geo = [];
  for (let i = 0; i < nTabs; i++) {
    const t = tabs.nth(i);
    await t.scrollIntoViewIfNeeded();
    await page.waitForTimeout(60);
    const b = await t.boundingBox();
    const deck = await t.getAttribute("aria-controls");
    const txt = (await t.innerText()).replace(/\s+/g, " ");
    geo.push({ i, x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height), txt: txt.slice(0, 30) });
  }
  geo.forEach((g) => console.log(`   i=${g.i} x=${g.x} w=${g.w} sliverH=${g.h} | ${g.txt}`));

  // THE key test: click each tab in turn, prove its body is open, directly
  // under its own tab, and every other tab still clickable.
  const results = [];
  for (let i = 0; i < nTabs; i++) {
    const t = tabs.nth(i);
    await t.scrollIntoViewIfNeeded();
    await page.waitForTimeout(120);
    await t.click({ timeout: 8000 });
    await page.waitForTimeout(300);

    const st = await page.evaluate((idx) => {
      const tab = document.querySelectorAll("[data-li-tab]")[idx];
      const item = tab.closest("[data-li-item]");
      const body = item.querySelector("[data-li-card]");
      const deck = item.getAttribute("data-deck");
      const sibs = Array.from(document.querySelectorAll(`[data-li-item][data-deck="${deck}"] [data-li-card]`));
      const tr = tab.getBoundingClientRect();
      const br = body.getBoundingClientRect();
      return {
        expanded: tab.getAttribute("aria-expanded"),
        bodyHidden: body.hidden,
        bodyTop: Math.round(br.top),
        tabBottom: Math.round(tr.bottom),
        gap: Math.round(br.top - tr.bottom),
        sameItem: body.closest("[data-li-item]") === item,
        openInDeck: sibs.filter((b) => !b.hidden).length,
        title: body.getAttribute("data-file").slice(0, 30),
      };
    }, i);

    // is every tab still hit-testable after this open?
    let reach = 0;
    for (let j = 0; j < nTabs; j++) {
      const tj = tabs.nth(j);
      await tj.scrollIntoViewIfNeeded();
      await page.waitForTimeout(60);
      const b = await tj.boundingBox();
      const hit = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return !!(el && el.closest("[data-li-tab]"));
      }, { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) });
      if (hit) reach++;
    }

    results.push({ i, ...st, reachable: `${reach}/${nTabs}` });
  }

  results.forEach((r) => {
    const ok = r.expanded === "true" && !r.bodyHidden && r.sameItem && r.openInDeck === 1 && r.gap <= 2 && r.gap >= -1 && r.reachable === `${nTabs}/${nTabs}`;
    console.log(`${ok ? "PASS" : "FAIL"} i=${r.i} gap=${r.gap} openInDeck=${r.openInDeck} reach=${r.reachable} | ${r.title}`);
  });

  const fails = results.filter((r) => !(r.expanded === "true" && !r.bodyHidden && r.sameItem && r.openInDeck === 1 && r.gap <= 2 && r.gap >= -1 && r.reachable === `${nTabs}/${nTabs}`));
  console.log(`${tag} RESULT: ${results.length - fails.length}/${results.length} pass`);

  // Toggle-off check on last tab
  const lastTab = tabs.nth(nTabs - 1);
  await lastTab.scrollIntoViewIfNeeded();
  await lastTab.click();
  await page.waitForTimeout(250);
  const closed = await page.evaluate((idx) => {
    const tab = document.querySelectorAll("[data-li-tab]")[idx];
    const body = tab.closest("[data-li-item]").querySelector("[data-li-card]");
    return { expanded: tab.getAttribute("aria-expanded"), hidden: body.hidden };
  }, nTabs - 1);
  console.log(`${tag} toggleOff=${JSON.stringify(closed)}`);

  // Screenshots
  await tabs.nth(nTabs - 1).click();
  await page.waitForTimeout(300);
  await tabs.nth(nTabs - 1).scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `/tmp/li5_${tag}_open.png` });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `/tmp/li5_${tag}_top.png` });

  const ov = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  console.log(`${tag} overflow=${ov.s > ov.c + 1 ? "YES " + JSON.stringify(ov) : "none"}`);
  await browser.close();
}

await run(390, 900, "phone");
await run(1400, 950, "desk");
