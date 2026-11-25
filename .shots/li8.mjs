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
  const index = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-li-tab]")).map((t, i) => {
      const m = (t.getAttribute("aria-controls") || "").match(/li-body-(\d+)-(\d+)/);
      return { i, deck: Number(m[1]), card: Number(m[2]) };
    })
  );
  console.log(`${tag} tabs=${n} errs=${errs.length ? JSON.stringify(errs) : "none"}`);

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
        title: body.getAttribute("data-file").slice(0, 28),
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

  // CLICK-TO-REVEAL from a cold state: reload for each card so we always
  // start from the shipped default, then click the card we want.
  const rows = [];
  for (const t of index) {
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(320);

    const before = await stateOf(t.i);
    let clicked = false;
    if (before.expanded !== "true") {
      const el = page.locator("[data-li-tab]").nth(t.i);
      await el.scrollIntoViewIfNeeded();
      await el.click({ timeout: 8000 });
      await page.waitForTimeout(280);
      clicked = true;
    }
    const st = await stateOf(t.i);
    const reach = await reachAll();
    const ok =
      st.expanded === "true" && !st.hidden && st.open === 1 &&
      st.gap >= -1 && st.gap <= 2 && reach === n &&
      (!clicked || before.expanded === "false");
    rows.push({ ...t, ok, clicked, wasOpen: before.expanded === "true", ...st, reach });
  }

  rows.forEach((r) =>
    console.log(
      `${r.ok ? "PASS" : "FAIL"} i=${r.i} deck=${r.deck} card=${r.card} wasOpen=${r.wasOpen} gap=${r.gap} open=${r.open} reach=${r.reach}/${n} | ${r.title}`
    )
  );
  console.log(`${tag} REVEAL ${rows.filter((r) => r.ok).length}/${rows.length}`);

  // One-card decks: clicking the open tab must NOT blank the deck.
  const solo = index.filter((t) => index.filter((o) => o.deck === t.deck).length === 1);
  let soloOk = 0;
  for (const s of solo) {
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);
    const el = page.locator("[data-li-tab]").nth(s.i);
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await page.waitForTimeout(220);
    const st = await stateOf(s.i);
    const stillOpen = st.open === 1 && !st.hidden;
    if (stillOpen) soloOk++;
    console.log(`${stillOpen ? "PASS" : "FAIL"} solo deck=${s.deck} clickOnOpenTab -> open=${st.open} hidden=${st.hidden}`);
  }

  // Multi-card deck: clicking the open tab collapses it, but deck keeps one open? No —
  // collapsing the only visible card is allowed only if another can be opened.
  // Verify a multi-card deck can still reach zero, then a click restores one.
  const multi = index.filter((t) => index.filter((o) => o.deck === t.deck).length > 1);
  if (multi.length) {
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);
    const m = multi[0];
    const el = page.locator("[data-li-tab]").nth(m.i);
    await el.scrollIntoViewIfNeeded();
    await el.click(); // close it
    await page.waitForTimeout(250);
    const a = await stateOf(m.i);
    const el2 = page.locator("[data-li-tab]").nth(m.i);
    await el2.click(); // reopen
    await page.waitForTimeout(250);
    const b = await stateOf(m.i);
    console.log(`${tag} multiToggle close:${a.expanded}/${a.open} reopen:${b.expanded}/${b.open}`);
  }

  console.log(`${tag} soloDecks=${solo.length} soloKeptOpen=${soloOk}/${solo.length}`);

  // Screenshots
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const lastIdx = n - 1;
  const lastEl = page.locator("[data-li-tab]").nth(lastIdx);
  await lastEl.scrollIntoViewIfNeeded();
  await lastEl.click();
  await page.waitForTimeout(400);
  await lastEl.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -70));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `/tmp/li7_${tag}_lastopen.png` });

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `/tmp/li7_${tag}_top.png` });
  await page.screenshot({ path: `/tmp/li7_${tag}_full.png`, fullPage: true });

  const ov = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  console.log(`${tag} overflow=${ov.s > ov.c + 1 ? "YES" : "none"}`);
  await browser.close();
}

await run(390, 900, "phone");
await run(1400, 950, "desk");
