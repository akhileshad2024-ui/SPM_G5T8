"""
Script: add the five demo venues that the frontend's sample events refer to
(Grand Hall, The Atrium, ...). Venues that already exist (same name) are left
untouched, so it is safe to run more than once.

    python -m seed_venues            (from backend/)
"""

from datetime import datetime, timezone

import models
from database import Base, SessionLocal, engine
from venue_audit import creation_changes, record_change

SEEDED_BY = "seed@connectsphere.edu"
EVERY_DAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

DEMO_VENUES = [
    dict(name="Grand Hall", location="12 Marina Boulevard, #01-01, Singapore 018982", cap=300,
         layouts=["banquet", "theatre", "standing"], facilities=["Stage", "PA system", "Projector", "Hearing loop"],
         accessibility=["Wheelchair Access", "Special Physical Seating", "Mobility/Facility Arrangements"],
         operatingHours="07:00 - 23:30", operatingDays=EVERY_DAY, setupMinutes=60, turnaroundMinutes=60,
         unavailability=[{"start": "2026-03-13T00:00:00", "end": "2026-03-14T00:00:00",
                          "reason": "maintenance", "note": "Stage rigging inspection"}]),
    dict(name="The Atrium", location="12 Marina Boulevard, #01-05, Singapore 018982", cap=220,
         layouts=["standing", "banquet"], facilities=["PA system", "Natural light"],
         accessibility=["Wheelchair Access", "Mobility/Facility Arrangements"],
         operatingHours="07:00 - 23:00", operatingDays=EVERY_DAY, setupMinutes=30, turnaroundMinutes=60,
         unavailability=[]),
    dict(name="Lecture Theatre 1", location="21 Heng Mui Keng Terrace, #02-10, Singapore 119613", cap=150,
         layouts=["theatre"], facilities=["Projector", "PA system", "Hearing loop"],
         accessibility=["Wheelchair Access", "Special Physical Seating"],
         operatingHours="08:00 - 22:00", operatingDays=EVERY_DAY[:6], setupMinutes=15, turnaroundMinutes=15,
         unavailability=[]),
    dict(name="Seminar Room 4-2", location="8 Kent Ridge Drive, #04-02, Singapore 119246", cap=40,
         layouts=["boardroom", "classroom"], facilities=["Projector", "Whiteboard"],
         accessibility=["Wheelchair Access"],
         operatingHours="08:00 - 21:00", operatingDays=EVERY_DAY[:5], setupMinutes=15, turnaroundMinutes=15,
         unavailability=[]),
    dict(name="Innovation Studio", location="3 Science Park Drive, #03-12, Singapore 118223", cap=80,
         layouts=["standing", "classroom"], facilities=["Projector", "Whiteboard"],
         accessibility=[],
         operatingHours="09:00 - 21:00", operatingDays=EVERY_DAY[:5], setupMinutes=30, turnaroundMinutes=30,
         unavailability=[]),
]


def main() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        existing = {name for (name,) in db.query(models.Venue.name).all()}
        for data in DEMO_VENUES:
            if data["name"] in existing:
                print(f"skip   {data['name']} (already exists)")
                continue
            now = datetime.now(timezone.utc)
            venue = models.Venue(**data, last_updated_by=SEEDED_BY, last_updated_at=now)
            db.add(venue)
            db.flush()
            record_change(db, venue, "create", SEEDED_BY, creation_changes(venue), now)
            print(f"added  {data['name']}")
        db.commit()


if __name__ == "__main__":
    main()
