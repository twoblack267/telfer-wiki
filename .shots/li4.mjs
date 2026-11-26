import { chromium } from "playwright";

const URL = "http://127.0.0.1:4402/freedoms/";

async function run(w, h, tag) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errs = [];
  page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const tabs = page.locator("[data-li-tab]");
  const nTabs = await tabs.count();
  const cards = page.locator("[data-li-card]");
  const nCards = await cards.count();
  console.log(`${tag} tabs=${nTabs} cards=${nCards} jsErrors=${errs.length ? JSON.stringify(errs) : "none"}`);

  // 1. Every tab reachable + left-aligned + sane geometry
  let reach = 0;
  const geo = [];
  for (let i = 0; i < nTabs; i++) {
    const t = tabs.nth(i);
    await t.scrollIntoViewIfNeeded();
    await page.waitForTimeout(80);
    const b = await t.boundingBox();
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return !!(el && el.closest("[data-li-tab]"));
    }, { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) });
    if (hit) reach++;
    const deck = await t.getAttribute("data-deck");
    const title = (await t.innerText()).replace(/\s+/g, " ").slice(0, 34);
    geo.push({ i, x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height), deck, hit, title });
  }
  console.log(`${tag} reachable=${reach}/${nTabs}`);
  geo.forEach((g) => console.log(`   i=${g.i} deck=${g.deck} x=${g.x} w=${g.w} h=${g.h} hit=${g.hit} | ${g.title}`));

  // 2. Visible-cards initial state: exactly one per decade
  const initOpen = await page.evaluate(() => {
    const vis = Array.from(document.querySelectorAll("[data-li-card]")).filter((c) => !c.hidden);
    return vis.map((c) => ({ deck: c.getAttribute("data-deck"), t: c.getAttribute("data-file").slice(0, 28) }));
  });
  console.log(`${tag} initiallyVisible=${initOpen.length} ${JSON.stringify(initOpen)}`);

  // 3. Click tab 3 of the 2020s deck (4 cards) and prove swap works
  const deck3 = 3;
  const t3 = page.locator(`[data-li-tab][data-deck="${deck3}"]`).nth(2);
  const title3 = (await t3.innerText()).replace(/\s+/g, " ").slice(0, 40);
  await t3.scrollIntoViewIfNeeded();
  await t3.click();
  await page.waitForTimeout(350);
  const afterClick = await page.evaluate((d) => {
    const vis = Array.from(document.querySelectorAll("[data-li-card]")).filter((c) => !c.hidden && c.getAttribute("data-deck") === String(d));
    const exp = Array.from(document.querySelectorAll(`[data-li-tab][data-deck="${d}"]`)).map((t) => t.getAttribute("aria-expanded"));
    const allOpen = Array.from(document.querySelectorAll('[aria-expanded="true"]')).length;
    return {
      cardsVisibleInDeck: vis.map((c) => c.getAttribute("data-file").slice(0, 34)),
      expandedFlags: exp,
      totalExpanded: allOpen,
    };
  }, deck3);
  console.log(`${tag} clicked "${title3}" -> ${JSON.stringify(afterClick)}`);

  // 4. Prove no tab got covered after opening a big card
  let reachAfter = 0;
  for (let i = 0; i < nTabs; i++) {
    const t = tabs.nth(i);
    await t.scrollIntoViewIfNeeded();
    await page.waitForTimeout(60);
    const b = await t.boundingBox();
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return !!(el && el.closest("[data-li-tab]"));
    }, { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) });
    if (hit) reachAfter++;
  }
  console.log(`${tag} reachableAfterOpen=${reachAfter}/${nTabs}`);

  // 5. Toggle off
  await t3.click();
  await page.waitForTimeout(300);
  const afterToggle = await page.evaluate((d) => {
    const vis = Array.from(document.querySelectorAll("[data-li-card]")).filter((c) => !c.hidden && c.getAttribute("data-deck") === String(d));
    return { visibleInDeck: vis.length };
  }, deck3);
  console.log(`${tag} afterToggleOff=${JSON.stringify(afterToggle)}`);

  // 6. Screenshots: top of page and each decade in view
  await t3.click();
  await page.waitForTimeout(300);
  await t3.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `/tmp/li4_${tag}_open.png` });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `/tmp/li4_${tag}_top.png` });
  await page.screenshot({ path: `/tmp/li4_${tag}_full.png`, fullPage: true });

  // 7. Overflow check: no horizontal scrollbar
  const ov = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  console.log(`${tag} overflow=${ov.scrollW > ov.clientW + 1 ? "YES " + JSON.stringify(ov) : "none (" + ov.scrollW + "/" + ov.clientW + ")"}`);

  await browser.close();
}

await run(390, 900, "phone");
await run(1400, 950, "desk");
