import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 1100 } });
await p.goto("http://localhost:4402/timeline/", { waitUntil: "networkidle" });
await p.waitForTimeout(600);
await p.evaluate(() => window.scrollTo(0, 88800));
await p.waitForTimeout(400);
await p.screenshot({ path: "/tmp/phone_dec.png" });
await b.close();
