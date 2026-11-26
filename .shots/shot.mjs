import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 900 } });
await p.goto("http://localhost:4402/timeline/", { waitUntil: "networkidle" });
await p.waitForTimeout(800);
const el = await p.$(".freedom-card.tone-sage");
if (el) { await el.scrollIntoViewIfNeeded(); await p.waitForTimeout(400); }
const box = el ? await el.boundingBox() : null;
console.log("sage box", JSON.stringify(box));
await p.screenshot({ path: "/tmp/phone_sage.png", fullPage: false });
await p.setViewportSize({ width: 1400, height: 1000 });
await p.waitForTimeout(400);
if (el) await el.scrollIntoViewIfNeeded();
await p.waitForTimeout(400);
await p.screenshot({ path: "/tmp/desk_sage.png", fullPage: false });
// text check of card widths not overlapping
const ok = await p.evaluate(() => document.querySelectorAll(".freedom-card").length);
console.log("freedom cards:", ok);
await b.close();
