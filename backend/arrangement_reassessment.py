"""US50/51/45 shared reassessment service. Callers lock the event and commit.

Structured accepted values are a review snapshot, not an automatic event edit.
Legacy text-only decisions recheck saved facts without interpreting prose. Flags
never release reservations or cancel registrations. Existing US38 JSON flags are
read by the same gates and are never overwritten by these records.
"""
from datetime import datetime, timezone
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
import models
import messaging
from event_updates import DETAIL_FIELDS
from login.models import Role


def facts(event):
    values = {key: getattr(event, column) for key, column in DETAIL_FIELDS.items()}
    # Operational status/notes change when Technical Support releases a hold;
    # they are not stale edits to the reviewed equipment requirements.
    values["equip"] = [{"id": line["id"], "qty": line["qty"],
                        "technicalRequirements": line.get("technicalRequirements", "")}
                       for line in event.equipment or []]
    return values


def effective_facts(event, changes):
    values = {**facts(event), **changes}
    if values["date"] is None or values["start"] is None or values["end"] is None:
        if changes:
            raise HTTPException(422, "Reviewed changes need a complete event date and time.")
    elif values["start"] >= values["end"]:
        raise HTTPException(422, "The event end must be after its start.")
    if len({line["id"] for line in values["equip"]}) != len(values["equip"]):
        raise HTTPException(422, "Use one equipment line per type.")
    return values


def equipment_reasons(reservation, line, values, available=None):
    """Pure comparisons; the caller supplies authoritative saved reservation data."""
    reasons = []
    if line is None:
        return ["This equipment is no longer requested."]
    if reservation.quantity != line["qty"]:
        reasons.append("Reserved quantity differs from the reviewed requirement.")
    if values["date"] and values["start"] and values["end"]:
        if (reservation.start, reservation.end) != (
                datetime.combine(values["date"], values["start"]), datetime.combine(values["date"], values["end"])):
            reasons.append("Reservation period differs from the reviewed event period.")
    if available is not None and line["qty"] > available:
        reasons.append("Insufficient equipment available for the reviewed period.")
    return reasons


def registration_reasons(values, registered):
    reasons = []
    if not values["reg"] and registered:
        reasons.append("Registration is disabled but attendees still hold registrations.")
    if values["reg"]:
        if values["regCap"] is not None and values["regCap"] < registered:
            reasons.append("Registration capacity is below the number already registered.")
        if values["date"] and values["regClose"] and values["regClose"] > values["date"]:
            reasons.append("Registration closes after the event date.")
    return reasons


def open_flags(db, event_id):
    db.flush()
    return db.query(models.ArrangementReassessment).filter_by(
        event_id=event_id, resolved_at=None).order_by(models.ArrangementReassessment.id).all()


def outstanding(db, event):
    return [f"{flag.target_type.title()} {flag.target_id}: Requires Reassessment — {flag.reason}"
            for flag in open_flags(db, event.id)]


def add_flag(db, event, source, source_id, kind, target_id, reasons, context, now):
    row = models.ArrangementReassessment(event_id=event.id, source=source, source_id=source_id,
        target_type=kind, target_id=target_id, reason=" ".join(reasons),
        context=jsonable_encoder(context), created_at=now)
    db.add(row)
    return row


def accepted(db, event, request, changes, now):
    """Automatically called exactly once inside the locked US34 decision transaction."""
    from types import SimpleNamespace
    import equipment
    import registrations
    values = effective_facts(event, changes)
    checked = 0
    flagged = []
    original = {line["id"]: line for line in event.equipment or []}
    wanted = {line["id"]: line for line in values["equip"]}
    stock = {row.id: row for row in equipment.stocks(db, True)}
    period_event = SimpleNamespace(id=event.id, date=values["date"], start_time=values["start"], end_time=values["end"])
    for reservation in db.query(models.EquipmentReservation).filter_by(event_id=event.id).order_by(models.EquipmentReservation.id):
        checked += 1
        line = wanted.get(reservation.item_id)
        free = None
        if all(values[key] is not None for key in ("date", "start", "end")) and reservation.item_id in stock:
            free = equipment.availability(db, period_event, stock[reservation.item_id])
        reasons = equipment_reasons(reservation, line, values, free)
        if line and line.get("technicalRequirements", "") != original.get(reservation.item_id, {}).get("technicalRequirements", ""):
            reasons.append("Technical requirements have changed and need review.")
        if reasons:
            flag = add_flag(db, event, "change_request", request.id, "equipment", reservation.id,
                reasons, {"item_id": reservation.item_id, "effective": values}, now)
            flagged.append(flag)
            messaging.notify(db, messaging.assigned_tech(event), event, "Equipment requires reassessment",
                f"{event.name}: reservation #{reservation.id} ({reservation.item_id}) Requires Reassessment. {' '.join(reasons)}")
    registered = registrations.registered_count(db, event.id)
    reasons = registration_reasons(values, registered)
    if reasons:
        flagged.append(add_flag(db, event, "change_request", request.id, "registration", event.id,
            reasons, {"effective": values}, now))
    impact_keys = ("name", "date", "start", "end", "reg", "regCap", "regClose", "venueLocation")
    changed = [key for key in impact_keys if values[key] != facts(event)[key]]
    if changed and registered:
        details = "; ".join(f"{key}: {jsonable_encoder(values[key])}" for key in changed)
        messaging.attendees_affected(db, event, f"An accepted change affects {details}. Your registration is retained; review the updated arrangements.")
    db.flush()
    return {"basis": "reviewed_values" if changes else "saved_details", "before": jsonable_encoder(facts(event)), "effective_changes": jsonable_encoder(changes),
            "effective": jsonable_encoder(values), "equipment_checked": checked,
            "registration_checked": True, "flag_ids": [flag.id for flag in flagged], "attendees_affected": bool(changed and registered)}


