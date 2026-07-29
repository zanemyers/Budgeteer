import base64
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

import requests

from apps.banking.simplefin import SimpleFINError, claim_setup_token, fetch_accounts

POST_PATH = "apps.banking.simplefin.requests.post"
GET_PATH = "apps.banking.simplefin.requests.get"


class TestClaimSetupToken(SimpleTestCase):
    def test_rejects_empty_token(self):
        with self.assertRaises(SimpleFINError):
            claim_setup_token("")

    def test_rejects_non_base64_token(self):
        with self.assertRaises(SimpleFINError):
            claim_setup_token("@@@@not base64@@@@")

    def test_rejects_token_that_does_not_decode_to_a_url(self):
        token = base64.b64encode(b"just some text").decode()
        with self.assertRaises(SimpleFINError):
            claim_setup_token(token)

    def test_returns_access_url_on_success(self):
        token = base64.b64encode(b"https://bridge.example/claim/abc").decode()
        resp = Mock(status_code=200, ok=True, text="https://access.example/xyz\n")
        with patch(POST_PATH, return_value=resp) as mock_post:
            access_url = claim_setup_token(token)
        self.assertEqual(access_url, "https://access.example/xyz")
        mock_post.assert_called_once()

    def test_raises_when_already_claimed(self):
        token = base64.b64encode(b"https://bridge.example/claim/abc").decode()
        resp = Mock(status_code=403, ok=False, text="")
        with patch(POST_PATH, return_value=resp), self.assertRaises(SimpleFINError) as cm:
            claim_setup_token(token)
        self.assertIn("already been claimed", str(cm.exception))

    def test_raises_on_network_error(self):
        token = base64.b64encode(b"https://bridge.example/claim/abc").decode()
        with patch(POST_PATH, side_effect=requests.RequestException("boom")), self.assertRaises(SimpleFINError):
            claim_setup_token(token)


class TestFetchAccounts(SimpleTestCase):
    def test_returns_parsed_json_and_builds_url(self):
        resp = Mock(status_code=200, ok=True)
        resp.json.return_value = {"accounts": []}
        with patch(GET_PATH, return_value=resp) as mock_get:
            data = fetch_accounts("https://access.example/")
        self.assertEqual(data, {"accounts": []})
        args, _ = mock_get.call_args
        self.assertEqual(args[0], "https://access.example/accounts")

    def test_passes_date_params(self):
        resp = Mock(status_code=200, ok=True)
        resp.json.return_value = {}
        with patch(GET_PATH, return_value=resp) as mock_get:
            fetch_accounts("https://access.example", start_date=100, end_date=200)
        _, kwargs = mock_get.call_args
        self.assertEqual(kwargs["params"], {"start-date": 100, "end-date": 200})

    def test_raises_when_access_url_invalid(self):
        resp = Mock(status_code=401, ok=False, text="")
        with patch(GET_PATH, return_value=resp), self.assertRaises(SimpleFINError) as cm:
            fetch_accounts("https://access.example")
        self.assertIn("no longer valid", str(cm.exception))

    def test_raises_on_invalid_json(self):
        resp = Mock(status_code=200, ok=True)
        resp.json.side_effect = ValueError("bad json")
        with patch(GET_PATH, return_value=resp), self.assertRaises(SimpleFINError):
            fetch_accounts("https://access.example")
