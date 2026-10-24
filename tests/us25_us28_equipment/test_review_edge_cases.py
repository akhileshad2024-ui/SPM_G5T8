from test_equipment_api import event, request
from auth_testkit import get_user, _PASSWORD_HASH, login
from login.models import Role, User
from fastapi.testclient import TestClient
from main import app
import equipment


def test_unassigned_tech_cannot_read_request_via_any_event_endpoint(db, signed_in):
    equipment.seed_catalogue(db)
    eid = event(db)
    assert request(db, signed_in, eid).status_code == 200
    user = User(name='Unassigned', email='unassigned@test.edu', role=Role.tech, password_hash=_PASSWORD_HASH,
                is_active=True, session_version=0, failed_login_attempts=0)
    db.add(user); db.commit()
    client=TestClient(app)
    assert login(client,user.email).status_code==200
    assert client.get(f'/events/{eid}/equipment').status_code==403
    response=client.get(f'/events/{eid}')
    assert response.status_code==403
    assert eid not in [row['id'] for row in client.get('/events').json()]
    assert client.get(f'/events/{eid}/history').status_code == 403


def test_empty_request_is_removed_from_technician_list(db,signed_in):
    equipment.seed_catalogue(db)
    eid=event(db)
    assert request(db,signed_in,eid).status_code==200
    assert signed_in(Role.coordinator).put(f'/events/{eid}/equipment',json={'techId':get_user(db,Role.tech).id,'lines':[]}).status_code==200
    tech=signed_in(Role.tech)
    assert eid not in [r['id'] for r in tech.get('/equipment/requests').json()]
    assert eid not in [r['id'] for r in tech.get('/events').json()]
