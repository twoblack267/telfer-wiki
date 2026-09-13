#!/usr/bin/env python3
"""
guard-absolute-paths.py  —  card tw-2026-09-13-022

SCOPE DECISION (verified 2026-09-13)
  The card named scripts/build-people-json.mjs, whose defect is FIXED (it now
  derives the vault from $HOME and refuses to run without
  SKIPPY_ALLOW_STALE_GENERATOR=1). The live generator is convert-markdown.mjs,
  which is clean.

  A naive scan reports 294 hits across 20 files, but they are NOT equivalent:
    * src/data/*.json            -> "vault_path" values. These are RECORDS of
                                    where a file lives, not code. NOT defects.
    * _pre-clean-*/, _archived/  -> historical snapshots. NOT live code.
    * one-shot fix-*.py scripts  -> not wired into package.json or
                                    regenerate-data.sh. Dead code, low risk.

  This guard therefore targets what actually matters: CODE that the live build
  executes. It FAILS on live code, and reports dead code as INFO only.

WHAT IT FLAGS (fails, exit 1)
  Hardcoded /home/<user>/ or /Users/<user>/ in a script reachable from:
    - package.json "scripts"
    - scripts/regenerate-data.sh
    - scripts/night-watch.sh

WHAT IT REPORTS BUT DOES NOT FAIL ON
  Hardcoded paths in unreferenced scripts (dead code) — printed as a list so
  the debt stays visible without blocking the build.

EXIT
  0 = live code clean
  1 = live code has hardcoded paths
  2 = fail closed (nothing scannable)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

ABS_RE = re.compile(r"/(?:home|Users)/[A-Za-z0-9._-]+/")

CODE_EXTS = (".py", ".mjs", ".js", ".ts", ".sh", ".bash", ".zsh")
SKIP_DIRS = (".git", "node_modules", "dist", ".astro", "src/data")


def is_comment(line: str) -> bool:
    s = line.strip()
    return s.startswith(("#", "//", "*", "/*", "<!--"))


def scan(path: str, verbose=False):
    out = []
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for i, line in enumerate(fh, 1):
                if not ABS_RE.search(line) or is_comment(line):
                    continue
                out.append((path, i, line.strip()[:110]))
    except OSError as e:
        print(f"WARN {path}: {e}", file=sys.stderr)
    return out


def live_scripts(repo: str) -> set:
    """Scripts reachable from package.json + documented harnesses."""
    live = set()

    pkg = os.path.join(repo, "package.json")
    if os.path.isfile(pkg):
        try:
            data = json.load(open(pkg))
            blob = " ".join((data.get("scripts") or {}).values())
            for m in re.finditer(r"(?:node|python3?)\s+(scripts/[A-Za-z0-9._/-]+)", blob):
                live.add(os.path.normpath(m.group(1)))
        except Exception as e:  # noqa: BLE001
            print(f"WARN: package.json unreadable ({e}) — refusing to guess",
                  file=sys.stderr)
            raise

    for harness in ("scripts/regenerate-data.sh", "scripts/night-watch.sh"):
        hp = os.path.join(repo, harness)
        if os.path.isfile(hp):
            live.add(os.path.normpath(harness))
            try:
                txt = open(hp, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            for m in re.finditer(r"(?:node|python3?)\s+\"?(scripts/[A-Za-z0-9._/-]+)",
                                 txt):
                live.add(os.path.normpath(m.group(1)))
    return live


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="*")
    ap.add_argument("--repo", default=os.getcwd())
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args()
    repo = os.path.abspath(args.repo)
    roots = args.paths or [repo]

    try:
        live = live_scripts(repo)
    except Exception:  # noqa: BLE001
        print("GUARD-ABS-PATHS FAIL: could not determine live scripts — refusing "
              "to pass", file=sys.stderr)
        return 2
    if not live:
        print("GUARD-ABS-PATHS FAIL: 0 live scripts discovered — refusing to pass",
              file=sys.stderr)
        return 2

    scanned = 0
    live_hits, dead_hits = [], []
    for root in roots:
        for dirpath, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for f in files:
                if not f.endswith(CODE_EXTS):
                    continue
                full = os.path.join(dirpath, f)
                rel = os.path.normpath(os.path.relpath(full, repo))
                scanned += 1
                hits = scan(full, args.verbose)
                if not hits:
                    continue
                (live_hits if rel in live else dead_hits).extend(hits)

    if scanned == 0:
        print("GUARD-ABS-PATHS FAIL: scanned 0 files — refusing to pass",
              file=sys.stderr)
        return 2

    print(f"[scope] live scripts reachable from build: {len(live)}")
    if dead_hits:
        by = {}
        for p, ln, t in dead_hits:
            by.setdefault(os.path.relpath(p, repo), []).append((ln, t))
        print(f"[info] {len(dead_hits)} hardcoded path(s) in {len(by)} UNREFERENCED "
              f"script(s) (debt, not blocking):")
        for p in sorted(by):
            print(f"   {p} ({len(by[p])})")

    if live_hits:
        print(f"\nGUARD-ABS-PATHS: {len(live_hits)} hardcoded path(s) in LIVE build "
              f"code (budget 0)", file=sys.stderr)
        for p, ln, t in live_hits:
            print(f"  {os.path.relpath(p, repo)}:{ln}  {t}", file=sys.stderr)
        print("\nFIX: derive from env, e.g. os.path.expanduser('~/...') or "
              "path.join(process.env.HOME, '...'); allow TELFER_VAULT_ROOT override.",
              file=sys.stderr)
        return 1

    print(f"\nGUARD-ABS-PATHS OK: scanned {scanned} file(s); live build code clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
