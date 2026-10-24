"""US27 AC5 local API latency evidence; does not claim deployed SLA coverage."""
from datetime import datetime, time, timedelta
from time import perf_counter
import equipment, models
from test_equipment_api import event, request
from login.models import Role


def test_availability_under_three_seconds_with_1000_reservations(db, signed_in):
    equipment.seed_catalogue(db)
    eid = event(db)
    assert request(db, signed_in, eid).status_code == 200
    target = db.get(models.Event, eid)
    start = datetime.combine(target.date, time(10))
    # Each historic event has its own reservation. None consumes this event's stock.
    rows = [models.Event(name=f'Historical {i}', status=models.EventStatus.approved,
        organiser_id=target.organiser_id, coordinator_id=target.coordinator_id,
        date=target.date-timedelta(days=1), start_time=time(10), end_time=time(12),
        equipment=[], facilities=[], accessibility=[], registration_required=False) for i in range(1000)]
    db.add_all(rows); db.flush()
    db.add_all([models.EquipmentReservation(event_id=row.id, item_id='E2', quantity=1,
        start=start-timedelta(days=1), end=start-timedelta(days=1)+timedelta(hours=2)) for row in rows])
    db.commit()
    tech = signed_in(Role.tech)
    elapsed = []
    for _ in range(5):
        begin = perf_counter()
        response = tech.get(f'/events/{eid}/equipment')
        elapsed.append(perf_counter()-begin)
        assert response.status_code == 200
        assert next(item for item in response.json()['availability'] if item['id']=='E2')['available'] == 6
    print(f'US27 API seconds (1000 reservations, 5 requests): {elapsed}; max={max(elapsed):.4f}')
    assert max(elapsed) < 3
