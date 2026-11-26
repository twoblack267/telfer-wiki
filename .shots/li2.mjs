import { chromium } from "playwright";

const URL = "http://127.0.0.1:4402/freedoms/";

async function run(w, h, tag) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const n = await page.locator("[data-li-card]").count();
  console.log(`${tag} cards=${n} errors=${errs.length ? JSON.stringify(errs) : "none"}`);

  // Geometry of every tab, and whether any other element covers it.
  const report = await page.evaluate(() => {
    const res = { stacks: [], covered: [], open: 0 };
    document.querySelectorAll(".li-stack").forEach((s, si) => {
      const cards = Array.from(s.querySelectorAll("[data-li-card]"));
      const rows = cards.map((c) => {
        const tab = c.querySelector(".li-tab");
        const tr = tab.getBoundingClientRect();
        const cr = c.getBoundingClientRect();
        const mid = { x: Math.round(tr.left + tr.width / 2), y: Math.round(tr.top + tr.height / 2) };
        const hitEl = document.elementFromPoint(mid.x, mid.y);
        const covered = !(hitEl && tab.contains(hitEl));
        if (covered) res.covered.push({ stack: si, t: c.getAttribute("data-file"), hit: hitEl ? hitEl.className || hitEl.tagName : "null", x: mid.x, y: mid.y });
        if (c.classList.contains("is-open")) res.open++;
        return {
          t: c.getAttribute("data-file").slice(0, 30),
          x: Math.round(cr.x),
          w: Math.round(cr.width),
          top: Math.round(tr.top),
          tabH: Math.round(tr.height),
          cardH: Math.round(cr.height),
          open: c.classList.contains("is-open"),
          covered,
        };
      });
      res.stacks.push({ si, rows, padTop: getComputedStyle(s).paddingTop });
    });
    return res;
  });

  console.log(`${tag} openCards=${report.open}`);
  for (const s of report.stacks) {
    console.log(`  stack ${s.si} padTop=${s.padTop}`);
    for (const r of s.rows) {
      console.log(`    x=${r.x} w=${r.w} tabTop=${r.top} tabH=${r.tabH} cardH=${r.cardH} open=${r.open ? "Y" : "n"} covered=${r.covered} | ${r.t}`);
    }
  }
  if (report.covered.length) console.log(`${tag} COVERED: ${JSON.stringify(report.covered)}`);
  else console.log(`${tag} all tabs reachable: yes`);

  await page.screenshot({ path: `/tmp/li2_${tag}_init.png` });

  // ── Click test: open the 2nd card of the 2010s stack ────────────────
  const stack2010 = page.locator('.li-stack').nth(2);
  const btn2 = stack2010.locator('.li-tab').nth(1);
  await btn2.scrollIntoViewIfNeeded();
  await btn2.click({ force: false, timeout: 8000 });
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => {
    const open = Array.from(document.querySelectorAll('[data-li-card].is-open'));
    const hitAll = [];
    document.querySelectorAll('[data-li-card]').forEach((c) => {
      const tab = c.querySelector('.li-tab');
      const tr = tab.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.round(tr.left + tr.width / 2), Math.round(tr.top + tr.height / 2));
      hitAll.push({ t: c.getAttribute('data-file').slice(0, 28), reachable: !!(hit && tab.contains(hit)), open: c.classList.contains('is-open') });
    });
    return {
      openCount: open.length,
      openTitles: open.map((c) => c.getAttribute('data-file')),
      openH: open[0] ? Math.round(open[0].getBoundingClientRect().height) : 0,
      bodyDisplayed: open[0] ? getComputedStyle(open[0].querySelector('.li-body')).display : null,
      reachable: hitAll,
    };
  });
  console.log(`${tag} afterClick openCount=${after.openCount} openH=${after.openH} body=${after.bodyDisplayed}`);
  console.log(`${tag} openTitles=${JSON.stringify(after.openTitles)}`);
  const unreachable = after.reachable.filter((r) => !r.reachable);
  console.log(`${tag} unreachableTabsAfterClick=${unreachable.length}${unreachable.length ? " " + JSON.stringify(unreachable) : ""}`);

  await page.screenshot({ path: `/tmp/li2_${tag}_click.png` });

  // ── Click a THIRD card, prove swap ──────────────────────────────────
  const btn3 = stack2010.locator('.li-tab').nth(2);
  await btn3.scrollIntoViewIfNeeded();
  await btn3.click({ timeout: 8000 });
  await page.waitForTimeout(400);
  const swap = await page.evaluate(() => {
    const open = Array.from(document.querySelectorAll('[data-li-card].is-open'));
    return { count: open.length, titles: open.map((c) => c.getAttribute('data-file')) };
  });
  console.log(`${tag} afterSwap count=${swap.count} titles=${JSON.stringify(swap.titles)}`);

  // ── Toggle off test ─────────────────────────────────────────────────
  await stack2010.locator('.li-tab').nth(2).click({ timeout: 8000 });
  await page.waitForTimeout(350);
  const toggled = await page.evaluate(() => document.querySelectorAll('[data-li-card].is-open').length);
  console.log(`${tag} afterToggleOff openCount=${toggled}`);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `/tmp/li2_${tag}_top.png`, fullPage: false });
  // Full page for a whole-page look
  await page.screenshot({ path: `/tmp/li2_${tag}_full.png`, fullPage: true });

  await browser.close();
}

await run(390, 900, "phone");
await run(1400, 950, "desk");
