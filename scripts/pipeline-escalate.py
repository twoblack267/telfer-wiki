#!/usr/bin/env python3
"""
pipeline-escalate.py — "NEVER AGAIN" guard for the telfer-wiki data pipeline.

WHAT THIS IS
  The single, loud escalation path for ANY telfer-wiki pipeline failure. When a
  gate fails — locally at rebuild time, or in CI — THIS script files a repair
  ticket on Mark's Can Do Board so the failure cannot be silently absorbed.
  A silent degradation is the actual bug this exists to kill.

WHY IT EXISTS
  The relationship resolver silently discarded ~93% of family links while every
  build reported success. Nothing failed, so nobody was told, so it rotted for
  weeks. This makes that class of failure impossible: a failure now leaves a
  ticket behind, with evidence, every single time.

DESIGN RULES (deliberate, do not "simplify" away)
  1. A failed escalation MUST NOT fail the build. If a gate exits 3 (filed) or 4
     (escalation itself broken) the pipeline records RED and moves on. The board
     is the human notification channel; blocking the build again on top of a
     failure would be a second failure with no upside.
  2. NEVER file anonymously. Every card carries the failing gate, the exit status
     and a machine-readable fingerprint, so a card can be corroborated and the
     same failure never storms the board twice (see --ok).
  3. The task/board writes go through kanban-file-ticket.py — never hand-edited
     YAML. That helper takes an exclusive lock, moves the board to the tasks/
     store atomically-ish, and re-parses the board to refuse a corrupt write.
  4. The board store lives outside the wiki repo by default. When this runs in CI
     there is no ~/.hermes/kanban, so the job writes a JSON artifact and the
     local "CI Mechanic" cron files the real card from it.

USAGE
  # local rebuild round-trip (preflight, then pipeline, then escalate on failure)
  python3 scripts/pipeline-escalate.py --run ./scripts/regenerate-data.sh

  # local gates only (preflight, npm run validate, scan-cross-branch)
  python3 scripts/pipeline-escalate.py

  # CI: a step already failed (or a log was captured) — never fail the job again
  python3 scripts/pipeline-escalate.py --from-exit 1 --gate "npm run build" \
      --log-file build.log --allow-missing-deps

  # CI one-shot (what validate-data.yml / deploy.yml actually run): the repo is on
  # GITHUB_WORKSPACE, so the board store ~/.hermes/kanban does NOT exist here. ntfy
  # is pinged instead, and the local "CI Mechanic" cron turns that into the real
  # board card. A failed ping stands as a red build, nothing more.
  python3 scripts/ci-escalate.py

  # suppress the board write for a known failure
  python3 scripts/pipeline-escalate.py --ok "gate=npm run validate;exit=1"

EXIT CODES
  0  gates passed, or the failure was suppressed with --ok
  1  a gate failed and a ticket was filed
  2  usage error (bad arguments / no board store)
  3  a gate failed and the ticket COULD NOT be filed (escalation itself broken)
  4  a gate failed and filing was suppressed/unavailable, and we refuse to
     pretend otherwise (see --allow-missing-deps)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import textwrap
import time
from datetime import datetime, timezone

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILER = os.environ.get(
    "KANBAN_FILER", os.path.expanduser("~/.hermes/scripts/kanban-file-ticket.py")
)
BOARD_DIR = os.path.expanduser("~/.hermes/kanban")
STATE_DIR = os.path.join(BOARD_DIR, "escalations")

SOURCE = "pipeline-escalate.py (telfer-wiki never-again guard)"

# Log fingerprint tricks: timestamps/absolute paths/hashes vary run to run and
# would make every repeated failure look like a new one.
_STRIP_PATTERNS = [
    (re.compile(r"\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b"), "<ts>"),
    (re.compile(r"\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b"), "<time>"),
    (re.compile(r"\b\d{10,13}\b"), "<num>"),
    (re.compile(r"\b[0-9a-f]{7,64}\b", re.I), "<hash>"),
    (re.compile(r"/Users/[^ \n\"']+"), "<abs>"),
    (re.compile(r"/home/[^ \n\"']+"), "<abs>"),
    (re.compile(r"/tmp/[^ \n\"']+"), "<abs>"),
]

# A failing log is often hundreds of lines; the ticket needs the shape, not the bulk.
MAX_LOG_CHARS = 2400
MAX_FIELD_CHARS = 1800


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run(cmd, cwd=None, timeout=1800, env=None, merge_stderr=True):
    """Run a command, capture combined output, never raise on non-zero."""
    if isinstance(cmd, str):
        cmd = shlex.split(cmd)
    started = time.time()
    try:
        proc = subprocess.run(
            cmd,
            cwd=cwd,
            timeout=timeout,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT if merge_stderr else subprocess.PIPE,
            text=True,
            errors="replace",
        )
        return proc.returncode, proc.stdout or "", time.time() - started
    except FileNotFoundError as exc:
        return 127, f"COMMAND NOT FOUND: {exc}\n", time.time() - started
    except subprocess.TimeoutExpired as exc:
        partial = (exc.stdout or "") if isinstance(exc.stdout, str) else ""
        return 124, f"TIMEOUT after {timeout}s\n{partial}", time.time() - started


def normalise_log(text: str) -> str:
    """Strip run-to-run noise so the same failure fingerprints the same."""
    out = text or ""
    for pat, repl in _STRIP_PATTERNS:
        out = pat.sub(repl, out)
    out = re.sub(r"[ \t]+", " ", out)
    out = re.sub(r"\n{2,}", "\n", out)
    return out.strip()


def fingerprint(gate: str, log: str) -> str:
    """Stable short id for THIS failure, so repeat failures don't storm the board."""
    basis = f"{gate}\n{normalise_log(log)[:2000]}".encode("utf-8", "replace")
    return hashlib.sha256(basis).hexdigest()[:12]


