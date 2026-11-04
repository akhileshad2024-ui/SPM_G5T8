"""Shared flag reading/resolution, explicit change application and preparation.

No route automatically cancels registrations, releases stock or changes event
details as a side effect of accepting a proposal. Each write locks the event.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session
import models
import schemas
import arrangement_reassessment as reassessment
from database import get_db
from event_access import is_involved
from event_status import change_status
from event_updates import DETAIL_FIELDS
from login.models import Role, User
from login.security import get_current_user
from hold_expiry import as_utc

router = APIRouter()


def accessible(db, event_id, user, write=False, coordinator=False):
    query = db.query(models.Event).filter_by(id=event_id)
    event = (query.with_for_update() if write else query).first()
    if event is None:
        raise HTTPException(404, "Event not found")
    if coordinator:
        if user.role != Role.coordinator or event.coordinator_id != user.id:
            raise HTTPException(403, "Only the assigned coordinator can perform this step.")
    elif user.role == Role.attendee or not is_involved(event, user):
        raise HTTPException(403, "You cannot access these arrangements.")
    return event


@router.get("/events/{event_id}/reassessments")
def list_reassessments(event_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    event = accessible(db, event_id, user)
    rows = db.query(models.ArrangementReassessment).filter_by(event_id=event_id).order_by(models.ArrangementReassessment.id).all()
    if user.role == Role.tech:
        from messaging import assigned_tech
        if assigned_tech(event) != user.id:
            raise HTTPException(403, "Only the assigned technician can access these reassessments.")
        rows = [row for row in rows if row.target_type == "equipment"]
    if user.role == Role.venue:
        rows = [row for row in rows if row.target_type == "venue"]
    issues, latest = reassessment.preparation_issues(db, event)
    preparation = db.get(models.EventPreparation, event_id)
    return {"eventId": event_id, "planningStage": reassessment.planning_stage(db, event),
        "flags": [{"id": row.id, "targetType": row.target_type, "targetId": row.target_id,
                   "source": row.source, "sourceId": row.source_id, "reason": row.reason,
                   "status": "resolved" if row.resolved_at else "Requires Reassessment",
                   "createdAt": as_utc(row.created_at), "resolvedAt": as_utc(row.resolved_at),
                   "resolvedById": row.resolved_by_id, "resolution": row.resolution} for row in rows],
        "canPrepare": not issues, "preparationIssues": issues if user.role == Role.coordinator else [],
        "preparedAt": as_utc(preparation.started_at) if preparation and latest and preparation.safety_review_id == latest.id and not issues else None}


@router.post("/events/{event_id}/reassessments/{flag_id}/resolve")
def resolve_reassessment(event_id: int, flag_id: int, body: schemas.ReassessmentResolutionIn,
                         db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    event = accessible(db, event_id, user, write=True)
    if event.status in ("cancelled", "rejected", "draft"):
        raise HTTPException(409, "Closed or draft events cannot resolve arrangements.")
    flag = db.query(models.ArrangementReassessment).filter_by(id=flag_id, event_id=event_id).first()
    if flag is None:
        raise HTTPException(404, "Reassessment not found")
    reassessment.resolve(db, event, flag, user, body.note, datetime.now(timezone.utc))
    db.commit()
    return {"id": flag.id, "status": "resolved"}


@router.post("/events/{event_id}/change-requests/{request_id}/apply")
def apply_reviewed_changes(event_id: int, request_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    event = accessible(db, event_id, user, write=True, coordinator=True)
    if event.status in ("draft", "cancelled", "rejected", "pending_safety_review"):
        raise HTTPException(409, "This event cannot apply reviewed changes at its current stage.")
    request = db.query(models.EventChangeRequest).filter_by(id=request_id, event_id=event_id, status="accepted").first()
    evaluation = request.decision.get("reassessment", {}) if request and request.decision else {}
    if not evaluation.get("effective_changes"):
        raise HTTPException(409, "This accepted request has no structured changes to apply.")
    if evaluation.get("applied_at"):
        raise HTTPException(409, "These changes have already been applied.")
    changes = schemas.EventDetailsUpdate(**evaluation["effective_changes"]).model_dump(exclude_unset=True)
    current = jsonable_encoder(reassessment.facts(event))
    if any(current[key] != evaluation["before"][key] for key in changes):
        raise HTTPException(409, "Event details changed after this review. Submit a fresh change request.")
    if set(changes) & {"date", "start", "end", "equip"}:
        if db.query(models.EquipmentReservation).filter_by(event_id=event_id).first() or any(
                line.get("status") == "fulfilled" for line in event.equipment or []):
            raise HTTPException(409, "Technical Support must release affected reservations before applying equipment or time changes.")
    now = datetime.now(timezone.utc)
    for key, value in changes.items():
        setattr(event, DETAIL_FIELDS[key], value)
    if "equip" in changes:
        event.equipment_state = "requested" if event.equipment else None
    db.add(models.EventDetailChange(event_id=event_id, changed_by_id=user.id, changed_at=now,
        changes=jsonable_encoder(changes), affects_arrangements=True))
    event.updated_at = now
    if event.status in ("safety_approved", "confirmed", "safety_rejected", "safety_changes_requested"):
        change_status(db, event, models.EventStatus.approved, user, now,
            reason=f"Applied reviewed changes from request #{request_id}; arrangements need a fresh safety check.", rework=True)
    request.decision = {**request.decision, "reassessment": {**evaluation, "applied_at": now.isoformat(), "applied_by_id": user.id}}
    db.commit()
    return {"eventId": event_id, "applied": True}


@router.post("/events/{event_id}/preparation")
def start_preparation(event_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    event = accessible(db, event_id, user, write=True, coordinator=True)
    issues, review = reassessment.preparation_issues(db, event)
    if issues:
        raise HTTPException(409, " ".join(issues))
    saved = db.get(models.EventPreparation, event_id)
    if saved is None:
        saved = models.EventPreparation(event_id=event_id)
        db.add(saved)
    if saved.safety_review_id != review.id:
        saved.safety_review_id, saved.started_by_id = review.id, user.id
        saved.started_at = datetime.now(timezone.utc)
    db.commit()
    return {"eventId": event_id, "preparedAt": as_utc(saved.started_at), "safetyReviewId": saved.safety_review_id}
