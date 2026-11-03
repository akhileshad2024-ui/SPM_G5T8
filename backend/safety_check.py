"""
US44 Conduct Operational Safety Check (Week 7 change CR-W7-6): once an event's venue and technical arrangements
are confirmed, a Safety Officer reviews whether they are safe before the event goes on to preparation.

    request   the assigned coordinator sends an Approved event to the check once its venue bookings are approved
              and its equipment is confirmed: Approved -> Pending Safety Review. The same step hands an event
              back after rework (Safety Changes Requested / Safety Rejected -> Pending Safety Review, US45).
    decide    a Safety Officer approves, requests changes or rejects: Pending Safety Review -> Safety Approved /
              Safety Changes Requested / Safety Rejected. A comment is mandatory unless approving. The outcome,
              reviewer and time are saved (models.SafetyReview); the status change is in the US13 history too.

A rejection does not end the event: Safety Rejected can go back to Pending Safety Review once reworked (US45).

review_package() is what the Safety Officer reviews: the expected attendance, venue capacity and layout, emergency
access, accessibility requirements, equipment placement, crowd movement and known venue restrictions. The system
records no emergency access plan, crowd flow or placement beyond an item's technical requirements, so those areas
say so plainly instead of showing something made up.

Each step raises ReviewError (403 / 409 / 422) instead of saving. Nothing here commits.
"""

from collections import defaultdict
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

import models
from equipment import CATALOGUE
from event_review import ReviewError, check_note, iso, not_allowed
from event_status import SAFETY_STATUSES, change_status, label
from hold_expiry import as_utc
from login.models import Role, User
from venue_availability import availability_issues

S = models.EventStatus

OUTCOME_STATUS = {
    "approved": S.safety_approved,
    "changes_requested": S.safety_changes_requested,
    "rejected": S.safety_rejected,
}
# A comment is mandatory for these outcomes (US44 AC4).
NEEDS_COMMENT = ("changes_requested", "rejected")
# Where a safety check can be requested from: first time, or again after rework (US45).
CAN_REQUEST_FROM = (S.approved, S.safety_changes_requested, S.safety_rejected)
EQUIPMENT_NAMES = {item_id: name for item_id, name, _ in CATALOGUE}


# ---------------------------------------------------------------- the arrangements being confirmed

def arrangements_issue(event: models.Event) -> Optional[str]:
    """Why the event's venue and technical arrangements are not confirmed yet, or None when they are.

    Venue: every booking that holds a venue is approved, and there is one (events.booking_state, kept by
    venue_bookings.summarise). Technical: any equipment the event asks for is reserved by Technical Support.
    """
    if event.booking_state == "pending":
        return "Venue Staff have not yet approved every venue booking."
    if event.booking_state != "approved":
        return "No venue is confirmed for this event yet."
    if event.equipment and event.equipment_state != "reserved":
        return "Technical Support have not yet confirmed all the equipment."
    return None


# ---------------------------------------------------------------- the steps

def request_check(db: Session, event: models.Event, user: User, now: datetime) -> None:
    """The assigned coordinator sends the event to its Operational Safety Check (US44 AC2)."""
    if user.role != Role.coordinator or event.coordinator_id != user.id:
        raise ReviewError(403, "Only the assigned coordinator can request a safety check.")
    if event.status == S.pending_safety_review:
        raise not_allowed("This event is already waiting for its safety check.")
    if event.status not in CAN_REQUEST_FROM:
        raise not_allowed(f"A safety check can only be requested for an approved event (this event is {label(event.status).lower()}).")
    issue = arrangements_issue(event)
    if issue:
        raise not_allowed(f"{issue} The safety check starts once the venue and equipment are confirmed.")
    reworked = event.status != S.approved
    from arrangement_reassessment import outstanding
    shared_issues = outstanding(db, event)
    if shared_issues:
        raise not_allowed("Resolve Requires Reassessment before requesting a safety check. " + " ".join(shared_issues))
    if reworked:
        # US45-AC3: the existing venue reassessment flag must be resolved before
        # another check. Do not clear flags or infer targets from review comments.
        # Equipment/registration/safety flags were checked by the shared service.
        bookings = db.query(models.VenueBooking).filter(
            models.VenueBooking.event_id == event.id,
            models.VenueBooking.status == "approved",
        ).all()
        if any(booking.reassessment for booking in bookings):
            raise not_allowed("Resolve the venue bookings marked Requires Reassessment before resubmitting for a safety check.")
    change_status(db, event, S.pending_safety_review, user, now,
                  reason="Resubmitted for safety review after rework." if reworked else None)