def tail_lines(text: str, limit: int = MAX_LOG_CHARS) -> str:
    """Prefer the END of a log (that is where npm/node put the real error)."""
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    head = text[: limit // 4]
    return f"...[truncated {len(text) - limit} chars]...\n{head}\n...\n{text[-(limit - len(head)):]}"


def one_line(text: str, limit: int) -> str:
    """Collapse to a single board-safe line: no newlines, no double quotes."""
    flat = re.sub(r"\s+", " ", (text or "")).strip().replace('"', "'")
    return flat[:limit]


def state_path(fp: str) -> str:
    return os.path.join(STATE_DIR, f"{fp}.json")


def already_filed(fp: str) -> dict | None:
    p = state_path(fp)
    if os.path.isfile(p):
        try:
            with open(p, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except Exception:  # noqa: BLE001 - unreadable state = treat as not filed
            return None
    return None


def record_state(fp: str, payload: dict) -> None:
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(state_path(fp), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, sort_keys=True)


def filer_available() -> bool:
    if not os.path.isfile(FILER):
        return False
    try:
        os.makedirs(BOARD_DIR, exist_ok=True)
    except OSError:
        return False
    return os.access(BOARD_DIR, os.W_OK)


# --------------------------------------------------------------------------
# Board filing
# --------------------------------------------------------------------------


def build_ticket(gate, exit_code, log, cmd, when_iso, reason):
    fp = fingerprint(gate, log)
    tail = tail_lines(log)
    severity = "high" if (exit_code not in (0,) or gate.startswith("npm run build")) else "medium"

    title = f"telfer-wiki pipeline failure: {gate} exited {exit_code} [{fp}]"

    description = textwrap.dedent(
        f"""
        The telfer-wiki data pipeline FAILED and reported RED. Filed automatically
        by the never-again guard so the failure cannot be silently absorbed.

        gate: {gate}
        command: {cmd or "(external / CI step)"}
        exit status: {exit_code}
        when: {when_iso}
        fingerprint: {fp}
        detected by: {reason}

        A quiet failure is the original defect this guard exists for: for weeks the
        relationship resolver discarded ~93% of family links and EVERY build still
        reported success, so nobody was told. Numbers go stale the moment a card is
        filed — RE-DERIVE every claim below against the real system before acting
        on it.

        ---- captured evidence (tail, normalised) ----
        {tail}
        """
    ).strip()
    description = one_line(description.replace("\n", " | "), MAX_FIELD_CHARS)

    action = textwrap.dedent(
        f"""
        1. Re-run the gate by hand and capture the real failure:
             cd {os.path.expanduser("~/telfer-wiki")} && {cmd or "<the failing CI step>"}
        2. If the failure is transient red (network, npm registry, flaky fetch),
           re-run once and record the observed result. Do NOT close the card on an
           assumption: cite the passing run.
        3. If the failure is real, fix the cause. The known open class for this
           pipeline is the relationship resolver discarding links whose reference
           carries a full lifespan while the target id only carries a birth year
           (tracked as tw-2026-09-12-011; `node scripts/validate-resolver-coverage.mjs`
           prints the live figure and writes .resolver-coverage.json — read THAT,
           never a number quoted in a ticket, which is stale the moment it is filed).
        4. Add/extend the guard so THIS specific failure fails the build loudly and
           files its own ticket, then close this card with the passing run cited.

        Escalation is automatic and idempotent: failure fingerprint {fp} is recorded
        in {STATE_DIR}/{fp}.json, so the same failure will not file a second card.
        Clear that state file to re-arm.
        """
    ).strip()

    return fp, title, description, one_line(action.replace("\n", " | "), MAX_FIELD_CHARS), severity


def file_ticket(title, description, action, severity, dry_run=False, ci_artifact=None):
    """File via kanban-file-ticket.py. Returns (ok, detail)."""
    if dry_run:
        return True, "dry-run"

    if ci_artifact:
        os.makedirs(os.path.dirname(ci_artifact), exist_ok=True)
        with open(ci_artifact, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "filed_at": now_iso(),
                    "title": title,
                    "severity": severity,
                    "description": description,
                    "suggested_action": action,
                    "source": SOURCE,
                },
                fh,
                indent=2,
            )
        return True, f"ci-artifact:{ci_artifact}"

    os.makedirs(os.path.expanduser("~/.hermes/tmp"), exist_ok=True)
    tmpd = os.path.expanduser("~/.hermes/tmp")
    with tempfile.NamedTemporaryFile("w", suffix=".desc", dir=tmpd, delete=False) as df, \
         tempfile.NamedTemporaryFile("w", suffix=".act", dir=tmpd, delete=False) as af:
        df.write(description)
        af.write(action)
        desc_path, act_path = df.name, af.name

    try:
        code, out, _ = run(
            [
                sys.executable,
                FILER,
                "--title", title,
                "--severity", severity,
                "--description-file", desc_path,
                "--action-file", act_path,
                "--source", SOURCE,
            ],
            timeout=180,
        )
    finally:
        for p in (desc_path, act_path):
            try:
                os.unlink(p)
            except OSError:
                pass

    if code != 0:
        return False, f"filer exit {code}: {out.strip()[:400]}"
    m = re.search(r"(tw-\d{4}-\d{2}-\d{2}-\d{3})", out)
    return True, (m.group(1) if m else out.strip()[:200])


# --------------------------------------------------------------------------
# Gate definitions
# --------------------------------------------------------------------------


def gates_default():
    return [
        {
            "gate": "preflight:required-inputs",
            "cmd": None,
            "kind": "preflight",
            "why": "confirm the pipeline's own inputs exist before blaming a stage",
        },
        {"gate": "npm run validate", "cmd": ["npm", "run", "validate"], "kind": "run",
         "why": "data integrity + cross-branch contamination"},
        {"gate": "scripts/scan-cross-branch.mjs", "cmd": ["node", "scripts/scan-cross-branch.mjs"],
         "kind": "run", "why": "same-name branch-leak assertions"},
        {"gate": "scripts/validate-no-mark-refs.py", "cmd": ["python3", "scripts/validate-no-mark-refs.py", "src/data/"],
         "kind": "run", "why": "no first-person Mark references in published data"},
    ]


REQUIRED_INPUTS = [
    "src/data/people.json",
    "src/data/people.public.json",
    "src/data/vault-manifest.json",
    "scripts/build-relationship-graph.mjs",
    "scripts/convert-markdown.mjs",
    "scripts/validate-no-mark-refs.py",
    "package.json",
]


def check_preflight():
    missing = [p for p in REQUIRED_INPUTS if not os.path.exists(os.path.join(REPO, p))]
    if not missing:
        return 0, "all required inputs present"
    # python may be shimmed as `python` only on some hosts
    return 2, "MISSING PIPELINE INPUTS: " + ", ".join(missing)


def run_gates(only=None, extra_env=None):
    """Run every gate; return list of failures (never stops at the first)."""
    failures = []
    env = dict(os.environ)
    env.setdefault("CI", "1")
    if extra_env:
        env.update(extra_env)

    def record(gate, why, code, log, cmd):
        if code == 0:
            print(f"  PASS  {gate}")
            return
        print(f"  FAIL  {gate}  (exit {code})")
        failures.append({"gate": gate, "why": why, "code": code, "log": log,
                         "cmd": cmd, "kind": "run"})

    code, log = check_preflight()
    record("preflight:required-inputs", "pipeline inputs", code,
           log, "python3 scripts/pipeline-escalate.py --preflight-only")

    for g in gates_default():
        if g["kind"] == "preflight":
            continue
        if only and g["gate"] not in only:
            continue
        code, out, _ = run(g["cmd"], cwd=REPO, env=env, timeout=1800)
        record(g["gate"], g["why"], code, out, " ".join(g["cmd"]))
    return failures


def run_pipeline(cmd):
    """Run the real pipeline (e.g. regenerate-data.sh) and capture everything."""
    print(f"  RUN   $ {cmd}")
    code, out, secs = run(cmd, cwd=REPO, timeout=3600)
    print(f"  {'PASS' if code == 0 else 'FAIL'}  pipeline exited {code} in {secs:.1f}s")
    return {"gate": f"pipeline: {cmd}", "why": "full data regeneration", "code": code,
            "log": out, "cmd": cmd, "kind": "run"}


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description="telfer-wiki never-again pipeline guard")
    ap.add_argument("--run", metavar="CMD", help="full pipeline command to execute first")
    ap.add_argument("--skip-gates", action="store_true", help="only run --run, skip local gates")
    ap.add_argument("--preflight-only", action="store_true")
    ap.add_argument("--from-exit", type=int, default=None,
                    help="a step already failed with this exit status (CI mode)")
    ap.add_argument("--gate", default="pipeline", help="name of the step that failed")
    ap.add_argument("--log-file", default=None, help="file containing the failing step's output")
    ap.add_argument("--reason", default="detected by pipeline-escalate.py",
                    help="how the failure was detected")
    ap.add_argument("--ok", action="append", default=[],
                    help="suppress filing: 'gate=<name>;exit=<n>'")
    ap.add_argument("--dry-run", action="store_true", help="build the ticket, print it, file nothing")
    ap.add_argument("--allow-missing-deps", action="store_true",
                    help="CI: no board store reachable — write a JSON artifact instead of failing")
    ap.add_argument("--ci-artifact", default=os.environ.get("ESCALATION_ARTIFACT"),
                    help="path to write the ticket JSON when no board store exists")
    args = ap.parse_args()

    os.chdir(REPO)
    print(f"pipeline-escalate.py @ {now_iso()}  repo={REPO}")

    if args.preflight_only:
        code, log = check_preflight()
        print(("PASS  " if code == 0 else "FAIL  ") + log)
        return 0 if code == 0 else 1

    failures = []
    if args.from_exit is not None:
        log = ""
        if args.log_file and os.path.isfile(args.log_file):
            with open(args.log_file, "r", encoding="utf-8", errors="replace") as fh:
                log = fh.read()
        if args.from_exit != 0:
            failures.append({"gate": args.gate, "why": args.reason, "code": args.from_exit,
                             "log": log, "cmd": args.gate, "kind": "external"})
    else:
        if args.run:
            pipeline = run_pipeline(args.run)
            if pipeline["code"] != 0:
                failures.append(pipeline)
                # A failed regeneration invalidates the gates' inputs; running them
                # anyway produces noise, not information. Skip.
                args.skip_gates = True
        if not args.skip_gates:
            failures.extend(run_gates())

    if not failures:
        print("RESULT: all gates PASSED — nothing to escalate.")
        return 0

    # Suppression check
    suppressed = []
    for spec in args.ok:
        parts = dict(p.split("=", 1) for p in spec.split(";") if "=" in p)
        for f in failures:
            if f["gate"] == parts.get("gate") and str(f["code"]) == parts.get("exit"):
                suppressed.append(f)
    real = [f for f in failures if f not in suppressed]
    if suppressed:
        print(f"SUPPRESSED by --ok: {[f['gate'] for f in suppressed]}")
    if not real:
        print("RESULT: all failures suppressed — nothing filed.")
        return 0

    # File one card per distinct failure, idempotent on fingerprint.
    filed_ids, skipped, broken = [], [], []
    for f in real:
        fp, title, desc, action, sev = build_ticket(
            gate=f["gate"], exit_code=f["code"], log=f["log"], cmd=f["cmd"],
            when_iso=now_iso(), reason=f["why"],
        )
        prev = already_filed(fp)
        if prev and prev.get("status") == "filed":
            print(f"  KNOWN {f['gate']} (fingerprint {fp}) already filed as {prev.get('ticket')}")
            skipped.append((fp, prev.get("ticket")))
            continue

        if args.dry_run:
            print("\n--- DRY RUN TICKET -------------------------------------------------")
            print(f"fingerprint: {fp}\nseverity: {sev}\ntitle: {title}\n")
            print(desc[:1200])
            print("...")
            continue

        if not filer_available() and not args.ci_artifact:
            msg = (f"no board store / filer at {FILER} — cannot file {f['gate']} "
                   f"(exit {f['code']})")
            if args.allow_missing_deps:
                ok, detail = file_ticket(title, desc, action, sev, ci_artifact=None)
                print(f"  CI    {msg}; ticket handed off via {detail}")
                record_state(fp, {"status": "handed-off", "gate": f["gate"], "exit": f["code"],
                                  "at": now_iso(), "detail": detail})
                filed_ids.append(fp)
                continue
            print(f"  BROKEN {msg}")
            broken.append((fp, msg))
            continue

        ok, detail = file_ticket(title, desc, action, sev, ci_artifact=args.ci_artifact)
        if ok:
            print(f"  FILED {f['gate']} -> {detail}")
            record_state(fp, {"status": "filed", "ticket": detail, "gate": f["gate"],
                              "exit": f["code"], "at": now_iso()})
            filed_ids.append(detail)
        else:
            print(f"  BROKEN could not file {f['gate']}: {detail}")
            broken.append((fp, detail))

    print()
    print(f"RESULT: {len(real)} failure(s); filed={len(filed_ids)} known={len(skipped)} broken={len(broken)}")
    for fp, ticket in skipped:
        print(f"  known: {ticket or '(unrecorded)'}  fingerprint {fp}")

    if broken:
        # The red state stands (CI/run already knows), but escalation is broken and
        # that must be visible in the exit status too.
        return 3
    if filed_ids or skipped:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
