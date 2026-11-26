import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 1100 } });
await p.goto("https://telferwiki.com/timeline/", { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
const y = await p.evaluate(() => {
  const c = [...document.querySelectorAll(".freedom-card")].find(e=>e.textContent.includes("One complaint"));
  return c ? Math.round(c.getBoundingClientRect().top + window.scrollY) : -1;
});
console.log("y", y);
await p.evaluate((yy)=>window.scrollTo(0, yy-820), y);
await p.waitForTimeout(500);
await p.screenshot({ path: "/tmp/live_sage.png" });

await p.setViewportSize({ width: 1400, height: 1000 });
await p.waitForTimeout(500);
await p.evaluate((yy)=>window.scrollTo(0, yy-300), y);
await p.waitForTimeout(500);
await p.screenshot({ path: "/tmp/live_sage_desk.png" });
await b.close();
