import { chromium } from "playwright";

const URL = "https://telferwiki.com/freedoms/";

async function run(w, h, tag) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errs = [];
  page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  const n = await page.locator("[data-li-tab]").count();
  const idx = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-li-tab]")).map((t, i) => {
      const m = (t.getAttribute("aria-controls") || "").match(/li-body-(\d+)-(\d+)/);
      return { i, deck: Number(m[1]), card: Number(m[2]) };
    })
  );
  console.log(`${tag} LIVE tabs=${n} errs=${errs.length ? JSON.stringify(errs) : "none"}`);

  const st = (i) =>
    page.evaluate((k) => {
      const tab = document.querySelectorAll("[data-li-tab]")[k];
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
        leftX: Math.round(item.getBoundingClientRect().left),
        title: body.getAttribute("data-file").slice(0, 26),
      };
    }, i);

  const reach = async () => {
    let ok = 0;
    for (let j = 0; j < n; j++) {
      const t = page.locator("[data-li-tab]").nth(j);
      await t.scrollIntoViewIfNeeded();
      await page.waitForTimeout(40);
      const b = await t.boundingBox();
      const h = await page.evaluate(
        ({ x, y }) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest("[data-li-tab]")); },
        { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
      );
      if (h) ok++;
    }
    return ok;
  };

  const rows = [];
  for (const t of idx) {
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400);
    const before = await st(t.i);
    if (before.expanded !== "true") {
      const el = page.locator("[data-li-tab]").nth(t.i);
      await el.scrollIntoViewIfNeeded();
      await el.click({ timeout: 10000 });
      await page.waitForTimeout(300);
    }
    const s = await st(t.i);
    const r = await reach();
    const ok = s.expanded === "true" && !s.hidden && s.open === 1 && s.gap >= -1 && s.gap <= 2 && r === n;
    rows.push({ ...t, ok, gap: s.gap, open: s.open, reach: r, leftX: s.leftX, title: s.title });
  }
  rows.forEach((r) =>
    console.log(`${r.ok ? "PASS" : "FAIL"} i=${r.i} deck=${r.deck} gap=${r.gap} open=${r.open} reach=${r.reach}/${n} leftX=${r.leftX} | ${r.title}`)
  );
  console.log(`${tag} LIVE REVEAL ${rows.filter((r) => r.ok).length}/${rows.length}`);

  // solo deck must not blank
  const solo = idx.filter((t) => idx.filter((o) => o.deck === t.deck).length === 1);
  let soloOk = 0;
  for (const s of solo) {
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(350);
    const el = page.locator("[data-li-tab]").nth(s.i);
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await page.waitForTimeout(250);
    const z = await st(s.i);
    if (z.open === 1 && !z.hidden) soloOk++;
  }
  console.log(`${tag} soloDecks=${solo.length} keptOpen=${soloOk}/${solo.length}`);

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const last = page.locator("[data-li-tab]").nth(n - 1);
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await page.waitForTimeout(450);
  await last.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -70));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `/tmp/live_${tag}_open.png` });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `/tmp/live_${tag}_top.png` });

  const ov = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  console.log(`${tag} overflow=${ov.s > ov.c + 1 ? "YES" : "none"}`);
  await browser.close();
}

await run(390, 900, "phone");
await run(1400, 950, "desk");
