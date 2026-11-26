import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 1100 } });
await page.goto("http://127.0.0.1:4402/timeline/", { waitUntil: "networkidle" });
// top of the kill-switch card, with its restamp heading in shot
const card = page.locator(".freedom-card", { hasText: "The switch that needs no reason" }).first();
const box = await card.boundingBox();
await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - 300)), box.y);
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/v2_phonekill_top.png" });
// also: what decade headings exist and where
const heads = await page.$$eval("h2", (els) =>
  els.map((e) => ({ t: e.textContent.trim(), y: Math.round(e.getBoundingClientRect().y + window.scrollY) }))
     .filter((o) => /^\d{4}s$/.test(o.t))
);
console.log("cardY", Math.round(box.y));
console.log(JSON.stringify(heads.filter(h => h.y > box.y - 3000 && h.y < box.y + 1500)));
await browser.close();
