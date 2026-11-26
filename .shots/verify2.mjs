import { chromium } from "playwright";

const jobs = [
  ["phone1977", 390, 1100, "Twenty-four hours to change the law on marching"],
  ["desk1977", 1400, 1200, "Twenty-four hours to change the law on marching"],
  ["phonekill", 390, 1100, "The switch that needs no reason"],
  ["deskkill", 1400, 1200, "The switch that needs no reason"],
];

const browser = await chromium.launch();
for (const [name, w, h, title] of jobs) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const resp = await page.goto("http://127.0.0.1:4402/timeline/", { waitUntil: "networkidle" });
  const card = page.locator(".freedom-card", { hasText: title }).first();
  await card.waitFor({ state: "attached", timeout: 15000 });
  const box = await card.boundingBox();
  // what decade heading is this card's own row?
  const info = await card.evaluate((el) => {
    const cell = el.closest(".tl-free-cell");
    const row = cell ? cell.closest(".tl-row") : null;
    const head = row ? row.querySelector(":scope > .tl-dec, :scope > h2, :scope > .tl-cell h2") : null;
    let prev = row ? row.previousElementSibling : null;
    let headText = null, hops = 0;
    while (prev && hops < 3 && !headText) {
      const hh = prev.querySelector("h2, .tl-dec, .dec-head");
      if (hh) headText = hh.textContent.trim();
      prev = prev.previousElementSibling; hops++;
    }
    if (!headText && head) headText = head.textContent.trim();
    const r = el.getBoundingClientRect();
    let path = [];
    let n = el;
    for (let i = 0; i < 6 && n; i++) { path.push(n.className); n = n.parentElement; }
    return { headText, x: r.x, y: r.y + window.scrollY, path };
  });
  await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - 200)), box.y);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `/tmp/v2_${name}.png` });
  const col = Math.round(box.x / (w === 390 ? 130 : 465)) + 1;
  console.log(`${name} x=${Math.round(box.x)} y=${Math.round(info.y)} col=${col} head="${info.headText}" status=${resp.status()}`);
  console.log(`   path=${JSON.stringify(info.path)}`);
  await page.close();
}
const page = await browser.newPage({ viewport: { width: 390, height: 1100 } });
await page.goto("http://127.0.0.1:4402/timeline/", { waitUntil: "networkidle" });
const n = await page.locator(".freedom-card").count();
console.log(`freedom cards: ${n}`);
await browser.close();
