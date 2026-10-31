"""US36 Receive Notifications: durable, per-recipient notices, plus registration confirmations (US29).

Recipients come only from stored assignments / the authenticated user. No caller can choose an
arbitrary destination, and nobody is told about an event they are not involved in (US36-AC4).

Each workflow step calls one function below in the same transaction as the step itself, so a notice
is saved exactly when the change it reports is saved. Every notice names the event, says what changed
and what to do next, if anything (US36-AC2). The page polls GET /notifications every 15 seconds,
well inside the one-minute delivery limit (US36-AC5).

Functions for stories still being built (US12, US14, US44, US49-US51) are ready to call; see
docs/US36_Notifications_Handover.md.
"""
import logging
import threading
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import SessionLocal, get_db
from login.models import Role, User
from login.security import get_current_user, get_current_user_without_renewal
import hold_expiry
import models

router = APIRouter()
log = logging.getLogger(__name__)

# Field names in US16 detail changes, as people read them.
FIELD_LABELS = {
    "name": "name", "purpose": "description", "eventType": "event type", "pax": "expected attendance",
    "date": "date", "start": "start time", "end": "end time", "venueLocation": "venue location",
    "venueCapacity": "venue capacity", "layout": "layout", "facilities": "facilities", "access": "accessibility",
    "equip": "equipment", "reg": "registration", "regCap": "registration capacity", "regClose": "registration closing date",
}


def notify(db, recipient_id, event, title, body):
    if recipient_id is not None:
        db.add(models.Notification(recipient_id=recipient_id, event_id=event.id,
            title=title, body=body, created_at=datetime.now(timezone.utc)))


def notify_once(db, recipient_id, event, title, body):
    """notify(), unless this recipient already has this exact notice: for checks that run repeatedly."""
    if recipient_id is None:
        return
    pending = any(isinstance(row, models.Notification) and (row.recipient_id, row.event_id, row.title, row.body)
                  == (recipient_id, event.id, title, body) for row in db.new)
    if pending or db.query(models.Notification.id).filter_by(
            recipient_id=recipient_id, event_id=event.id, title=title, body=body).first():
        return
    notify(db, recipient_id, event, title, body)


def notify_all(db, recipient_ids, event, title, body, skip=None):
    """notify() each recipient once, leaving out `skip` (the person who made the change)."""
    for recipient_id in dict.fromkeys(recipient_ids):
        if recipient_id != skip:
            notify(db, recipient_id, event, title, body)


# ---------------------------------------------------------------- who is involved

def staff_with_role(db, role):
    """Active accounts with `role`, or none when the role does not exist yet (e.g. the Safety Officer, US44)."""
    if role is None:
        return []
    return [u.id for u in db.query(User.id).filter(User.role == role, User.is_active.is_(True)).order_by(User.id)]


def venue_staff(db):
    """ConnectSphere's Venue Staff are one team managing every venue (Sprint 3 decision, US23-AC1)."""
    return staff_with_role(db, Role.venue)


def assigned_tech(event):
    return event.equipment_assignment.tech_id if event.equipment_assignment is not None else None


def holds_a_venue(db, event):
    return db.query(models.VenueBooking.id).filter(
        models.VenueBooking.event_id == event.id, models.VenueBooking.status.in_(("pending", "approved"))).first() is not None


def attendees(db, event):
    """Attendees holding a place or waiting for one."""
    return [r.attendee_id for r in db.query(models.Registration).filter(
        models.Registration.event_id == event.id,
        models.Registration.status.in_((models.RegistrationStatus.registered, models.RegistrationStatus.waitlisted)),
    ).order_by(models.Registration.id)]


def booking_event(db, booking):
    return db.get(models.Event, booking.event_id)


# ---------------------------------------------------------------- triggers in stories already built

