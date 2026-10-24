"""Change-request rules (US33/US34), independent of HTTP and the database."""


class ChangeRequestError(ValueError):
    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code


def prepare_request(event, user, proposed_changes):
    """Return a proposal only; never change the event being reviewed."""
    if user.role != "organiser" or event.organiser_id != user.id:
        raise ChangeRequestError(403, "Only the event organiser can request changes.")
    # These are the existing submitted/planning stages, including Confirmed.
    # Draft editing and closed requests use their own workflows.
    if event.status not in {"submitted", "under_review", "pending_clarification", "approved", "confirmed"}:
        raise ChangeRequestError(409, "This event is not open for change requests.")
    text = proposed_changes.strip()
    if not text:
        raise ChangeRequestError(422, "Describe the proposed change.")
    return {"proposed_changes": text, "status": "pending"}


def prepare_decision(event, request, user, outcome, reason, now):
    """US34: record a decision, not an automatic event edit or rebooking."""
    if user.role != "coordinator" or event.coordinator_id != user.id:
        raise ChangeRequestError(403, "Only the assigned Event Coordinator can review this request.")
    if request.status != "pending":
        raise ChangeRequestError(409, "This change request has already been reviewed.")
    if outcome not in {"accepted", "rejected"}:
        raise ChangeRequestError(422, "Accept or reject the change request.")
    return {"status": outcome, "decision": {
        "outcome": outcome, "reason": reason.strip(),
        "by": user.name, "by_id": user.id, "at": now.isoformat(),
    }}
