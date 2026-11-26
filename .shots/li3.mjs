import { chromium } from "playwright";

const URL = "http://127.0.0.1:4402/freedoms/";

async function run(w, h, tag) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const total = await page.locator("[data-li-card]").count();
  console.log(`${tag} cards=${total}`);

  // Real reachability: scroll each tab into view, then hit-test its centre.
  const results = [];
  for (let i = 0; i < total; i++) {
    const card = page.locator("[data-li-card]").nth(i);
    const tab = card.locator(".li-tab");
    await tab.scrollIntoViewIfNeeded();
    await page.waitForTimeout(120);
    const box = await tab.boundingBox();
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const tabEl = el ? el.closest(".li-tab") : null;
      return {
        tag: el ? el.tagName : "null",
        cls: el ? (el.className || "").toString().slice(0, 40) : "",
        isTab: !!tabEl,
        x, y,
      };
    }, { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) });
    const title = await card.getAttribute("data-file");
    results.push({ i, title: title.slice(0, 30), ...hit });
  }

  const blocked = results.filter((r) => !r.isTab);
  console.log(`${tag} tabsHitTest: ${total - blocked.length}/${total} reachable`);
  if (blocked.length) console.log(`${tag} BLOCKED: ${JSON.stringify(blocked, null, 1)}`);
  else console.log(`${tag} every tab is clickable at its own centre: PASS`);

  // Now the harder test: open the LAST card of the 4-card stack, then confirm
  // every tab in that same stack is still hit-testable.
  const s3 = page.locator(".li-stack").nth(3);
  const last = s3.locator("[data-li-card]").last();
  await last.locator(".li-tab").scrollIntoViewIfNeeded();
  await last.locator(".li-tab").click({ timeout: 8000 });
  await page.waitForTimeout(400);

  const stackCheck = [];
  const cnt = await s3.locator("[data-li-card]").count();
  for (let i = 0; i < cnt; i++) {
    const t = s3.locator("[data-li-card]").nth(i).locator(".li-tab");
    await t.scrollIntoViewIfNeeded();
    await page.waitForTimeout(120);
    const b = await t.boundingBox();
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return { isTab: !!(el && el.closest(".li-tab")), hitCls: el ? (el.className || "").toString().slice(0, 34) : "null" };
    }, { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) });
    const title = await s3.locator("[data-li-card]").nth(i).getAttribute("data-file");
    stackCheck.push({ i, title: title.slice(0, 26), ...hit });
  }
  console.log(`${tag} afterOpeningLastCard in 2020s stack:`);
  stackCheck.forEach((r) => console.log(`   i=${r.i} isTab=${r.isTab} hit=${r.hitCls} | ${r.title}`));

  const open = await page.evaluate(() => Array.from(document.querySelectorAll("[data-li-card].is-open")).map((c) => c.getAttribute("data-file")));
  console.log(`${tag} openCount=${open.length} ${JSON.stringify(open)}`);

  await page.screenshot({ path: `/tmp/li3_${tag}_lastopen.png` });

  // Is the open body fully rendered (not clipped)?
  const bodyInfo = await page.evaluate(() => {
    const c = document.querySelector("[data-li-card].is-open");
    if (!c) return null;
    const b = c.querySelector(".li-body").getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    return { cardH: Math.round(cr.height), bodyH: Math.round(b.height), bodyBottom: Math.round(b.bottom), cardBottom: Math.round(cr.bottom), fits: b.bottom <= cr.bottom + 1 };
  });
  console.log(`${tag} openBody=${JSON.stringify(bodyInfo)}`);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `/tmp/li3_${tag}_top.png` });
  await browser.close();
}

await run(390, 900, "phone");
await run(1400, 950, "desk");
