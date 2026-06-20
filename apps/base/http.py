"""Small HTTP helpers shared across apps."""

import json


def parse_json_body(request) -> dict:
    """Parse the JSON body of a request, returning {} on any error."""
    try:
        return json.loads(request.body)
    except (json.JSONDecodeError, AttributeError):
        return {}
