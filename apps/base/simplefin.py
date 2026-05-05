import base64
import binascii
from typing import Any

import requests


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
    try:
        response = requests.get(f"{access_url.rstrip('/')}/accounts", params=params, timeout=30)
    except requests.RequestException as e:
        raise SimpleFINError(f"Could not reach SimpleFIN bridge: {e}") from e
    if response.status_code == 401:
        raise SimpleFINError("Access URL is no longer valid. Re-link the connection.")
    if not response.ok:
        raise SimpleFINError(f"Fetch failed ({response.status_code}): {response.text[:200]}")
    try:
        return response.json()
    except ValueError as e:
        raise SimpleFINError("SimpleFIN response was not valid JSON.") from e
