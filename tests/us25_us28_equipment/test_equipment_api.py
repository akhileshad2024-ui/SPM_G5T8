"""US25–28: real authenticated API, throwaway database and stored reservations."""
from datetime import time, timedelta

import pytest
import equipment
import models
from auth_testkit import get_user, _PASSWORD_HASH, login
from fastapi.testclient import TestClient
from login.models import Role, User
from main import app
from schemas import campus_today


@pytest.fixture(autouse=True)
def stock(db):
    equipment.seed_catalogue(db)


def event(db, hour=10, end=12, day=30):
    row = models.Event(name="Equipment test", status=models.EventStatus.approved,
        organiser_id=get_user(db, Role.organiser).id, coordinator_id=get_user(db, Role.coordinator).id,
        date=campus_today() + timedelta(days=day), start_time=time(hour), end_time=time(end),
        facilities=[], accessibility=[], equipment=[], registration_required=False)
    db.add(row)
    db.commit()
    return row.id


def request(db, signed_in, event_id, qty=2, item="E2"):
    return signed_in(Role.coordinator).put(f"/events/{event_id}/equipment", json={
        "techId": get_user(db, Role.tech).id,
        "lines": [{"id": item, "qty": qty, "technicalRequirements": "HDMI"}],
    })


def progress(signed_in, event_id, status="reserved", **kwargs):
    return signed_in(Role.tech).patch(f"/events/{event_id}/equipment/E2", json={"status": status, **kwargs})


def available(signed_in, event_id):
    result = signed_in(Role.tech).get(f"/events/{event_id}/equipment")
    assert result.status_code == 200, result.text
    return next(row["available"] for row in result.json()["availability"] if row["id"] == "E2")


def test_us25_save_edit_remove_and_assignment_persist(db, signed_in):
    eid = event(db)
    assert request(db, signed_in, eid).status_code == 200
    assert request(db, signed_in, eid, qty=3).json()["lines"][0]["qty"] == 3
    tech = signed_in(Role.tech)
    assert tech.get("/equipment/requests").json()[0]["id"] == eid
    assert tech.get(f"/events/{eid}/equipment").json()["lines"][0]["technicalRequirements"] == "HDMI"
    response = signed_in(Role.coordinator).put(f"/events/{eid}/equipment", json={"techId": get_user(db, Role.tech).id, "lines": []})
    assert response.status_code == 200
    assert response.json()["lines"] == []


@pytest.mark.parametrize("line", [{"id": "E99", "qty": 1}, {"id": "E2"}, {"id": "E2", "qty": 0}, {"id": "E2", "qty": 1.2}, {"id": "E2", "qty": True}])
def test_us25_invalid_lines_are_rejected(db, signed_in, line):
    eid = event(db)
    res = signed_in(Role.coordinator).put(f"/events/{eid}/equipment", json={"techId": get_user(db, Role.tech).id, "lines": [line]})
    assert res.status_code == 422
    db.expire_all()
    assert db.get(models.Event, eid).equipment == []


def test_us25_duplicate_types_rejected(db, signed_in):
    eid = event(db)
    line = {"id": "E2", "qty": 1}
    assert signed_in(Role.coordinator).put(f"/events/{eid}/equipment", json={"techId": get_user(db, Role.tech).id, "lines": [line, line]}).status_code == 422


@pytest.mark.parametrize("role", [Role.organiser, Role.attendee, Role.venue, Role.tech])
def test_us25_only_coordinator_records_requests(db, signed_in, role):
    eid = event(db)
    assert signed_in(role).put(f"/events/{eid}/equipment", json={"techId": get_user(db, Role.tech).id, "lines": []}).status_code == 403


def test_us25_only_assigned_coordinator_and_planning(db, signed_in):
    eid = event(db)
    row = db.get(models.Event, eid)
    row.coordinator_id = None
    db.commit()
    assert request(db, signed_in, eid).status_code == 403
    row.coordinator_id = get_user(db, Role.coordinator).id
    row.status = models.EventStatus.confirmed
    db.commit()
    assert request(db, signed_in, eid).status_code == 409