def request_submitted(db, event):
    """US04 / US43: every Event Coordinator Lead is told a new request is waiting in their queue (US36-AC1;
    not asked for by US04's own criteria, which only require the request to reach the queue)."""
    notify_all(db, staff_with_role(db, Role.lead), event, "New request to assign",
               f"{event.name}: a new event request was submitted. Assign a coordinator from Assignments.")


def coordinator_assigned(db, event, lead):
    """US11-AC4, US36-AC6: the coordinator the Lead assigned."""
    notify(db, event.coordinator_id, event, "Event assigned to you",
           f"{event.name}: {lead.name} assigned this event to you. Open it from your queue to start the review.")


def clarification_requested(db, event):
    """US08-AC4: the organiser is asked to clarify or amend."""
    request = event.clarification or {}
    kind = "Amendment" if request.get("kind") == "amendment" else "Clarification"
    notify(db, event.organiser_id, event, f"{kind} requested",
           f"{event.name}: {request.get('message', '')} Reply from My events so the review can continue.")


def clarification_answered(db, event):
    """US09-AC3: the assigned coordinator is told the organiser replied, so the review can continue."""
    reply = ((event.clarification or {}).get("response") or {}).get("message", "")
    notify(db, event.coordinator_id, event, "Clarification answered",
           f"{event.name}: the organiser replied: \"{reply}\" Resume the review from your queue.")


def request_decided(db, event):
    """US10-AC5: the organiser is told the outcome and any reason given."""
    decision = event.decision or {}
    reason = f" Reason: {decision['reason']}" if decision.get("reason") else ""
    if decision.get("outcome") == "approved":
        notify(db, event.organiser_id, event, "Event request approved",
               f"{event.name} was approved.{reason} The coordinator will now arrange the venue and equipment.")
    else:
        notify(db, event.organiser_id, event, "Event request rejected", f"{event.name} was rejected.{reason}")


def booking_requested(db, event, notice):
    """US22-AC4: every Venue Staff member is told about the new request (booking_request.build_notification)."""
    notify_all(db, venue_staff(db), event, notice["title"], f"{event.name}: {notice['body']} Approve or reject it in Bookings.")


def booking_decided(db, booking):
    """US23-AC5: the requesting coordinator is told what Venue Staff decided."""
    event = booking_event(db, booking)
    when = f"{booking.date}, {booking.start_time}–{booking.end_time}"
    if booking.status == "approved":
        notify(db, event.coordinator_id, event, "Venue booking approved",
               f"{booking.venue_name} is confirmed for {event.name} on {when}.")
    else:
        notify(db, event.coordinator_id, event, "Venue booking rejected",
               f"{booking.venue_name} was not approved for {event.name} on {when}: {booking.decision_reason} "
               "Request another venue to continue planning.")


def bookings_flagged(db, flagged, reassessed):
    """US39-AC5 and US38-AC4: the coordinator of each booking a venue change put in trouble."""
    for booking in flagged:
        event = booking_event(db, booking)
        notify(db, event.coordinator_id, event, "Replacement venue required", f"{event.name}: {booking.flag['message']}")
    for booking in reassessed:
        event = booking_event(db, booking)
        notify(db, event.coordinator_id, event, "Booking requires reassessment",
               f"{event.name}: {booking.reassessment['message']}")


def sweep_holds(db, now):
    """US42-AC2/AC3: expire lapsed holds, and tell each coordinator once that a hold is about to expire
    and again when it has. Runs every minute in the background (sweep_holds_forever) and whenever bookings,
    events or notifications are read. Does not commit; returns whether anything changed."""
    def campus_time(booking):
        return f"{hold_expiry.as_utc(booking.hold_expires_at).astimezone(hold_expiry.CAMPUS_TZ):%d %b %Y, %H:%M}"

    expired = hold_expiry.expire_due(db, now)
    for booking in expired:
        event = booking_event(db, booking)
        notify_once(db, event.coordinator_id, event, "Venue hold expired",
                    f"{booking.venue_name} for {event.name} expired on {campus_time(booking)} and has been released. "
                    "Request the venue again if it is still needed.")
    soon = db.query(models.VenueBooking).filter(
        models.VenueBooking.status == "pending", models.VenueBooking.hold_expires_at.isnot(None)).all()
    for booking in soon:
        if hold_expiry.hold_notice(booking, now) == "expiring_soon":
            event = booking_event(db, booking)
            notify_once(db, event.coordinator_id, event, "Venue hold expiring soon",
                        f"{booking.venue_name} for {event.name} is held until {campus_time(booking)}. "
                        "It is released if not approved by then.")
    return bool(expired) or any(isinstance(row, models.Notification) for row in db.new)


