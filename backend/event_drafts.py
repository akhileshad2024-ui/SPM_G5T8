"""Draft business rules shared by US05 (save) and US06 (reopen/edit).

These functions do not use FastAPI or a database. Routes handle persistence
and supply the organiser identity from the authenticated session.
"""

from typing import Any, Mapping


def prepare_draft(saved_event_information: Mapping[str, Any]) -> dict[str, Any]:
    """Return the minimum stored form of an incomplete event request.

    An incomplete request is valid as a draft. ``dict(...)`` copies the
    information explicitly saved by the organiser into ``draft_form`` so the
    caller receives a distinct stored payload with the required Draft status.
    """
    return {
        "status": "draft",
        "draft_form": dict(saved_event_information),
    }


def can_edit_draft(status: str, organiser_id: int, authenticated_user_id: int) -> bool:
    """US06: an organiser may reopen/edit only their own unsubmitted draft."""
    if status != "draft":
        return False
    if organiser_id != authenticated_user_id:
        return False
    return True