def target_rows(db, event, targets):
    rows = []
    seen = set()
    for target in targets:
        kind, target_id = target["type"], target["id"]
        if (kind, target_id) in seen:
            raise HTTPException(422, "Do not name the same arrangement twice.")
        seen.add((kind, target_id))
        model = models.VenueBooking if kind == "venue" else models.EquipmentReservation
        row = db.query(model).filter_by(id=target_id, event_id=event.id).first()
        if row is None or (kind == "venue" and row.status not in ("pending", "approved")):
            raise HTTPException(422, "Name an active arrangement belonging to this event.")
        rows.append((kind, row))
    return rows


def safety_rework(db, event, review, targets, now):
    for kind, row in target_rows(db, event, targets):
        context = {"item_id": row.item_id} if kind == "equipment" else {}
        add_flag(db, event, "safety_review", review.id, kind, row.id,
                 [review.comment or "Safety arrangement needs revision."], context, now)
        if kind == "equipment":
            messaging.notify(db, messaging.assigned_tech(event), event, "Equipment requires reassessment",
                f"{event.name}: safety review #{review.id} names reservation #{row.id} ({row.item_id}). {review.comment}")
        else:
            messaging.venue_booking_reassess(db, row, cause=f"safety review #{review.id}")


def planning_stage(db, event):
    if event.status not in ("approved", "safety_rejected", "safety_changes_requested"):
        return None
    latest = db.query(models.SafetyReview).filter_by(event_id=event.id).order_by(models.SafetyReview.id.desc()).first()
    if latest is None or latest.outcome == "approved":
        return None
    kinds = {flag.target_type for flag in db.query(models.ArrangementReassessment).filter_by(
        event_id=event.id, source="safety_review", source_id=latest.id)}
    return "venue_and_equipment_planning" if len(kinds) > 1 else "venue_planning" if "venue" in kinds else "equipment_planning" if "equipment" in kinds else "arrangement_planning"


def resolve(db, event, flag, user, note, now):
    """Authorised staff attest revised arrangements; mechanical checks cannot replace a safety review."""
    if not note.strip():
        raise HTTPException(422, "Record how the arrangement was resolved.")
    if flag.resolved_at:
        raise HTTPException(409, "This reassessment is already resolved.")
    coordinator = user.role == Role.coordinator and event.coordinator_id == user.id
    if flag.target_type == "equipment":
        if user.role != Role.tech or messaging.assigned_tech(event) != user.id:
            raise HTTPException(403, "Only the assigned technician can resolve equipment reassessment.")
    elif not coordinator and not (flag.target_type == "venue" and user.role == Role.venue):
        raise HTTPException(403, "Only the responsible staff can resolve this reassessment.")
    if flag.source == "change_request":
        request = db.get(models.EventChangeRequest, flag.source_id)
        evaluation = request.decision.get("reassessment", {}) if request and request.decision else {}
        if evaluation.get("effective_changes") and not evaluation.get("applied_at"):
            raise HTTPException(409, "Apply the reviewed event details before resolving this reassessment.")
    if flag.target_type == "equipment":
        import equipment
        item_id = flag.context["item_id"]
        line = next((line for line in event.equipment or [] if line["id"] == item_id), None)
        reservation = db.query(models.EquipmentReservation).filter_by(event_id=event.id, item_id=item_id).first()
        if line:
            if reservation is None or line.get("status") not in ("reserved", "fulfilled") or equipment_reasons(reservation, line, facts(event)):
                raise HTTPException(409, "Reserve the revised equipment for the event before resolving.")
            stock = db.get(models.EquipmentStock, item_id)
            if stock and line["qty"] > equipment.availability(db, event, stock):
                raise HTTPException(409, "The revised equipment still exceeds available stock.")
        elif reservation is not None:
            raise HTTPException(409, "Release the removed equipment reservation first.")
    if flag.target_type == "registration":
        import registrations
        if registration_reasons(facts(event), registrations.registered_count(db, event.id)):
            raise HTTPException(409, "Registration settings are still invalid.")
    if flag.target_type == "venue":
        row = db.get(models.VenueBooking, flag.target_id)
        if row and row.status not in ("cancelled", "rejected", "expired") and (row.status != "approved" or row.flag or row.reassessment):
            raise HTTPException(409, "Approve or replace the venue and resolve its existing flags first.")
    flag.resolved_at, flag.resolved_by_id, flag.resolution = now, user.id, note.strip()


def preparation_issues(db, event):
    from event_confirmation import outstanding as confirmation_issues
    issues = confirmation_issues(db, event, datetime.now(timezone.utc))
    if event.status == "confirmed":
        issues = [issue for issue in issues if "Safety Officer hasn't approved" not in issue]
    latest = db.query(models.SafetyReview).filter_by(event_id=event.id).order_by(models.SafetyReview.id.desc()).first()
    if event.status not in ("safety_approved", "confirmed") or latest is None or latest.outcome != "approved":
        issues.append("The Safety Officer must approve before preparation can start.")
    return issues, latest