def decide(db: Session, event: models.Event, user: User, outcome: str, comment: str, now: datetime, targets=None) -> None:
    """A Safety Officer approves, requests changes or rejects (US44 AC4, AC5)."""
    if user.role != Role.safety:
        raise ReviewError(403, "Only a Safety Officer can conduct a safety check.")
    if outcome not in OUTCOME_STATUS:
        raise ReviewError(422, "Choose approve, request changes or reject.")
    if event.status in SAFETY_STATUSES and event.status != S.pending_safety_review:
        raise not_allowed(f"A safety decision has already been made on this event (it is {label(event.status)}).")
    if event.status != S.pending_safety_review:
        raise not_allowed(f"This event is not waiting for a safety check (it is {label(event.status)}).")
    text = check_note(comment, "Comment", required=outcome in NEEDS_COMMENT)
    from arrangement_reassessment import target_rows, outstanding, safety_rework
    targets = targets or []
    if targets and outcome == "approved":
        raise ReviewError(422, "An approval cannot request arrangement rework.")
    target_rows(db, event, targets)
    if outcome == "approved":
        # Checked again here: Technical Support or Venue Staff may have changed something since it was requested.
        issue = arrangements_issue(event)
        if issue:
            raise not_allowed(f"Can't approve: {issue} The arrangements changed after the safety check was requested.")
        if outstanding(db, event):
            raise not_allowed("Resolve Requires Reassessment before approving safety.")
    change_status(db, event, OUTCOME_STATUS[outcome], user, now, reason=text or None)
    review = models.SafetyReview(event_id=event.id, outcome=outcome, comment=text or None, reviewer_id=user.id, reviewed_at=now)
    db.add(review)
    db.flush()
    if targets:
        safety_rework(db, event, review, targets, now)
        change_status(db, event, S.approved, user, now,
                      reason="Returned to arrangement planning for the named safety revisions.", rework=True)


# ---------------------------------------------------------------- what the Safety Officer reviews

def area(key: str, title: str, details: list, concerns: list, recorded: bool = True) -> dict:
    """One thing the Safety Officer reviews: what the system holds about it, and what looks wrong.
    `recorded` is False when the system holds nothing about it, so the officer has to ask."""
    return {"key": key, "label": title, "details": details, "concerns": concerns, "recorded": recorded}


def attendance_area(attendance: Optional[int]) -> dict:
    if not attendance:
        return area("attendance", "Expected attendance", [], ["No expected attendance is recorded."])
    return area("attendance", "Expected attendance", [f"{attendance} people are expected."], [])


def capacity_layout_area(venues: list) -> dict:
    details, concerns = [], []
    for venue in venues:
        share = round(100 * venue["attendance"] / venue["capacity"]) if venue["capacity"] else 0
        details.append(f"{venue['name']}: capacity {venue['capacity']}; booked for {venue['attendance']} people "
                       f"({share}% of capacity) in a {venue['layout']} layout.")
        if venue["attendance"] > venue["capacity"]:
            concerns.append(f"{venue['name']}: {venue['attendance']} people is more than its capacity of {venue['capacity']}.")
        if venue["layout"] not in venue["layouts"]:
            offered = ", ".join(venue["layouts"]) or "none recorded"
            concerns.append(f"{venue['name']} does not list the {venue['layout']} layout (it offers: {offered}).")
    if not venues:
        concerns.append("No confirmed venue booking to review.")
    return area("capacity_layout", "Venue capacity and layout", details, concerns)