SWEEP_INTERVAL_SECONDS = 60
_sweep_lock = threading.Lock()


def sweep_and_save(db):
    """sweep_holds, committed. Requests and the background thread sweep at the same time in their own
    sessions; one at a time, so two of them can't each send a warning the other has not saved yet."""
    with _sweep_lock:
        if sweep_holds(db, datetime.now(timezone.utc)):
            db.commit()


def sweep_holds_forever(stop, session_factory=SessionLocal, interval=SWEEP_INTERVAL_SECONDS):
    """Run sweep_holds every `interval` seconds until `stop` (a threading.Event) is set, so hold warnings
    go out on time even while nobody is using the app. A failed sweep is logged and tried again."""
    while not stop.wait(interval):
        try:
            with session_factory() as db:
                sweep_and_save(db)
        except Exception:
            log.exception("Hold sweep failed; retrying in %s s", interval)


def details_changed(db, event, changes, coordinator):
    """US16-AC3: a significant change reaches everyone with an arrangement for the event."""
    fields = ", ".join(FIELD_LABELS.get(key, key) for key in changes)
    recipients = [event.organiser_id, assigned_tech(event), *(venue_staff(db) if holds_a_venue(db, event) else [])]
    notify_all(db, recipients, event, "Event details changed",
               f"{event.name}: {coordinator.name} changed the {fields}. Check that your arrangements still fit.",
               skip=coordinator.id)


def change_requested(db, event, request):
    """US33-AC2: the responsible coordinator is asked to review the organiser's proposal."""
    notify(db, event.coordinator_id, event, "Change requested",
           f"{event.name}: the organiser proposed: \"{request.proposed_changes}\" Review it under Change requests.")


def change_decided(db, event, request):
    """US34-AC5: the organiser who asked is told the decision."""
    decision = request.decision or {}
    reason = f" Reason: {decision['reason']}" if decision.get("reason") else ""
    notify(db, request.requested_by_id, event, f"Change request {request.status}",
           f"{event.name}: your change request was {request.status}.{reason}")


# ---------------------------------------------------------------- ready for stories still being built

def coordinator_reassigned(db, event, previous_coordinator_id, lead):
    """US12-AC4, US36-AC6: call after event.coordinator_id is set to the new coordinator."""
    notify(db, previous_coordinator_id, event, "Event reassigned",
           f"{event.name}: {lead.name} reassigned this event to another coordinator. You no longer manage it.")
    notify(db, event.coordinator_id, event, "Event assigned to you",
           f"{event.name}: {lead.name} reassigned this event to you. Open it from your queue to continue planning.")
    notify(db, event.organiser_id, event, "New coordinator",
           f"{event.name}: a new Event Coordinator is now handling your event.")


def event_confirmed(db, event, coordinator):
    """US14-AC4: the organiser and every member of staff with an arrangement for the event."""
    recipients = [event.organiser_id, assigned_tech(event), *(venue_staff(db) if holds_a_venue(db, event) else [])]
    notify_all(db, recipients, event, "Event confirmed",
               f"{event.name} on {event.date} is confirmed. All arrangements are final.", skip=coordinator.id)


