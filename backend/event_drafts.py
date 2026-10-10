"""Small business module for US05 — Save Event Request as Draft.

This module only prepares data for persistence. The FastAPI route and database
integration will be added separately, so this function does not accept an
organiser ID or write to a database.
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
