import { chromium } from "playwright";

const URL = "http://127.0.0.1:4402/freedoms/";

async function run(w, h, tag) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  // 1. heading text gone?
  const headings = await page.evaluate(() =>
    Array.from(document.querySelectorAll("h1")).map((e) => e.textContent.trim())
  );
  const gone =
    (await page.evaluate(() => document.body.innerText.includes("What the line survived"))) ||
    (await page.evaluate(() => document.body.innerText.includes("What Australians lost")));
  console.log(`${tag} h1s=${JSON.stringify(headings)} oldHeadingPresent=${gone}`);

  // 2. right alignment: item right edge vs page content right edge
  const geo = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("[data-li-item]"));
    const main = document.querySelector("main") || document.body;
    const mr = main.getBoundingClientRect();
    return {
      mainRight: Math.round(mr.right),
      mainLeft: Math.round(mr.left),
      items: items.map((it) => {
        const r = it.getBoundingClientRect();
        return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) };
      }),
      // measure actual left-side whitespace created
      deckLefts: Array.from(document.querySelectorAll("[data-deck]")).map((d) => Math.round(d.getBoundingClientRect().left)),
    };
  });
  const rights = geo.items.map((i) => i.r);
  const uniqRights = [...new Set(rights)];
  console.log(`${tag} main=${geo.mainLeft}..${geo.mainRight} item-rights=${JSON.stringify(uniqRights)} flush=${uniqRights.length === 1 && Math.abs(uniqRights[0] - geo.mainRight) <= 2}`);
  console.log(`${tag} item-lefts=${JSON.stringify([...new Set(geo.items.map((i) => i.l))])} widths=${JSON.stringify([...new Set(geo.items.map((i) => i.w))])} leftGap=${geo.items[0].l - geo.mainLeft}px`);

  // 3. nothing covers anything: every tab hit-testable with a body open
  const n = await page.locator("[data-li-tab]").count();
  const reach = async () => {
    let ok = 0;
    for (let j = 0; j < n; j++) {
      const t = page.locator("[data-li-tab]").nth(j);
      await t.scrollIntoViewIfNeeded();
      await page.waitForTimeout(35);
      const b = await t.boundingBox();
      const hit = await page.evaluate(
        ({ x, y }) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest("[data-li-tab]")); },
        { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
      );
      if (hit) ok++;
    }
    return ok;
  };

  const idx = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-li-tab]")).map((t, i) => ({
      i, deck: Number((t.getAttribute("aria-controls").match(/li-body-(\d+)-/) || [])[1]),
    }))
  );

  const rows = [];
  for (const t of idx) {
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(380);
    const openNow = await page.evaluate((k) => document.querySelectorAll("[data-li-tab]")[k].getAttribute("aria-expanded"), t.i);
    if (openNow !== "true") {
      const el = page.locator("[data-li-tab]").nth(t.i);
      await el.scrollIntoViewIfNeeded();
      await el.click({ timeout: 10000 });
      await page.waitForTimeout(280);
    }
    const s = await page.evaluate((k) => {
      const tab = document.querySelectorAll("[data-li-tab]")[k];
      const item = tab.closest("[data-li-item]");
      const body = item.querySelector("[data-li-card]");
      const deck = item.getAttribute("data-deck");
      const all = Array.from(document.querySelectorAll(`[data-li-item][data-deck="${deck}"]`));
      const tr = tab.getBoundingClientRect(), br = body.getBoundingClientRect();
      const ir = item.getBoundingClientRect();
      return {
        expanded: tab.getAttribute("aria-expanded"), hidden: body.hidden,
        gap: Math.round(br.top - tr.bottom),
        open: all.filter((it) => !it.querySelector("[data-li-card]").hidden).length,
        right: Math.round(ir.right), left: Math.round(ir.left), w: Math.round(ir.width),
      };
    }, t.i);
    const r = await reach();
    const ok = s.expanded === "true" && !s.hidden && s.open === 1 && s.gap >= -1 && s.gap <= 2 && r === n;
    rows.push({ ...t, ok, ...s, reach: r });
  }
  rows.forEach((r) =>
    console.log(`${r.ok ? "PASS" : "FAIL"} i=${r.i} deck=${r.deck} gap=${r.gap} open=${r.open} reach=${r.reach}/${n} left=${r.left} right=${r.right}`)
  );
  console.log(`${tag} REVEAL ${rows.filter((r) => r.ok).length}/${rows.length}`);

  // 4. overlap brute force: no two items intersect
  const intersects = await page.evaluate(() => {
    const its = Array.from(document.querySelectorAll("[data-li-item]")).map((e) => e.getBoundingClientRect());
    let bad = 0;
    for (let a = 0; a < its.length; a++)
      for (let b = a + 1; b < its.length; b++) {
        const A = its[a], B = its[b];
        if (A.left < B.right && B.left < A.right && A.top < B.bottom && B.top < A.bottom) bad++;
      }
    return bad;
  });
  console.log(`${tag} itemIntersections=${intersects}`);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `/tmp/r_${tag}_top.png` });
  const last = page.locator("[data-li-tab]").nth(n - 1);
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await page.waitForTimeout(420);
  await last.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -80));
  await page.waitForTimeout(280);
  await page.screenshot({ path: `/tmp/r_${tag}_last.png` });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `/tmp/r_${tag}_full.png`, fullPage: true });

  const ov = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  console.log(`${tag} overflow=${ov.s > ov.c + 1 ? "YES " + ov.s + ">" + ov.c : "none"} errs=${errs.length ? errs.join("|") : "none"}`);
  await browser.close();
}

await run(390, 900, "phone");
await run(1400, 950, "desk");
