"""Persist the notifications required by US25/26 and registration confirmations.

Recipients come only from stored assignments / the authenticated attendee. No
caller can choose an arbitrary destination. General US36 triggers stay separate.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from login.models import User
from login.security import get_current_user
import models

router = APIRouter()


def notify(db, recipient_id, event, title, body):
    if recipient_id is not None:
        db.add(models.Notification(recipient_id=recipient_id, event_id=event.id,
            title=title, body=body, created_at=datetime.now(timezone.utc)))


def registration_confirmation(db, event, attendee, registration):
    status = registration.status.value
    title = "Registration confirmed" if status == "registered" else "Added to waitlist"
    body = f"{event.name}: {status}. Date: {event.date}, {event.start_time}–{event.end_time}."
    notify(db, attendee.id, event, title, body)
    db.add(models.EmailOutbox(recipient_id=attendee.id, event_id=event.id,
        recipient=attendee.email, subject=f"{title}: {event.name}".replace("\r", " ").replace("\n", " "), body=body,
        created_at=datetime.now(timezone.utc), attempts=0))


@router.get("/notifications")
def list_notifications(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(models.Notification).filter_by(recipient_id=user.id).order_by(models.Notification.id.desc()).limit(200).all()
    return [{"id": row.id, "title": row.title, "body": row.body,
             "createdAt": row.created_at.replace(tzinfo=timezone.utc).isoformat(), "read": row.read_at is not None} for row in rows]


@router.post("/notifications/read")
def read_notifications(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.query(models.Notification).filter_by(recipient_id=user.id, read_at=None).update({"read_at": datetime.now(timezone.utc)})
    db.commit()
    return {"ok": True}


@router.post("/notifications/{notification_id}/read")
def read_notification(notification_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = db.query(models.Notification).filter_by(id=notification_id, recipient_id=user.id).first()
    if row is None:
        raise HTTPException(404, "Notification not found")
    row.read_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}