def safety_check_ready(db, event):
    """US36-AC7, US44-AC2: every Safety Officer, once the event's venue and technical arrangements are confirmed.
    Sends nothing until US44 adds the Safety Officer role (Role.safety)."""
    notify_all(db, staff_with_role(db, getattr(Role, "safety", None)), event, "Safety check needed",
               f"{event.name} on {event.date} is ready for its Operational Safety Check. Review it under Safety checks.")


SAFETY_OUTCOMES = {
    "approved": ("Safety check approved", "passed its Operational Safety Check. You can now confirm it."),
    "changes_requested": ("Safety changes requested", "needs changes before it passes its Operational Safety Check."),
    "rejected": ("Safety check rejected", "did not pass its Operational Safety Check. Revise the arrangements and resubmit."),
}


def safety_check_decided(db, event, outcome, comment=""):
    """US36-AC7, US44-AC6: the coordinator is told the outcome ("approved", "changes_requested" or "rejected")."""
    title, text = SAFETY_OUTCOMES[outcome]
    note = f" Comment: {comment.strip()}" if comment and comment.strip() else ""
    notify(db, event.coordinator_id, event, title, f"{event.name} {text}{note}")


def venue_booking_reassess(db, booking):
    """US49-AC3: Venue Staff are told a booking needs reassessing after an accepted change."""
    event = booking_event(db, booking)
    notify_all(db, venue_staff(db), event, "Booking requires reassessment",
               f"{event.name}: an accepted change means the {booking.venue_name} booking for {booking.date} "
               "needs reassessing. Review it in Bookings.")


def equipment_reassess(db, event):
    """US50-AC3: the assigned technician is told the equipment reservations need reassessing."""
    notify(db, assigned_tech(event), event, "Equipment requires reassessment",
           f"{event.name}: an accepted change means the equipment reservations need reassessing. Review them in Equipment.")


def attendees_affected(db, event, what_changed):
    """US51-AC3: notify registered attendees after the caller establishes an impact.

    This helper neither determines impact nor commits. The accepted-change workflow
    must call it in its own transaction. Other stories still use attendees(), which
    includes the waitlist; US51 does not implicitly expand to that audience.
    """
    recipients = [r.attendee_id for r in db.query(models.Registration).filter(
        models.Registration.event_id == event.id,
        models.Registration.status == models.RegistrationStatus.registered,
    ).order_by(models.Registration.id)]
    notify_all(db, recipients, event, "Event changed", f"{event.name}: {what_changed}")


# ---------------------------------------------------------------- registration (US29)

def registration_confirmation(db, event, attendee, registration):
    status = registration.status.value
    title = "Registration confirmed" if status == "registered" else "Added to waitlist"
    body = f"{event.name}: {status}. Date: {event.date}, {event.start_time}–{event.end_time}."
    notify(db, attendee.id, event, title, body)
    db.add(models.EmailOutbox(recipient_id=attendee.id, event_id=event.id,
        recipient=attendee.email, subject=f"{title}: {event.name}".replace("\r", " ").replace("\n", " "), body=body,
        created_at=datetime.now(timezone.utc), attempts=0))


# ---------------------------------------------------------------- the inbox (US36-AC3)

PAGE_SIZE = 200


@router.get("/notifications")
def list_notifications(before: Optional[int] = None, db: Session = Depends(get_db),
                       user: User = Depends(get_current_user_without_renewal)):
    """The user's notifications, newest first, PAGE_SIZE at a time; `before` (an id) pages back to older ones."""
    sweep_and_save(db)
    query =(db.query(models.Notification, models.Event.name)
             .join(models.Event, models.Event.id == models.Notification.event_id)
             .filter(models.Notification.recipient_id == user.id))
    if before is not None:
        query = query.filter(models.Notification.id < before)
    rows = query.order_by(models.Notification.id.desc()).limit(PAGE_SIZE).all()
    return [{"id": row.id, "eventId": row.event_id, "eventName": event_name, "title": row.title, "body": row.body,
             "createdAt": row.created_at.replace(tzinfo=timezone.utc).isoformat(), "read": row.read_at is not None}
            for row, event_name in rows]


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
