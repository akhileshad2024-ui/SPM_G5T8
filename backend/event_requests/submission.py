"""US04 submission data, independent of FastAPI and database access.

Authentication and persistence belong to the API. No unsupported mandatory
field list is introduced here. Lead queue access belongs to its own boundary.
"""

from copy import deepcopy
from datetime import datetime
from typing import Any, Mapping


def prepare_submission(information: Mapping[str, Any], submitted_at: datetime) -> dict[str, Any]:
    """Keep the supplied information and prepare an unassigned submission.

    The API supplies the server timestamp, not the browser. A deep copy keeps
    nested selections independent from the caller's editable form.
    """
    return {
        "status": "submitted",
        "draft_form": deepcopy(dict(information)),
        "submitted_at": submitted_at,
        "coordinator_id": None,
    }
