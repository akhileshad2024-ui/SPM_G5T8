"""Deliver committed confirmation emails through configured SMTP.

Run from backend: `python -m mail_worker --once` (scheduler) or omit --once to
retry every 15s. Without SMTP_HOST and SMTP_FROM it leaves messages pending.
Failures remain in the durable outbox. Never logs passwords or message bodies.
"""
import argparse
import os
import smtplib
import ssl
import time
from datetime import datetime, timezone
from email.message import EmailMessage

from database import SessionLocal
import models


def deliver_pending(limit=50):
    host, sender = os.getenv("SMTP_HOST"), os.getenv("SMTP_FROM")
    if not host or not sender:
        return {"sent": 0, "failed": 0, "configured": False}
    result = {"sent": 0, "failed": 0, "configured": True}
    # One row per transaction. PostgreSQL SKIP LOCKED permits several workers.
    for _ in range(limit):
        with SessionLocal() as db:
            row = db.query(models.EmailOutbox).filter(
                models.EmailOutbox.sent_at.is_(None), models.EmailOutbox.attempts < 10,
            ).order_by(models.EmailOutbox.attempts, models.EmailOutbox.id).with_for_update(skip_locked=True).first()
            if row is None:
                break
            row.attempts += 1
            try:
                message = EmailMessage()
                message["From"], message["To"], message["Subject"] = sender, row.recipient, row.subject
                message["Message-ID"] = f"<connectsphere-confirmation-{row.id}@{sender.rsplit('@', 1)[-1]}>"
                message.set_content(row.body)
                implicit_tls = os.getenv("SMTP_SSL", "false").lower() == "true"
                plain = os.getenv("SMTP_ALLOW_PLAINTEXT", "false").lower() == "true"
                port = int(os.getenv("SMTP_PORT", "465" if implicit_tls else "587"))
                client = smtplib.SMTP_SSL(host, port, timeout=10, context=ssl.create_default_context()) if implicit_tls else smtplib.SMTP(host, port, timeout=10)
                with client as smtp:
                    if not implicit_tls and not plain:
                        smtp.starttls(context=ssl.create_default_context())
                    username, password = os.getenv("SMTP_USERNAME"), os.getenv("SMTP_PASSWORD")
                    if username:
                        smtp.login(username, password or "")
                    smtp.send_message(message)
                row.sent_at, row.last_error = datetime.now(timezone.utc), None
                result["sent"] += 1
            except Exception as error:
                row.last_error = type(error).__name__
                result["failed"] += 1
            db.commit()
            # Avoid tight repeated retries against a failing server in one run.
            if row.sent_at is None:
                break
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    while True:
        print(deliver_pending(), flush=True)
        if args.once:
            break
        time.sleep(15)
