#!/usr/bin/env python3
"""Send Telfer Wiki update notification to family members — only when content has changed."""

import hashlib
import json
import os
import smtplib
import ssl
import subprocess
import sys
import tomllib
from email.message import EmailMessage

# ─── Configuration ───
SITE_URL = "https://marktelfer-telfer.github.io/telfer-wiki/"
PEOPLE_JSON = os.path.join(os.path.dirname(__file__), "..", "src", "data", "people.json")
SENTINEL_FILE = os.path.join(os.path.dirname(__file__), "..", ".last-notification-hash")

RECIPIENTS = {
    "Tim Telfer":   "timmytelfer@gmail.com",
    "Amy Telfer":   "Amynicoletelfer@hotmail.com",
    "Sheryle Telfer": "sheryle.telfer@gmail.com",
}

SUBJECT = "🌳 Telfer Family Wiki — Updated!"

BODY_TEMPLATE = """G'day,

Mark here (via Skippy). The Telfer Family Wiki has been updated!

🌳 {site_url}

Current stats:
• {count} family profiles
• Interactive timeline
• Searchable people directory
• Mobile-friendly layout

I've been working with an AI assistant to build this from scratch. Check it out and let me know if anything's wrong or missing!

Cheers,
Mark Telfer
"""


def compute_hash():
    """SHA-256 hash of the sorted people.json content for change detection."""
    with open(PEOPLE_JSON) as f:
        data = json.load(f)
    raw = json.dumps(data, sort_keys=True, ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()


def read_last_hash():
    if not os.path.exists(SENTINEL_FILE):
        return None
    with open(SENTINEL_FILE) as f:
        return f.read().strip()


def write_last_hash(h):
    with open(SENTINEL_FILE, "w") as f:
        f.write(h + "\n")


def has_changed():
    current = compute_hash()
    last = read_last_hash()
    changed = current != last
    if not changed:
        print(f"⏭️  No changes since last notification (hash: {current[:12]}…). Skipping.")
    return changed


def get_smtp_config(account="main"):
    """Read SMTP config from Himalaya's config.toml."""
    config_path = "/home/mark/.config/himalaya/config.toml"
    with open(config_path, "rb") as f:
        config = tomllib.load(f)
    return config["accounts"][account]["message"]["send"]["backend"]


def get_profile_count():
    """Return the number of profiles in people.json."""
    with open(PEOPLE_JSON) as f:
        data = json.load(f)
    return len(data)


def send_email(to_name, to_addr, smtp_cfg, count):
    """Send one email via SMTP."""
    msg = EmailMessage()
    msg["From"] = "Mark Telfer <twoblackbots@gmail.com>"
    msg["To"] = to_addr
    msg["Subject"] = SUBJECT
    body = BODY_TEMPLATE.format(site_url=SITE_URL, count=count)
    msg.set_content(body)

    passwd = subprocess.check_output(smtp_cfg["auth"]["cmd"], shell=True).decode().strip()
    ctx = ssl.create_default_context()

    with smtplib.SMTP(smtp_cfg["host"], smtp_cfg["port"]) as server:
        server.starttls(context=ctx)
        server.login(smtp_cfg["login"], passwd)
        server.send_message(msg)

    print(f"✓ Sent to {to_name} <{to_addr}>")


def main():
    if not has_changed():
        return 0

    count = get_profile_count()
    smtp_cfg = get_smtp_config()
    success = 0
    failed = 0

    for name, addr in RECIPIENTS.items():
        try:
            send_email(name, addr, smtp_cfg, count)
            success += 1
        except Exception as e:
            print(f"✗ FAILED to send to {name} <{addr}>: {e}", file=sys.stderr)
            failed += 1

    print(f"\nDone. {success} sent, {failed} failed.")

    if failed == 0 and success > 0:
        write_last_hash(compute_hash())
        print(f"📝 Updated sentinel hash.")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
