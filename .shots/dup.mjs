import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto("http://127.0.0.1:4402/timeline/", { waitUntil: "networkidle" });
await page.waitForTimeout(500);
const d = await page.evaluate(() => {
  const cells = Array.from(document.querySelectorAll(".tl-cell h2")).map((h) => h.textContent.trim());
  const seen = {}, dup = [];
  cells.forEach((t) => { seen[t] = (seen[t] || 0) + 1; });
  Object.entries(seen).forEach(([k, v]) => { if (v > 1) dup.push(`${k} x${v}`); });
  // are dupes actually two elements, or one sticky?
  const first = Array.from(document.querySelectorAll(".tl-cell h2")).slice(0, 6).map((h) => {
    const r = h.getBoundingClientRect();
    return { t: h.textContent.trim(), y: Math.round(r.y), parent: h.closest(".tl-cell")?.className, sticky: getComputedStyle(h).position };
  });
  return { total: cells.length, dup, first, uniq: Object.keys(seen).length };
});
console.log(JSON.stringify(d, null, 1));
await browser.close();
