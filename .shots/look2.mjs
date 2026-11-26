import { chromium } from "playwright";
const b = await chromium.launch();
for (const [name, w, h] of [["desk", 1400, 1000], ["phone", 390, 900]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await p.goto("http://127.0.0.1:4402/timeline/", { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  const st = await p.evaluate(() => {
    const all = Array.from(document.querySelectorAll("[data-fcard]"));
    const open = all.filter((c) => !c.querySelector("[data-fbody]").hidden);
    const c0 = all[0]?.getBoundingClientRect(), t0 = all[0]?.querySelector("[data-ftab]")?.getBoundingClientRect();
    return { cards: all.length, openCount: open.length,
      cardW: c0 ? Math.round(c0.width) : 0, cardH: c0 ? Math.round(c0.height) : 0,
      tabH: t0 ? Math.round(t0.height) : 0 };
  });
  console.log(name, JSON.stringify(st));
  const el = await p.$("[data-fcard]");
  if (el) { await el.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
    const bx = await el.boundingBox();
    await p.screenshot({ path: `/tmp/L_${name}_closed.png`, clip: { x: Math.max(0,bx.x-40), y: Math.max(0,bx.y-40), width: Math.min(w, 420), height: 300 } });
    await p.click("[data-ftab]"); await p.waitForTimeout(500);
    const bx2 = await el.boundingBox();
    await p.screenshot({ path: `/tmp/L_${name}_open.png`, clip: { x: Math.max(0,bx2.x-40), y: Math.max(0,bx2.y-40), width: Math.min(w, 460), height: 340 } });
  }
  await p.close();
}
await b.close();
