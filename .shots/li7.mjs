import { chromium } from "playwright";

const URL = "http://127.0.0.1:4402/freedoms/";

async function run(w, h, tag) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errs = [];
  page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const n = await page.locator("[data-li-tab]").count();
  console.log(`${tag} tabs=${n} jsErrors=${errs.length ? JSON.stringify(errs) : "none"}`);

  // Enumerate tabs with their deck + index straight from the DOM once.
  const index = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-li-tab]")).map((t, i) => {
      const m = (t.getAttribute("aria-controls") || "").match(/li-body-(\d+)-(\d+)/);
      return { i, deck: Number(m[1]), card: Number(m[2]) };
    })
  );

  const stateOf = (i) =>
    page.evaluate((idx) => {
      const tab = document.querySelectorAll("[data-li-tab]")[idx];
      const item = tab.closest("[data-li-item]");
      const body = item.querySelector("[data-li-card]");
      const deck = item.getAttribute("data-deck");
      const all = Array.from(document.querySelectorAll(`[data-li-item][data-deck="${deck}"]`));
      const tr = tab.getBoundingClientRect();
      const br = body.getBoundingClientRect();
      return {
        expanded: tab.getAttribute("aria-expanded"),
        hidden: body.hidden,
        gap: Math.round(br.top - tr.bottom),
        open: all.filter((it) => !it.querySelector("[data-li-card]").hidden).length,
        title: body.getAttribute("data-file").slice(0, 30),
      };
    }, i);

  const reachAll = async () => {
    let ok = 0;
    for (let j = 0; j < n; j++) {
      const t = page.locator("[data-li-tab]").nth(j);
      await t.scrollIntoViewIfNeeded();
      await page.waitForTimeout(40);
      const b = await t.boundingBox();
      const hit = await page.evaluate(
        ({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          return !!(el && el.closest("[data-li-tab]"));
        },
        { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
      );
      if (hit) ok++;
    }
    return ok;
  };

  const rows = [];
  for (const t of index) {
    // Put the deck into a known state: open a DIFFERENT card in this deck first.
    const sibling = index.find((o) => o.deck === t.deck && o.i !== t.i);
    if (sibling) {
      const s = await stateOf(sibling.i);
      if (s.expanded !== "true") {
        const el = page.locator("[data-li-tab]").nth(sibling.i);
        await el.scrollIntoViewIfNeeded();
        await el.click();
        await page.waitForTimeout(180);
      }
    }
    // Now click the card we're testing.
    const el = page.locator("[data-li-tab]").nth(t.i);
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(90);
    await el.click({ timeout: 8000 });
    await page.waitForTimeout(280);

    const st = await stateOf(t.i);
    const reach = await reachAll();
    const ok =
      st.expanded === "true" && !st.hidden && st.open === 1 &&
      st.gap >= -1 && st.gap <= 2 && reach === n;
    rows.push({ i: t.i, deck: t.deck, card: t.card, ok, ...st, reach });
  }

  rows.forEach((r) =>
    console.log(
      `${r.ok ? "PASS" : "FAIL"} i=${r.i} deck=${r.deck} card=${r.card} gap=${r.gap} open=${r.open} reach=${r.reach}/${n} | ${r.title}`
    )
  );
  console.log(`${tag} REVEAL: ${rows.filter((r) => r.ok).length}/${rows.length} pass`);

  // Toggle-off: click an open tab twice.
  const openRow = rows.find((r) => r.ok);
  if (openRow) {
    const el = page.locator("[data-li-tab]").nth(openRow.i);
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await page.waitForTimeout(250);
    const c = await stateOf(openRow.i);
    console.log(`${tag} toggleOff expanded=${c.expanded} hidden=${c.hidden} openInDeck=${c.open}`);
    // reopen for the screenshot
    await el.click();
    await page.waitForTimeout(250);
  }

  // Initial-state check on a fresh load.
  const page2 = await browser.newPage({ viewport: { width: w, height: h } });
  await page2.goto(URL, { waitUntil: "networkidle" });
  await page2.waitForTimeout(400);
  const init = await page2.evaluate(() => {
    const out = {};
    document.querySelectorAll("[data-li-item]").forEach((it) => {
      const d = it.getAttribute("data-deck");
      const shown = it.querySelector("[data-li-card]").hidden ? 0 : 1;
      out[d] = (out[d] || 0) + shown;
    });
    return out;
  });
  const visTotal = await page2.evaluate(() => Array.from(document.querySelectorAll("[data-li-card]")).filter((b) => !b.hidden).length);
  console.log(`${tag} freshLoad openPerDeck=${JSON.stringify(init)} totalOpen=${visTotal} (decks=${Object.keys(init).length})`);
  await page2.close();

  // Screenshot the biggest card open.
  const lastIdx = n - 1;
  const lastEl = page.locator("[data-li-tab]").nth(lastIdx);
  await lastEl.scrollIntoViewIfNeeded();
  const ls = await page.locator("[data-li-tab]").nth(lastIdx).getAttribute("aria-expanded");
  if (ls !== "true") await lastEl.click();
  await page.waitForTimeout(350);
  await lastEl.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -80));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `/tmp/li6_${tag}_lastopen.png` });

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `/tmp/li6_${tag}_top.png` });

  const ov = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  console.log(`${tag} overflow=${ov.s > ov.c + 1 ? "YES " + JSON.stringify(ov) : "none"}`);
  await browser.close();
}

await run(390, 900, "phone");
await run(1400, 950, "desk");
