import base64
import binascii
import time
from typing import Any

import requests

# The bridge answers in well under two seconds when healthy, but stalls past the read timeout
# every so often — most likely while it refreshes from the upstream bank rather than serving its
# cache. A single attempt turned one of those stalls into a failed sync, and because the failure
# is persisted and only cleared by the next success, a six-hourly cron left a red banner up for
# hours over a blip that a manual retry cleared immediately.
FETCH_ATTEMPTS = 3
FETCH_BACKOFF_SECONDS = (2, 6)


class SimpleFINError(Exception):
    pass


def claim_setup_token(setup_token: str) -> str:
    setup_token = setup_token.strip()
    if not setup_token:
        raise SimpleFINError("Setup token is required.")

    try:
        claim_url = base64.b64decode(setup_token, validate=True).decode().strip()
    except (binascii.Error, UnicodeDecodeError) as e:
        raise SimpleFINError("Setup token is not valid base64.") from e

    if not claim_url.startswith(("http://", "https://")):
        raise SimpleFINError("Decoded setup token is not a URL.")

    try:
        response = requests.post(claim_url, timeout=15)
    except requests.RequestException as e:
        raise SimpleFINError(f"Could not reach SimpleFIN bridge: {e}") from e

    if response.status_code == 403:
        raise SimpleFINError("Setup token has already been claimed. Generate a new one.")
    if not response.ok:
        raise SimpleFINError(f"Claim failed ({response.status_code}): {response.text[:200]}")

    access_url = response.text.strip()
    if not access_url.startswith(("http://", "https://")):
        raise SimpleFINError("Claim response was not a URL.")
    return access_url


def fetch_accounts(access_url: str, start_date: int | None = None, end_date: int | None = None) -> dict[str, Any]:
    """Call /accounts on the SimpleFIN bridge. Returns the parsed JSON body."""
    params: dict[str, Any] = {}
    if start_date is not None:
        params["start-date"] = start_date
    if end_date is not None:
        params["end-date"] = end_date
    url = f"{access_url.rstrip('/')}/accounts"
    # Only connection-level failures are retried. A 401 or a malformed body is a real answer from
    # the bridge and repeating the call cannot change it.
    last_error: requests.RequestException | None = None
    for attempt in range(FETCH_ATTEMPTS):
        try:
            response = requests.get(url, params=params, timeout=30)
            break
        except (requests.Timeout, requests.ConnectionError) as e:
            last_error = e
            if attempt < FETCH_ATTEMPTS - 1:
                time.sleep(FETCH_BACKOFF_SECONDS[attempt])
        except requests.RequestException as e:
            raise SimpleFINError(f"Could not reach SimpleFIN bridge: {e}") from e
    else:
        raise SimpleFINError(
            f"Could not reach SimpleFIN bridge after {FETCH_ATTEMPTS} attempts: {last_error}"
        ) from last_error
    if response.status_code == 401:
        raise SimpleFINError("Access URL is no longer valid. Re-link the connection.")
    if not response.ok:
        raise SimpleFINError(f"Fetch failed ({response.status_code}): {response.text[:200]}")
    try:
        return response.json()
    except ValueError as e:
        raise SimpleFINError("SimpleFIN response was not valid JSON.") from e