def test_us26_technician_scope_and_audit(db, signed_in):
    eid = event(db)
    assert progress(signed_in, eid).status_code == 403
    request(db, signed_in, eid)
    response = progress(signed_in, eid, "unavailable", notes="Broken connector", alternative="E1")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["lines"][0]["notes"] == "Broken connector"
    assert body["lines"][0]["alternative"] == "E1"
    assert body["history"][0]["by"] == "Wei Lim"
    assert body["history"][0]["at"]
    other = User(name="Other tech", email="other@test.edu", role=Role.tech, password_hash=_PASSWORD_HASH, is_active=True, session_version=0, failed_login_attempts=0)
    db.add(other); db.commit()
    session = TestClient(app)
    assert login(session, other.email).status_code == 200
    assert session.get("/equipment/requests").json() == []
    assert session.get(f"/events/{eid}/equipment").status_code == 403
    assert session.patch(f"/events/{eid}/equipment/E2", json={"status": "reserved"}).status_code == 403


def test_us27_overlap_boundaries_maintenance_and_shortfall(db, signed_in):
    a, b, c = event(db), event(db, 11, 13), event(db, 12, 14)
    for eid in (a, b, c):
        request(db, signed_in, eid, 4)
    stock = db.get(models.EquipmentStock, "E2")
    stock.maintenance = 1; stock.out_of_service = 1; db.commit()
    assert progress(signed_in, a).status_code == 200
    assert available(signed_in, b) == 0
    assert available(signed_in, c) == 4  # adjacent intervals don't overlap
    assert progress(signed_in, b).status_code == 409
    assert available(signed_in, a) == 4  # excludes own reservation


def test_us27_uses_peak_not_sum_for_disjoint_reservations(db, signed_in):
    a, b, spanning = event(db, 9, 10), event(db, 10, 11), event(db, 9, 11)
    for eid in (a, b, spanning):
        request(db, signed_in, eid, 4)
    assert progress(signed_in, a).status_code == 200
    assert progress(signed_in, b).status_code == 200
    assert available(signed_in, spanning) == 2


def test_us28_amend_release_and_event_item_links(db, signed_in):
    a, b = event(db), event(db)
    for eid in (a, b): request(db, signed_in, eid, 4)
    assert progress(signed_in, a).status_code == 200
    assert available(signed_in, b) == 2
    assert progress(signed_in, a, quantity=3).status_code == 200
    assert available(signed_in, b) == 3
    reservation = db.query(models.EquipmentReservation).one()
    assert (reservation.event_id, reservation.item_id, reservation.quantity) == (a, "E2", 3)
    assert progress(signed_in, a, "pending").status_code == 200
    assert available(signed_in, b) == 6
    assert db.query(models.EquipmentReservation).count() == 0


def test_us25_fulfilled_and_reserved_lines_cannot_be_amended(db, signed_in):
    eid = event(db)
    request(db, signed_in, eid)
    assert progress(signed_in, eid, "fulfilled").status_code == 409
    assert progress(signed_in, eid).status_code == 200
    assert request(db, signed_in, eid, 3).status_code == 409
    assert progress(signed_in, eid, "fulfilled").status_code == 200
    assert request(db, signed_in, eid, 3).status_code == 409
    assert progress(signed_in, eid, "pending").status_code == 409
    assert signed_in(Role.coordinator).patch(f"/events/{eid}/details", json={"start": "09:00"}).status_code == 409


def test_us28_cancelled_reservations_no_longer_consume_stock(db, signed_in):
    a, b = event(db), event(db)
    for eid in (a, b): request(db, signed_in, eid, 4)
    progress(signed_in, a)
    db.get(models.Event, a).status = models.EventStatus.cancelled
    db.commit()
    assert available(signed_in, b) == 6
    assert progress(signed_in, a).status_code == 409
