"""Small HTTP helpers shared across apps."""

import json
from typing import Any


def parse_json_body(request) -> dict[str, Any]:
    """Parse the JSON body of a request, returning {} on any error or non-object body."""
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, AttributeError):
        return {}
    # A bare `null`, list, or string parses fine but has no .get(), so callers would crash on it.
    return data if isinstance(data, dict) else {}
