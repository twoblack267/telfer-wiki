// Proves the contact form's client logic actually behaves.
// Loads the BUILT page, runs its real module script, drives real events,
// and asserts each outcome. Network is stubbed so the test is deterministic.
import fs from "node:fs";
import { JSDOM } from "jsdom";

const html = fs.readFileSync("dist/contact/index.html", "utf8");
const script = [...html.matchAll(/<script[^>]*type="module"[^>]*>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .join("\n");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

function boot({ fetchImpl, waitMs = 3000 } = {}) {
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://telferwiki.com/contact/" });
  const { window } = dom;
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
  }));
  window.fetch = fetchImpl || (async () => { throw new Error("no fetch stub"); });
  window.navigator.clipboard = { writeText: async () => {} };
  // jsdom has no layout; make hidden/visible assertions rely on the attribute.
  window.eval(script);
  return window;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function submit(window) {
  const form = window.document.getElementById("contact-form");
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(60);
}

function fill(window, { name = "", email = "", message = "", honey = "" } = {}) {
  window.document.getElementById("contact-name").value = name;
  window.document.getElementById("contact-email").value = email;
  window.document.getElementById("contact-message").value = message;
  const h = window.document.getElementById("contact-website");
  if (h) h.value = honey;
}

console.log("\n=== 1. validation blocks an empty form ===");
{
  const w = boot();
  await submit(w);
  const res = w.document.getElementById("contact-result");
  const errs = [...w.document.querySelectorAll(".field-error")];
  ok("result panel shown", res.hidden === false);
  ok("all 3 field errors visible", errs.every((e) => e.hidden === false), `hidden=${errs.map((e) => e.hidden)}`);
  ok("fields marked aria-invalid", w.document.querySelectorAll('[aria-invalid="true"]').length === 3);
}

console.log("\n=== 2. bad email is rejected, good email accepted ===");
{
  const w = boot();
  fill(w, { name: "Jo", email: "not-an-email", message: "hello there" });
  await submit(w);
  ok("bad email flagged", w.document.getElementById("contact-email").getAttribute("aria-invalid") === "true");
  ok("name NOT flagged", w.document.getElementById("contact-name").getAttribute("aria-invalid") !== "true");
}
{
  const w = boot();
  fill(w, { name: "Jo", email: "jo@example.com.au", message: "hello there" });
  await submit(w);
  ok("valid email not flagged", w.document.getElementById("contact-email").getAttribute("aria-invalid") !== "true");
}

console.log("\n=== 3. honeypot silently accepts, sends nothing ===");
{
  let called = false;
  const w = boot({ fetchImpl: async () => { called = true; return { ok: true, json: async () => ({ success: true }) }; } });
  fill(w, { name: "Bot", email: "bot@spam.com", message: "buy pills", honey: "http://spam" });
  await submit(w);
  ok("fetch NOT called for a honeypot hit", called === false);
  ok("looks successful to the bot", /received/i.test(w.document.getElementById("contact-result").textContent));
}

console.log("\n=== 4. too-fast submit is refused ===");
{
  let called = false;
  const w = boot({ fetchImpl: async () => { called = true; return { ok: true, json: async () => ({ success: true }) }; } });
  fill(w, { name: "Jo", email: "jo@example.com", message: "hi" });
  await submit(w); // immediate
  ok("fetch NOT called (too fast)", called === false);
  ok("told to try again", /very quick/i.test(w.document.getElementById("contact-result").textContent));
}

console.log("\n=== 5. successful send shows confirmation and clears form ===");
{
  let sent = null;
  const w = boot({ fetchImpl: async (url, opts) => { sent = { url, body: JSON.parse(opts.body) }; return { ok: true, status: 200, json: async () => ({ success: true, message: "ok" }) }; } });
  fill(w, { name: "Jo Bloggs", email: "jo@example.com", message: "Looking for William Telfer" });
  // defeat the min-fill timer
  w.eval("Date.now = () => Number.MAX_SAFE_INTEGER");
  await submit(w);
  const t = w.document.getElementById("contact-result").textContent;
  ok("fetch called", sent !== null);
  ok("posted to web3forms", sent && sent.url === "https://api.web3forms.com/submit");
  ok("access_key sent", sent && sent.body.access_key === "e376665a-87bb-4379-8542-d6604d1e7031");
  ok("name/email/message all sent", sent && sent.body.name === "Jo Bloggs" && sent.body.email === "jo@example.com" && sent.body.message.includes("William"));
  ok("confirmation shown", /sent/i.test(t), t.slice(0, 80));
  ok("form cleared", w.document.getElementById("contact-name").value === "");
}

console.log("\n=== 6. network failure falls back to mailto WITH body encoded ===");
{
  const w = boot({ fetchImpl: async () => { throw new Error("blocked by client"); } });
  fill(w, { name: "Jo Bloggs", email: "jo@example.com", message: "A message that must not be lost" });
  w.eval("Date.now = () => Number.MAX_SAFE_INTEGER");
  await submit(w);
  const res = w.document.getElementById("contact-result");
  const link = res.querySelector("a");
  const href = link ? link.getAttribute("href") : "";
  ok("fallback panel shown", res.dataset.kind === "fallback");
  ok("offers a mailto link", href.startsWith("mailto:contact@telferwiki.com"));
  ok("mailto carries `body` (RFC 6068 legal)", href.includes("&body=") || href.includes("?body="));
  ok("body contains the actual message", href.includes(encodeURIComponent("A message that must not be lost")));
  ok("body contains the name", href.includes("Jo%20Bloggs"));
  ok("does NOT use illegal name=/message= keys", !/[?&]name=|[?&]message=/.test(href));
  ok("explains the message is not lost", /not<\/strong> been lost|not been lost/i.test(res.innerHTML));
}

console.log("\n=== 7. server error (non-200) also falls back ===");
{
  const w = boot({ fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ success: false, message: "This method is not allowed" }) }) });
  fill(w, { name: "Jo", email: "jo@example.com", message: "hello" });
  w.eval("Date.now = () => Number.MAX_SAFE_INTEGER");
  await submit(w);
  const res = w.document.getElementById("contact-result");
  ok("falls back on non-200", res.dataset.kind === "fallback");
}

console.log("\n=== 8. every unfilled field is announced, not just the first ===");
{
  const w = boot();
  fill(w, { name: "", email: "", message: "" });
  await submit(w);
  const announced = [...w.document.querySelectorAll(".field-error")].filter((e) => !e.hidden).length;
  ok("3 separate messages shown", announced === 3, `got ${announced}`);
}

console.log(`\n───────────────────────────────`);
console.log(fail === 0 ? `🎉 CONTACT FORM: ALL PASS (${pass} assertions)` : `❌ ${fail} FAILED of ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
