import { chromium } from "playwright";
const b = await chromium.launch();
for (const [nm,W,H] of [["phone",390,844],["desk",1400,1000]]) {
  const p = await b.newPage({ viewport:{width:W,height:H}, deviceScaleFactor:2 });
  await p.goto("http://127.0.0.1:4402/timeline/",{waitUntil:"networkidle"});
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll("[data-fcard]").forEach(c => {
      const t = c.querySelector(".ftab-title");
      const cr = c.getBoundingClientRect(), tr = t.getBoundingClientRect();
      out.push({
        w: Math.round(cr.width), h: Math.round(cr.height),
        title: t.textContent.trim(),
        // does the title text spill past its own box?
        overflows: t.scrollWidth > t.clientWidth + 1 || tr.right > cr.right + 1,
        tabH: Math.round(c.querySelector("[data-ftab]").getBoundingClientRect().height)
      });
    });
    return out;
  });
  const w = [...new Set(r.map(x=>x.w))], over = r.filter(x=>x.overflows);
  const multi = r.filter(x=>x.tabH > 30);
  console.log(nm, "widths="+JSON.stringify(w), "overflows="+over.length,
    "tallerTabs="+multi.length, "maxTabH="+Math.max(...r.map(x=>x.tabH)));
  if (over.length) console.log("  SPILL:", JSON.stringify(over.map(x=>x.title)));
  if (nm==="phone") console.log("  samples:", JSON.stringify(r.slice(0,3)));
  await p.close();
}
await b.close();