def emergency_access_area() -> dict:
    return area("emergency_access", "Emergency access",
                ["Exits, evacuation routes and emergency vehicle access are not recorded in the system. "
                 "Confirm them with the coordinator and say what you found in your comment."], [], recorded=False)


def accessibility_area(needs: list, venues: list) -> dict:
    details = [f"Needed: {', '.join(needs)}." if needs else "No accessibility needs are recorded for this event."]
    concerns = []
    for venue in venues:
        offered = venue["accessibility"]
        details.append(f"{venue['name']} offers: {', '.join(offered) or 'none recorded'}.")
        offered_lower = {item.lower() for item in offered}
        missing = [need for need in needs if need.lower() not in offered_lower]
        if missing:
            concerns.append(f"{venue['name']} does not offer: {', '.join(missing)}.")
    return area("accessibility", "Accessibility requirements", details, concerns)


def equipment_area(lines: list) -> dict:
    if not lines:
        return area("equipment_placement", "Equipment placement", ["No equipment is requested for this event."], [])
    details, concerns = [], []
    for line in lines:
        name = EQUIPMENT_NAMES.get(line.get("id"), line.get("id"))
        requirements = (line.get("technicalRequirements") or "").strip()
        details.append(f"{line.get('qty')} × {name} ({line.get('status', 'pending')}): {requirements or 'no technical requirements recorded'}")
        if not requirements:
            concerns.append(f"{name}: nothing is recorded about where or how it is set up.")
    details.append("Where each item goes is only described by its technical requirements.")
    return area("equipment_placement", "Equipment placement", details, concerns)


def crowd_movement_area(attendance: Optional[int], venues: list) -> dict:
    layouts = ", ".join(sorted({venue["layout"] for venue in venues})) or "none"
    return area("crowd_movement", "Crowd movement",
                [f"Crowd flow is not recorded in the system. Layout: {layouts}; {attendance or 'unknown'} people across "
                 f"{len(venues)} venue{'s' if len(venues) != 1 else ''}."], [], recorded=False)


def restrictions_area(venues: list) -> dict:
    details, concerns = [], []
    for venue in venues:
        hours = venue["operating_hours"] or "hours not recorded"
        days = ", ".join(venue["operating_days"]) or "days not recorded"
        details.append(f"{venue['name']}: open {days}, {hours}; {venue['setup_minutes']} min setup before and "
                       f"{venue['turnaround_minutes']} min turnaround after the event.")
        concerns.extend(venue["restrictions"])
    if not venues:
        details.append("No confirmed venue booking to review.")
    return area("venue_restrictions", "Known venue restrictions", details, concerns)


def build_areas(attendance: Optional[int], access_needs: list, venues: list, equipment: list) -> list:
    """The seven things a Safety Officer reviews (US44 AC3), from plain values."""
    return [
        attendance_area(attendance),
        capacity_layout_area(venues),
        emergency_access_area(),
        accessibility_area(access_needs, venues),
        equipment_area(equipment),
        crowd_movement_area(attendance, venues),
        restrictions_area(venues),
    ]


def venue_facts(venue: models.Venue, booking: models.VenueBooking) -> dict:
    """One confirmed booking and its venue, as the areas above read them."""
    issues = availability_issues(venue, booking.date, booking.start_time, booking.end_time, [])
    return {
        "name": venue.name, "capacity": venue.cap, "layouts": venue.layouts or [], "accessibility": venue.accessibility or [],
        "layout": booking.layout, "attendance": booking.attendance,
        "operating_hours": venue.operatingHours, "operating_days": venue.operatingDays or [],
        "setup_minutes": venue.setupMinutes or 0, "turnaround_minutes": venue.turnaroundMinutes or 0,
        "restrictions": [issue.text for issue in issues],
    }


