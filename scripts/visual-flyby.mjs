#!/usr/bin/env node
/**
 * visual-flyby.mjs
 * Night Watch flyby — screenshots the deployed site on desktop + mobile and
 * reports whether key pages render (no 404, meaningful content).
 *
 * Safe: read-only against the LIVE site. Does NOT change any source/data.
 * Uses the Playwright Chromium venv at ~/Developer/browser-tool/.venv
 * (installed by agent-browser-setup). If Playwright is unavailable it exits
 * 0 with a note (flyby is advisory, never blocks the push).
 *
 * Exit codes:
 *   0  = all pages OK (or flyby skipped — advisory only)
 *   1  = a key page 404'd or returned near-empty content
 */
import { spawnSync } from 'child_process';
import path from 'path';
import os from 'os';

const SITE = process.env.FLYBY_SITE || 'https://telferwiki.com';
const VENV_PY = path.join(os.homedir(), 'Developer/browser-tool/.venv/bin/python');
const SNAP = path.join(os.homedir(), '.hermes/flyby');   // scratch dir for shots (gitignored)
const CACHE = path.join(os.homedir(), 'Developer/browser-tool/profile');

// Pages to verify on both viewports. Person page = real known slug.
const PAGES = [
  ['home',   `${SITE}/`],
  ['tree',   `${SITE}/people/full-tree`],
  ['person', `${SITE}/people/mark-telfer-1986`],
];
const VIEWPORTS = [['desktop', 1280, 900], ['mobile', 390, 844]];

// Build a self-contained Playwright driver script (run under the venv python).
const driver = `
import pathlib, sys
from playwright.sync_api import sync_playwright
SITE = ${JSON.stringify(SITE)}
SNAP = pathlib.Path(${JSON.stringify(SNAP)}); SNAP.mkdir(parents=True, exist_ok=True)
CACHE = ${JSON.stringify(CACHE)}
PAGES = ${JSON.stringify(PAGES)}
VIEWPORTS = ${JSON.stringify(VIEWPORTS)}
fails = []
ok = 0
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(user_data_dir=CACHE, headless=True, locale="en-AU")
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    for vname, w, h in VIEWPORTS:
        page.set_viewport_size({"width": w, "height": h})
        for pname, url in PAGES:
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=40000)
                page.wait_for_timeout(1500)
                title = (page.title() or "").strip().lower()
                body = len(page.evaluate("() => (document.body? document.body.innerText : '')"))
                shot = SNAP / f"{vname}_{pname}.png"
                page.screenshot(path=str(shot), full_page=False)
                # A 404/500 page -> title contains 'not found' or body near-empty
                bad_title = "not found" in title or "error" in title
                bad_body = body < 60
                if bad_title or bad_body:
                    fails.append(f"{vname}/{pname}: title={title!r} bodylen={body}")
                else:
                    ok += 1
                    print(f"OK  {vname:8}{pname:7} {body}b -> {shot.name}")
            except Exception as e:
                fails.append(f"{vname}/{pname}: EXC {e}")
    ctx.close()
print(f"RESULT ok={ok} fails={len(fails)}")
for f in fails: print("FAIL " + f)
sys.exit(1 if fails else 0)
`;

const r = spawnSync(VENV_PY, ['-c', driver], { encoding: 'utf8', timeout: 120000, env: { ...process.env } });

// If Playwright/venv missing, treat as advisory skip (don't break the Night Watch push).
if (r.error && (r.error.code === 'ENOENT')) {
  console.log('  🔵 Visual flyby skipped — Playwright venv not available (advisory step)');
  process.exit(0);
}
const out = (r.stdout || '') + (r.stderr || '');
console.log(out.split('\n').map(l => '  ' + l).join('\n'));
process.exit(r.status === 0 ? 0 : 1);
