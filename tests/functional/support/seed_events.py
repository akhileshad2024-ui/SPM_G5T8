"""
Adds the US13/US15 scenario events to the functional-test database and prints their ids as JSON.

Some of the states these tests need can't be reached through the API yet (a confirmed event, a
clarification answered by the organiser), so the events and their status histories are written
straight to the throwaway SQLite database, the way the manual test cases set up their data. Each
call adds a fresh set whose names end in `suffix`, so tests never see each other's events.

    DATABASE_URL=sqlite:///<file> python tests/functional/support/seed_events.py <suffix>
"""

import json
import os
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "backend"))

if not os.environ.get("DATABASE_URL", "").startswith("sqlite:///"):
    sys.exit("Refusing to seed: DATABASE_URL must point at a throwaway SQLite file, never Supabase.")

import models  # noqa: E402
from database import SessionLocal  # noqa: E402
from login.models import User  # noqa: E402

S = models.EventStatus
suffix = sys.argv[1]
today = date.today()
now = datetime.now(timezone.utc)
CLARIFY = "Please confirm the expected attendance and whether parallel sessions need a second room."
REJECT = "Clashes with the end-of-semester exam period; please propose a later date."


def user(db, email):
    return db.query(User).filter(User.email == email).one()


def history(db, event, steps):
    """`steps`: (from_status, to_status, who, reason), oldest first, one minute apart, ending a minute ago."""
    start = now - timedelta(minutes=len(steps))
    for i, (old, new, who, reason) in enumerate(steps):
        db.add(models.EventStatusChange(event_id=event.id, from_status=old, to_status=new, changed_by_id=who.id,
                                        changed_at=start + timedelta(minutes=i), reason=reason))


def event(db, **fields):
    row = models.Event(**{"facilities": [], "accessibility": [], "equipment": [], "registration_required": False, **fields})
    db.add(row)
    db.flush()
    return row


def booking(db, ev, venue, status):
    day = ev.date
    db.add(models.VenueBooking(
        event_id=ev.id, event_name=ev.name, venue_id=venue.id, venue_name=venue.name, status=status, date=day,
        start_time=ev.start_time.strftime("%H:%M"), end_time=ev.end_time.strftime("%H:%M"), setup_minutes=0,
        teardown_minutes=0, hold_start=datetime.combine(day, ev.start_time), hold_end=datetime.combine(day, ev.end_time),
        attendance=ev.expected_attendance, layout=ev.layout, verdict="suitable", requested_by="priya.tan@connectsphere.edu",
        requested_at=now, decided_by="daniel.ortiz@connectsphere.edu" if status == "approved" else None,
        decided_at=now if status == "approved" else None,
    ))


with SessionLocal() as db:
    maya, priya = user(db, "maya.rahman@connectsphere.edu"), user(db, "priya.tan@connectsphere.edu")
    venue = models.Venue(name=f"Symposium Hall {suffix}", location="Central campus", cap=300, layouts=["theatre", "standing"],
                         facilities=["Projector", "PA system"], accessibility=["Wheelchair Access"], operatingHours="07:00 - 23:00",
                         operatingDays=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
                         unavailability=[], setupMinutes=0, turnaroundMinutes=0, is_active=True, last_updated_by="seed")
    db.add(venue)
    db.flush()

    # Confirmed, venue booked, equipment requested, registration open; answered one clarification.
    symposium = event(
        db, name=f"Annual Research Symposium {suffix}", status=S.confirmed, organiser_id=maya.id, coordinator_id=priya.id,
        purpose="Faculty and students present this year's research.", event_type="conference", expected_attendance=180,
        date=today + timedelta(days=34), start_time=time(9), end_time=time(17), venue_location="Central campus",
        venue_capacity=200, layout="theatre", facilities=["Projector", "PA system"], accessibility=["Wheelchair Access"],
        equipment=[{"id": "E2", "qty": 2, "technicalRequirements": "HDMI to lectern"}], equipment_state="requested",
        registration_required=True, registration_cap=200, registration_close=today + timedelta(days=27),
        venue_id=venue.id, booking_state="approved", submitted_at=now - timedelta(minutes=7),
        decision={"outcome": "approved", "reason": "Programme and venue confirmed.", "by": "Priya Tan", "at": now.isoformat()},
    )
    history(db, symposium, [
        (None, S.submitted, maya, None),
        (S.submitted, S.under_review, priya, None),
        (S.under_review, S.pending_clarification, priya, CLARIFY),
        (S.pending_clarification, S.under_review, maya, None),
        (S.under_review, S.approved, priya, None),
        (S.approved, S.confirmed, priya, None),
    ])
    booking(db, symposium, venue, "approved")

    # Approved, venue booking pending, no equipment.
    pitch = event(
        db, name=f"Startup Pitch Night {suffix}", status=S.approved, organiser_id=maya.id, coordinator_id=priya.id,
        purpose="Eight student ventures pitch to investors.", event_type="networking", expected_attendance=95,
        date=today + timedelta(days=41), start_time=time(18, 30), end_time=time(21), venue_location="Central campus",
        venue_capacity=120, layout="standing", facilities=["Projector"], accessibility=[], registration_required=True,
        registration_cap=120, registration_close=today + timedelta(days=36), venue_id=venue.id, booking_state="pending",
        submitted_at=now - timedelta(minutes=4),
        decision={"outcome": "approved", "reason": "", "by": "Priya Tan", "at": now.isoformat()},
    )
    history(db, pitch, [(None, S.submitted, maya, None), (S.submitted, S.under_review, priya, None),
                        (S.under_review, S.approved, priya, None)])
    booking(db, pitch, venue, "pending")

    # Rejected with a reason.
    mixer = event(
        db, name=f"Faculty Networking Mixer {suffix}", status=S.rejected, organiser_id=maya.id, coordinator_id=priya.id,
        purpose="An informal evening for new and returning staff.", event_type="networking", expected_attendance=60,
        date=today + timedelta(days=20), start_time=time(17), end_time=time(19), venue_location="Staff lounge",
        venue_capacity=60, layout="standing", submitted_at=now - timedelta(minutes=4),
        decision={"outcome": "rejected", "reason": REJECT, "by": "Priya Tan", "at": now.isoformat()},
    )
    history(db, mixer, [(None, S.submitted, maya, None), (S.submitted, S.under_review, priya, None),
                        (S.under_review, S.rejected, priya, REJECT)])

    # Submitted with only the basics: no coordinator, attendance, venue needs, equipment or registration.
    bare = event(db, name=f"Unplanned Social {suffix}", status=S.submitted, organiser_id=maya.id,
                 purpose="Details to follow.", event_type="other", date=today + timedelta(days=50),
                 submitted_at=now - timedelta(minutes=1))
    history(db, bare, [(None, S.submitted, maya, None)])

    db.commit()
    print(json.dumps({"symposium": symposium.id, "pitch": pitch.id, "mixer": mixer.id, "bare": bare.id,
                      "venue": venue.name, "clarify": CLARIFY, "reject": REJECT}))
