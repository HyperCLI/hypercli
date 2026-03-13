#!/usr/bin/env python3
"""Fetch Privy OTP code from IMAP inbox.

Usage:
  python3 e2e/fetch-otp.py [--timeout 30]

Env:
  IMAP_HOST  (default: imap.fastmail.com)
  IMAP_USER  (default: agent@nedos.io)
  IMAP_PASS  (required)

Prints the 6-digit OTP code to stdout. Exits 1 if not found within timeout.
"""

import imaplib
import email
import email.utils
import re
import sys
import time
import os

IMAP_HOST = os.environ.get("IMAP_HOST", "imap.fastmail.com")
IMAP_USER = os.environ.get("IMAP_USER", "agent@nedos.io")
IMAP_PASS = os.environ.get("IMAP_PASS", "")
TIMEOUT = int(sys.argv[sys.argv.index("--timeout") + 1]) if "--timeout" in sys.argv else 30

def mark_all_privy_seen():
    """Mark all existing Privy emails as seen so we only get fresh ones."""
    mail = imaplib.IMAP4_SSL(IMAP_HOST)
    mail.login(IMAP_USER, IMAP_PASS)
    mail.select("INBOX")
    _, data = mail.search(None, '(FROM "privy.io" UNSEEN)')
    if data[0]:
        for mid in data[0].split():
            mail.store(mid, "+FLAGS", "\\Seen")
        print(f"Marked {len(data[0].split())} old Privy emails as seen", file=sys.stderr)
    mail.logout()


def fetch_privy_otp() -> str | None:
    """Connect to IMAP and find the latest UNSEEN Privy OTP code."""
    mail = imaplib.IMAP4_SSL(IMAP_HOST)
    mail.login(IMAP_USER, IMAP_PASS)
    mail.select("INBOX")

    # Only get unseen emails from privy
    _, data = mail.search(None, '(FROM "privy.io" UNSEEN)')

    ids = data[0].split()
    if not ids:
        mail.logout()
        return None

    # Get the latest one
    latest_id = ids[-1]
    _, msg_data = mail.fetch(latest_id, "(RFC822)")
    raw = msg_data[0][1]
    msg = email.message_from_bytes(raw)

    # Extract body
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct in ("text/plain", "text/html"):
                payload = part.get_payload(decode=True)
                if payload:
                    body += payload.decode("utf-8", errors="replace")
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            body = payload.decode("utf-8", errors="replace")

    # Find 6-digit code
    match = re.search(r'\b(\d{6})\b', body)
    if match:
        mail.store(latest_id, "+FLAGS", "\\Seen")
        mail.logout()
        return match.group(1)

    mail.logout()
    return None

def main():
    if not IMAP_PASS:
        print("ERROR: IMAP_PASS not set", file=sys.stderr)
        sys.exit(1)

    # Clear old Privy emails first
    if "--clear" in sys.argv:
        mark_all_privy_seen()

    start = time.time()
    print(f"Polling {IMAP_HOST} as {IMAP_USER} for Privy OTP (timeout: {TIMEOUT}s)...", file=sys.stderr)

    while time.time() - start < TIMEOUT:
        code = fetch_privy_otp()
        if code:
            print(code)  # stdout = just the code
            print(f"Found OTP: {code}", file=sys.stderr)
            sys.exit(0)
        print(".", end="", file=sys.stderr, flush=True)
        time.sleep(2)

    print(f"\nTimeout after {TIMEOUT}s — no Privy OTP found", file=sys.stderr)
    sys.exit(1)

if __name__ == "__main__":
    main()
