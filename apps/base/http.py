"""Small HTTP helpers shared across apps."""

import json
from typing import Any


def parse_json_body(request) -> dict[str, Any]:
    """Parse the JSON body of a request, returning {} on any error."""
    try:
        return json.loads(request.body)
    except (json.JSONDecodeError, AttributeError):
        return {}
