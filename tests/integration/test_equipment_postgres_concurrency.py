"""Opt-in US28 PostgreSQL row-lock test on a LOCAL disposable PostgreSQL.

DOD_POSTGRES_TEST_URL=postgresql+psycopg://...@127.0.0.1:55432/testdb
No shared database: creates and drops only a uniquely named temporary schema.
"""
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from concurrent.futures import ThreadPoolExecutor
from datetime import date, time
from threading import Barrier
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session
import equipment, models
from database import Base
from login.models import Role, User


def test_competing_postgres_reservations_allocate_last_unit_once():
    url = os.getenv('DOD_POSTGRES_TEST_URL')
    if not url:
        pytest.skip('Set DOD_POSTGRES_TEST_URL to a local disposable PostgreSQL to verify real row locking.')
    parsed = make_url(url)
    assert parsed.get_backend_name() == 'postgresql' and parsed.host in {'127.0.0.1', 'localhost'}, 'Only local disposable PostgreSQL is accepted'
    schema = 'dod_equipment_' + uuid4().hex
    root = create_engine(url)
    with root.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA {schema}'))
    engine = root.execution_options(schema_translate_map={None:schema})
    try:
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            users = [User(name=name,email=f'{name}@test.invalid',role=role,password_hash='unused',is_active=True,
                session_version=0,failed_login_attempts=0) for name,role in [('organiser',Role.organiser),('coordinator',Role.coordinator),('technician',Role.tech)]]
            db.add_all(users); db.flush()
            owner,coordinator,tech = users
            tech_id=tech.id
            db.add(models.EquipmentStock(id='E2',name='Projector',total=1,maintenance=0,out_of_service=0))
            events=[models.Event(name=f'Competing {i}',status=models.EventStatus.approved,
                organiser_id=owner.id,coordinator_id=coordinator.id,date=date(2027,1,4),
                start_time=time(10),end_time=time(12),facilities=[],accessibility=[],
                equipment=[{'id':'E2','qty':1,'status':'pending','technicalRequirements':'HDMI'}],
                equipment_state='requested',registration_required=False) for i in range(2)]
            db.add_all(events);db.flush()
            ids=[event.id for event in events]
            db.add_all([models.EquipmentAssignment(event_id=eid,tech_id=tech_id) for eid in ids]);db.commit()
        barrier=Barrier(2)
        def reserve(eid):
            with Session(engine) as db:
                barrier.wait(timeout=10)
                try:
                    equipment.update_line(eid,'E2',equipment.ProgressIn(status='reserved'),db=db,
                        user=SimpleNamespace(id=tech_id,role=Role.tech))
                    return 200
                except HTTPException as error:
                    db.rollback()
                    return error.status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(reserve,ids))
        assert sorted(results)==[200,409]
        with Session(engine) as db:
            assert db.query(models.EquipmentReservation).count()==1
    finally:
        with root.begin() as connection:
            connection.execute(text(f'DROP SCHEMA {schema} CASCADE'))
        root.dispose()
