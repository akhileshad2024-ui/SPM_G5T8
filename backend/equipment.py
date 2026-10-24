"""US25–US28 equipment requests, assigned technicians and interval reservations.

All writes lock the event, then catalogue rows in id order. PostgreSQL serializes
competing reservations on these shared stock rows; SQLite is used only by tests.
US36 owns delivery of request/status notifications, not this module.
"""
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from login.models import Role, User
from login.security import require_roles
import models
from messaging import notify

router = APIRouter()
CATALOGUE = [("E1", "Wireless microphone", 12), ("E2", "Projector", 6),
             ("E3", "PA system", 4), ("E4", "Stage lighting rig", 2), ("E5", "Live-stream kit", 3)]
PLANNING = {"submitted", "under_review", "pending_clarification", "approved"}


class Line(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Literal["E1", "E2", "E3", "E4", "E5"]
    qty: StrictInt = Field(gt=0)
    technicalRequirements: str = ""


class RequestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    techId: int
    lines: list[Line]

    @model_validator(mode="after")
    def unique_items(self):
        if len({line.id for line in self.lines}) != len(self.lines):
            raise ValueError("Use one line per equipment type.")
        return self


class ProgressIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["pending", "reserved", "unavailable", "fulfilled"]
    notes: str = Field(default="", max_length=2000)
    alternative: str = Field(default="", max_length=500)
    quantity: StrictInt | None = Field(default=None, gt=0)


def seed_catalogue(db):
    # Concurrent startup workers may all seed; the primary key resolves races.
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert
    insert = pg_insert if db.bind.dialect.name == "postgresql" else sqlite_insert
    for item_id, name, total in CATALOGUE:
        db.execute(insert(models.EquipmentStock).values(id=item_id, name=name, total=total,
            maintenance=0, out_of_service=0).on_conflict_do_nothing(index_elements=["id"]))
    db.commit()


def event_for(db, event_id, user, write=False):
    q = db.query(models.Event).filter(models.Event.id == event_id)
    event = (q.with_for_update() if write else q).first()
    if event is None:
        raise HTTPException(404, "Event not found")
    assignment = db.get(models.EquipmentAssignment, event_id)
    permitted = ((user.role == Role.coordinator and event.coordinator_id == user.id)
                 or (user.role == Role.tech and assignment is not None and assignment.tech_id == user.id))
    if not permitted:
        raise HTTPException(403, "Only the assigned coordinator or technician can access this equipment request.")
    return event


def period(event):
    if not event.date or not event.start_time or not event.end_time or event.start_time >= event.end_time:
        raise HTTPException(409, "Set a valid event date and time before checking or reserving equipment.")
    return datetime.combine(event.date, event.start_time), datetime.combine(event.date, event.end_time)


def stocks(db, lock=False):
    stmt = select(models.EquipmentStock).order_by(models.EquipmentStock.id)
    return list(db.scalars(stmt.with_for_update() if lock else stmt))


def availability(db, event, stock):
    start, end = period(event)
    rows = db.query(models.EquipmentReservation).join(models.Event).filter(
        models.EquipmentReservation.item_id == stock.id,
        models.EquipmentReservation.event_id != event.id,
        models.EquipmentReservation.start < end, models.EquipmentReservation.end > start,
        models.Event.status.notin_([models.EventStatus.cancelled, models.EventStatus.rejected]),
    ).all()
    return max(0, stock.total - stock.maintenance - stock.out_of_service - peak_reserved(rows, start, end))


def peak_reserved(rows, start, end):
    """Maximum simultaneous held quantity in the half-open interval [start, end)."""
    edges = [(max(start, r.start), r.quantity) for r in rows if r.start < end and r.end > start]
    edges += [(min(end, r.end), -r.quantity) for r in rows if r.start < end and r.end > start]
    used = peak = 0
    for _, delta in sorted(edges, key=lambda edge: (edge[0], edge[1])):
        used += delta
        peak = max(peak, used)
    return peak


def snapshot(db, event):
    assignment = db.get(models.EquipmentAssignment, event.id)
    stock = stocks(db)
    free = {s.id: availability(db, event, s) for s in stock}
    history = db.query(models.EquipmentUpdate, User.name).join(User, User.id == models.EquipmentUpdate.changed_by_id).filter(
        models.EquipmentUpdate.event_id == event.id).order_by(models.EquipmentUpdate.id.desc()).all()
    return {"eventId": event.id, "techId": assignment.tech_id if assignment else None,
            "editable": event.status in PLANNING, "lines": event.equipment or [],
            "availability": [{"id": s.id, "name": s.name, "total": s.total,
                              "maintenance": s.maintenance, "outOfService": s.out_of_service,
                              "available": free[s.id]} for s in stock],
            "history": [{"itemId": h.item_id, "by": name, "at": h.changed_at.replace(tzinfo=timezone.utc).isoformat(), "changes": h.changes} for h, name in history],
            "notificationPending": None}


def audit(db, event, user, changes, item_id=None):
    now = datetime.now(timezone.utc)
    event.updated_at = now
    db.add(models.EquipmentUpdate(event_id=event.id, item_id=item_id, changed_by_id=user.id, changed_at=now, changes=changes))
    lines = event.equipment or []
    event.equipment_state = ("reserved" if lines and all(l.get("status") in {"reserved", "fulfilled"} for l in lines)
                             else "requested" if lines else None)


@router.get("/equipment/technicians")
def technicians(db: Session = Depends(get_db), user: User = Depends(require_roles(Role.coordinator))):
    return [{"id": u.id, "name": u.name} for u in db.query(User).filter(User.role == Role.tech, User.is_active.is_(True)).all()]


@router.get("/events/{event_id}/equipment")
def get_equipment(event_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles(Role.coordinator, Role.tech))):
    return snapshot(db, event_for(db, event_id, user))


