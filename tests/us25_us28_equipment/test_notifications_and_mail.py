"""Recipient scoping, durable notices and actual SMTP adapter behavior (transport mocked)."""
from datetime import timedelta
import pytest
import equipment, mail_worker, models
from test_equipment_api import event, request, progress
from auth_testkit import get_user
from login.models import Role
from schemas import campus_today


@pytest.fixture(autouse=True)
def catalogue(db):
    equipment.seed_catalogue(db)


def test_equipment_submission_reaches_only_assigned_technician(db, signed_in):
    eid = event(db)
    request(db, signed_in, eid)
    notices = signed_in(Role.tech).get('/notifications').json()
    assert len(notices) == 1
    assert notices[0]['title'] == 'Equipment request submitted'
    assert 'Equipment test' in notices[0]['body']
    assert signed_in(Role.attendee).get('/notifications').json() == []
    assert signed_in(Role.attendee).post(f"/notifications/{notices[0]['id']}/read").status_code == 404
    assert signed_in(Role.tech).post('/notifications/read').status_code == 200
    assert signed_in(Role.tech).get('/notifications').json()[0]['read'] is True


def test_status_change_notifies_coordinator_and_is_saved(db, signed_in):
    eid = event(db)
    request(db, signed_in, eid)
    progress(signed_in, eid, 'unavailable', notes='In repair')
    rows = signed_in(Role.coordinator).get('/notifications').json()
    assert len(rows) == 1
    assert 'unavailable' in rows[0]['body']
    progress(signed_in, eid, 'unavailable', notes='Updated note')
    assert len(signed_in(Role.coordinator).get('/notifications').json()) == 1


def register(db, signed_in):
    eid = event(db)
    row = db.get(models.Event, eid)
    row.status = models.EventStatus.confirmed
    row.registration_required = True
    row.registration_cap = 10
    row.registration_close = campus_today() + timedelta(days=20)
    db.commit()
    response = signed_in(Role.attendee).post(f'/events/{eid}/registrations')
    assert response.status_code == 201, response.text
    return eid


def test_registration_queues_one_email_transactionally_without_smtp(db, signed_in, monkeypatch):
    monkeypatch.delenv('SMTP_HOST', raising=False)
    eid = register(db, signed_in)
    assert db.query(models.EmailOutbox).count() == 1
    row = db.query(models.EmailOutbox).one()
    assert row.recipient == get_user(db, Role.attendee).email
    assert row.sent_at is None
    assert signed_in(Role.attendee).post(f'/events/{eid}/registrations').status_code == 409
    assert db.query(models.EmailOutbox).count() == 1
    assert len(signed_in(Role.attendee).get('/notifications').json()) == 1
    assert mail_worker.deliver_pending()['configured'] is False


def test_email_delivery_uses_tls_and_saved_attendee_then_is_not_resent(db, signed_in, monkeypatch):
    register(db, signed_in)
    sent = []
    class SMTP:
        def __init__(self, host, port, timeout):
            assert (host, port) == ('smtp.test.invalid', 587)
            self.tls = False
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def starttls(self, context): self.tls = True
        def send_message(self, message):
            assert self.tls
            sent.append(message)
    monkeypatch.setenv('SMTP_HOST', 'smtp.test.invalid')
    monkeypatch.setenv('SMTP_FROM', 'events@test.invalid')
    monkeypatch.delenv('SMTP_PORT', raising=False)
    monkeypatch.delenv('SMTP_SSL', raising=False)
    monkeypatch.delenv('SMTP_ALLOW_PLAINTEXT', raising=False)
    monkeypatch.delenv('SMTP_USERNAME', raising=False)
    monkeypatch.setattr(mail_worker.smtplib, 'SMTP', SMTP)
    assert mail_worker.deliver_pending()['sent'] == 1
    assert mail_worker.deliver_pending()['sent'] == 0
    assert sent[0]['To'] == get_user(db, Role.attendee).email
    assert 'Registration confirmed' in sent[0]['Subject']
    assert 'Equipment test' in sent[0].get_content()
    db.expire_all()
    assert db.query(models.EmailOutbox).one().sent_at is not None


def test_smtp_failure_keeps_outbox_for_retry(db, signed_in, monkeypatch):
    register(db, signed_in)
    monkeypatch.setenv('SMTP_HOST', 'smtp.test.invalid')
    monkeypatch.setenv('SMTP_FROM', 'events@test.invalid')
    monkeypatch.setenv('SMTP_SSL', 'false')
    def unavailable(*args, **kwargs): raise OSError('offline')
    monkeypatch.setattr(mail_worker.smtplib, 'SMTP', unavailable)
    assert mail_worker.deliver_pending()['failed'] == 1
    db.expire_all()
    row = db.query(models.EmailOutbox).one()
    assert row.sent_at is None and row.attempts == 1 and row.last_error == 'OSError'


def test_confirmation_arrives_at_local_smtp_receiver(db, signed_in, monkeypatch):
    """Real SMTP connection to a local test mailbox; no external email is sent."""
    import socketserver
    from email.parser import BytesParser
    from queue import Queue
    from threading import Thread
    register(db, signed_in)
    received = Queue()
    class Receiver(socketserver.StreamRequestHandler):
        def reply(self, line): self.wfile.write(line + b'\r\n')
        def handle(self):
            self.reply(b'220 localhost test mailbox')
            while True:
                line = self.rfile.readline()
                if not line: return
                command = line.split(b' ', 1)[0].strip().upper()
                if command == b'DATA':
                    self.reply(b'354 Send message')
                    content = []
                    while True:
                        data = self.rfile.readline()
                        if data in (b'.\r\n', b'.\n', b''): break
                        content.append(data[1:] if data.startswith(b'..') else data)
                    received.put(BytesParser().parsebytes(b''.join(content)))
                    self.reply(b'250 Accepted')
                elif command == b'QUIT':
                    self.reply(b'221 Bye'); return
                else:
                    self.reply(b'250 OK')
    with socketserver.ThreadingTCPServer(('127.0.0.1', 0), Receiver) as server:
        thread = Thread(target=server.serve_forever, kwargs={'poll_interval':0.02}, daemon=True)
        thread.start()
        monkeypatch.setenv('SMTP_HOST', '127.0.0.1')
        monkeypatch.setenv('SMTP_PORT', str(server.server_address[1]))
        monkeypatch.setenv('SMTP_FROM', 'events@test.invalid')
        monkeypatch.setenv('SMTP_SSL', 'false')
        monkeypatch.setenv('SMTP_ALLOW_PLAINTEXT', 'true')
        monkeypatch.delenv('SMTP_USERNAME', raising=False)
        try:
            assert mail_worker.deliver_pending()['sent'] == 1
            message = received.get(timeout=2)
            assert message['To'] == get_user(db, Role.attendee).email
            assert 'Registration confirmed' in message['Subject']
            assert 'Equipment test' in message.get_payload(decode=True).decode()
        finally:
            server.shutdown(); thread.join(timeout=2)
    db.expire_all()
    assert db.query(models.EmailOutbox).one().sent_at is not None
