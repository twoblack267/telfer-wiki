import { chromium } from "playwright";

const URL = "http://127.0.0.1:4402/freedoms/";

async function run(w, h, tag) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(URL, { waitUntil: "networkidle" });

  const cards = page.locator("[data-li-card]");
  const n = await cards.count();
  console.log(`${tag} cards: ${n}`);

  // Collapsed geometry: each card's back face x, top, and how far its tab
  // pokes above the next card in its stack.
  const geo = await page.evaluate(() => {
    const stacks = Array.from(document.querySelectorAll(".li-stack"));
    const out = [];
    stacks.forEach((s, si) => {
      const cs = Array.from(s.querySelectorAll("[data-li-card]"));
      const rows = cs.map((c) => {
        const r = c.getBoundingClientRect();
        const tab = c.querySelector("[data-li-tab]").getBoundingClientRect();
        return {
          title: c.getAttribute("data-file").slice(0, 34),
          x: Math.round(r.x),
          w: Math.round(r.width),
          top: Math.round(r.top),
          h: Math.round(r.height),
          tabH: Math.round(tab.height),
          open: c.classList.contains("is-open"),
        };
      });
      out.push({ stack: si, rows });
    });
    return out;
  });

  for (const s of geo) {
    console.log(`-- ${tag} stack ${s.stack}`);
    for (let i = 0; i < s.rows.length; i++) {
      const r = s.rows[i];
      const next = s.rows[i + 1];
      const sliver = next ? r.top - (next.top + next.tabH) : null;
      console.log(
        `   x=${r.x} w=${r.w} h=${r.h} tab=${r.tabH} open=${r.open ? "Y" : "n"} sliverAbove=${sliver} | ${r.title}`
      );
    }
  }

  // Click behaviour: open a different card in the 2010s stack, prove exactly
  // one card is open afterwards.
  const stack2 = page.locator(".li-stack").nth(2);
  const target = stack2.locator("[data-li-card]").nth(1);
  await target.scrollIntoViewIfNeeded();
  await target.click();
  await page.waitForTimeout(350);

  const after = await page.evaluate(() => {
    const open = Array.from(document.querySelectorAll("[data-li-card].is-open"));
    const visibleBodies = Array.from(document.querySelectorAll(".li-card")).filter((c) => {
      const b = c.querySelector(".li-body");
      return b && getComputedStyle(b).display !== "none";
    });
    return {
      openCount: open.length,
      openTitles: open.map((c) => c.getAttribute("data-file").slice(0, 40)),
      bodyVisible: visibleBodies.length,
      allCardCount: document.querySelectorAll("[data-li-card]").length,
      openH: open[0] ? Math.round(open[0].getBoundingClientRect().height) : 0,
    };
  });
  console.log(`${tag} after click: ${JSON.stringify(after)}`);

  await page.screenshot({ path: `/tmp/li_${tag}_click.png`, fullPage: false });

  // Confirm every card still has a clickable sliver (>= 20px) when collapsed.
  const slivers = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll(".li-stack").forEach((s) => {
      const cs = Array.from(s.querySelectorAll("[data-li-card]"));
      // order in DOM: first is topmost; later cards are below
      for (let i = 0; i < cs.length - 1; i++) {
        const me = cs[i].getBoundingClientRect();
        const below = cs[i + 1].getBoundingClientRect();
        out.push({
          t: cs[i].getAttribute("data-file").slice(0, 26),
          peek: Math.round(below.top - me.top),
        });
      }
    });
    return out;
  });
  console.log(`${tag} peek-heights: ${JSON.stringify(slivers)}`);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `/tmp/li_${tag}_top.png` });
  await browser.close();
}

await run(390, 900, "phone");
await run(1400, 950, "desk");
