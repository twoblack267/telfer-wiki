import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 1100 } });
await p.goto("http://localhost:4402/timeline/", { waitUntil: "networkidle" });
await p.waitForTimeout(600);
const info = await p.evaluate(() => {
  const c = document.querySelector(".freedom-card.tone-sage");
  let node = c, chain = [];
  for (let i=0;i<6 && node;i++){ chain.push(node.tagName+"."+node.className); node=node.parentElement; }
  // find the decade label nearest above
  const row = c.closest(".tl-grid") ? c.closest(".tl-grid").parentElement : null;
  const labels = row ? [...row.querySelectorAll("*")].map(e=>e.textContent.trim()).filter(t=>/^\d{4}s$/.test(t)) : [];
  // all decade labels in page order with their y
  const decs = [...document.querySelectorAll("*")].filter(e=>e.children.length===0 && /^\d{4}s$/.test(e.textContent.trim())).map(e=>({t:e.textContent.trim(), y:Math.round(e.getBoundingClientRect().top+window.scrollY), cls:e.className}));
  const cy = Math.round(c.getBoundingClientRect().top+window.scrollY);
  return {chain, cy, decs: decs.slice(-6)};
});
console.log(JSON.stringify(info,null,1));
await b.close();