@router.put("/events/{event_id}/equipment")
def save_request(event_id: int, body: RequestIn, db: Session = Depends(get_db), user: User = Depends(require_roles(Role.coordinator))):
    event = event_for(db, event_id, user, True)
    if event.status not in PLANNING:
        raise HTTPException(409, "Equipment requests can be edited only during planning.")
    technician = db.get(User, body.techId)
    if technician is None or technician.role != Role.tech or not technician.is_active:
        raise HTTPException(422, "Choose an active technician.")
    old = {line["id"]: line for line in event.equipment or []}
    proposed = {line.id: line.model_dump() for line in body.lines}
    for item_id, line in old.items():
        if line.get("status") in {"reserved", "fulfilled"}:
            core = {key: line.get(key, "") for key in ("id", "qty", "technicalRequirements")}
            if proposed.get(item_id) != core:
                raise HTTPException(409, "Release reserved items before editing them; fulfilled items cannot be amended.")
    event.equipment = [{**old.get(line.id, {}), **line.model_dump(), "status": old.get(line.id, {}).get("status", "pending")} for line in body.lines]
    assignment = db.get(models.EquipmentAssignment, event.id)
    if assignment:
        assignment.tech_id = body.techId
    else:
        db.add(models.EquipmentAssignment(event_id=event.id, tech_id=body.techId))
    audit(db, event, user, {"lines": event.equipment, "techId": body.techId})
    notify(db, body.techId, event, "Equipment request submitted", f"{event.name}: review the equipment request and arrange the required items.")
    db.commit()
    return snapshot(db, event)


@router.patch("/events/{event_id}/equipment/{item_id}")
def update_line(event_id: int, item_id: str, body: ProgressIn, db: Session = Depends(get_db),
                user: User = Depends(require_roles(Role.tech))):
    event = event_for(db, event_id, user, True)
    if event.status in {"draft", "cancelled", "rejected"}:
        raise HTTPException(409, "Equipment cannot be updated for a closed or draft event.")
    old_lines = event.equipment
    line = next((dict(l) for l in event.equipment or [] if l["id"] == item_id), None)
    if line is None:
        raise HTTPException(404, "Equipment line not found")
    if line.get("status") == "fulfilled":
        raise HTTPException(409, "Fulfilled items cannot be amended.")
    stock = {s.id: s for s in stocks(db, True)}
    qty = body.quantity if body.quantity is not None else line["qty"]
    if body.status in {"reserved", "fulfilled"}:
        start, end = period(event)
        if body.status == "fulfilled" and line.get("status") != "reserved":
            raise HTTPException(409, "Reserve the item before marking it fulfilled.")
        if qty > availability(db, event, stock[item_id]):
            raise HTTPException(409, "Insufficient equipment available for this period.")
        reservation = db.query(models.EquipmentReservation).filter_by(event_id=event.id, item_id=item_id).first()
        if reservation is None:
            reservation = models.EquipmentReservation(event_id=event.id, item_id=item_id)
            db.add(reservation)
        reservation.quantity, reservation.start, reservation.end = qty, start, end
    else:
        db.query(models.EquipmentReservation).filter_by(event_id=event.id, item_id=item_id).delete()
    line.update(status=body.status, qty=qty, notes=body.notes.strip(), alternative=body.alternative.strip())
    event.equipment = [line if l["id"] == item_id else l for l in event.equipment]
    previous_status = next(l.get("status", "pending") for l in (old_lines or []) if l["id"] == item_id)
    audit(db, event, user, line, item_id)
    if previous_status != body.status:
        notify(db, event.coordinator_id, event, "Equipment status updated", f"{event.name}: {stock[item_id].name} is now {body.status}. Review the equipment arrangements.")
    db.commit()
    return snapshot(db, event)


@router.get("/equipment/requests")
def assigned_requests(db: Session = Depends(get_db), user: User = Depends(require_roles(Role.tech))):
    events = db.query(models.Event).join(models.EquipmentAssignment, models.EquipmentAssignment.event_id == models.Event.id).filter(
        models.EquipmentAssignment.tech_id == user.id,
        models.Event.equipment_state.is_not(None),
        models.Event.status.notin_([models.EventStatus.draft, models.EventStatus.rejected, models.EventStatus.cancelled]),
    ).order_by(models.Event.id).all()
    return [{"id": e.id, "name": e.name, "date": e.date.isoformat() if e.date else "", "start": str(e.start_time), "end": str(e.end_time)} for e in events]