# ---------------------------------------------------------------- reading what is saved

def review_out(review: models.SafetyReview, names: dict) -> dict:
    return {"outcome": review.outcome, "comment": review.comment, "reviewer": names.get(review.reviewer_id, ""),
            "reviewedAt": as_utc(review.reviewed_at)}


def latest_review(db: Session, event: models.Event) -> Optional[dict]:
    """The event's latest safety outcome as the event view shows it (schemas.EventResponse.safetyReview)."""
    review = (db.query(models.SafetyReview).filter(models.SafetyReview.event_id == event.id)
              .order_by(models.SafetyReview.id.desc()).first())
    if review is None:
        return None
    reviewer = db.get(User, review.reviewer_id)
    return {"outcome": review.outcome, "comment": review.comment, "by": reviewer.name if reviewer else "",
            "at": iso(review.reviewed_at)}


def packages(db: Session, events: list) -> list:
    """The Safety Officer's list (US44 AC2, AC3): each event with what to review and its safety history.
    Events waiting for a check come first, the longest waiting first; the rest follow, newest first."""
    from arrangement_reassessment import planning_stage
    ids = [event.id for event in events]
    if not ids:
        return []
    reviews = defaultdict(list)
    for review in db.query(models.SafetyReview).filter(models.SafetyReview.event_id.in_(ids)).order_by(models.SafetyReview.id):
        reviews[review.event_id].append(review)
    bookings = defaultdict(list)
    for booking in db.query(models.VenueBooking).filter(models.VenueBooking.event_id.in_(ids), models.VenueBooking.status == "approved").order_by(models.VenueBooking.id):
        bookings[booking.event_id].append(booking)
    venues = {v.id: v for v in db.query(models.Venue).filter(models.Venue.id.in_({b.venue_id for rows in bookings.values() for b in rows}))}
    requested = {}
    for change in (db.query(models.EventStatusChange)
                   .filter(models.EventStatusChange.event_id.in_(ids), models.EventStatusChange.to_status == S.pending_safety_review)
                   .order_by(models.EventStatusChange.changed_at, models.EventStatusChange.id)):
        requested[change.event_id] = change.changed_at
    people = {event.organiser_id for event in events} | {event.coordinator_id for event in events if event.coordinator_id}
    people |= {review.reviewer_id for rows in reviews.values() for review in rows}
    names = {u.id: u.name for u in db.query(User).filter(User.id.in_(people))}

    out = []
    for event in events:
        facts = [venue_facts(venues[b.venue_id], b) for b in bookings[event.id]]
        waiting_since = requested.get(event.id)
        out.append({
            "eventId": event.id, "name": event.name, "status": event.status.value,
            "date": event.date, "start": event.start_time, "end": event.end_time,
            "eventType": event.event_type or "", "purpose": event.purpose or "",
            "organiser": names.get(event.organiser_id, ""), "coordinator": names.get(event.coordinator_id),
            "requestedAt": as_utc(waiting_since),
            "arrangementsIssue": arrangements_issue(event),
            "areas": build_areas(event.expected_attendance, event.accessibility or [], facts, event.equipment or []),
            "reviews": [review_out(review, names) for review in reviews[event.id]],
            "targets": ([{"type": "venue", "id": b.id, "label": f"{b.venue_name} booking #{b.id}"} for b in bookings[event.id]]
                        + [{"type": "equipment", "id": r.id, "label": f"{r.item_id} reservation #{r.id}"}
                           for r in db.query(models.EquipmentReservation).filter_by(event_id=event.id)]),
            "planningStage": planning_stage(db, event),
        })
    waiting = sorted((p for p in out if p["status"] == S.pending_safety_review.value), key=lambda p: (p["requestedAt"] is None, p["requestedAt"], p["eventId"]))
    done = sorted((p for p in out if p["status"] != S.pending_safety_review.value), key=lambda p: -p["eventId"])
    return waiting + done
