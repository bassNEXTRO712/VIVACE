"""
Iteration 4 tests: role-based registration, forgot/reset password, user profile edit,
stats endpoint, account deletion (request + wrong-code 400 path).
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL",
                          "https://fastapi-company-db.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _register(role, name_prefix="TEST"):
    email = f"test_{uuid.uuid4().hex[:8]}@test.com"
    payload = {"name": f"{name_prefix} {role}", "email": email, "password": "test123", "role": role}
    r = requests.post(f"{API}/auth/register", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    return r.json(), email


# ---------------------------------------------------------------------------
# Role-based registration
# ---------------------------------------------------------------------------
class TestRoleRegistration:
    def test_register_role_user(self):
        data, email = _register("user")
        assert data["user"]["role"] == "user"
        assert data["user"]["company_id"] is None
        # verify via /auth/me
        r = requests.get(f"{API}/auth/me",
                         headers={"Authorization": f"Bearer {data['token']}"}, timeout=30)
        assert r.status_code == 200
        me = r.json()
        assert me["role"] == "user"
        assert me["company_id"] is None

    def test_register_role_company(self):
        data, email = _register("company")
        assert data["user"]["role"] == "company"
        assert data["user"]["company_id"]
        r = requests.get(f"{API}/auth/me",
                         headers={"Authorization": f"Bearer {data['token']}"}, timeout=30)
        assert r.status_code == 200
        me = r.json()
        assert me["role"] == "company"
        assert me["company_id"] == data["user"]["company_id"]

    def test_register_default_role_is_user(self):
        # omit role field
        email = f"test_{uuid.uuid4().hex[:8]}@test.com"
        r = requests.post(f"{API}/auth/register",
                          json={"name": "TEST default", "email": email, "password": "test123"},
                          timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["user"]["role"] == "user"
        assert d["user"]["company_id"] is None


# ---------------------------------------------------------------------------
# Forgot / Reset password
# ---------------------------------------------------------------------------
class TestPasswordReset:
    def test_forgot_password_unknown_email_still_returns_success(self):
        r = requests.post(f"{API}/auth/forgot-password",
                          json={"email": f"nobody_{uuid.uuid4().hex[:8]}@test.com"}, timeout=30)
        # spec: 200 regardless (do not leak whether email exists)
        assert r.status_code == 200
        assert "status" in r.json()

    def test_forgot_password_known_email(self):
        r = requests.post(f"{API}/auth/forgot-password",
                          json={"email": "curltest@test.com"}, timeout=30)
        assert r.status_code == 200
        assert "status" in r.json()

    def test_reset_password_wrong_code_returns_400(self):
        # request a code first (real one is emailed & unreachable)
        requests.post(f"{API}/auth/forgot-password",
                      json={"email": "curltest@test.com"}, timeout=30)
        r = requests.post(f"{API}/auth/reset-password",
                          json={"email": "curltest@test.com",
                                "code": "000000",
                                "new_password": "somethingnew"},
                          timeout=30)
        assert r.status_code == 400, r.text
        assert "detail" in r.json()

    def test_reset_password_wrong_email_returns_400(self):
        r = requests.post(f"{API}/auth/reset-password",
                          json={"email": f"nobody_{uuid.uuid4().hex[:8]}@test.com",
                                "code": "123456", "new_password": "abc123"},
                          timeout=30)
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# User profile edit (PUT /auth/profile)
# ---------------------------------------------------------------------------
class TestUserProfile:
    def test_update_name_persists(self):
        data, email = _register("user")
        token = data["token"]
        headers = {"Authorization": f"Bearer {token}"}
        new_name = f"TEST Renamed {uuid.uuid4().hex[:4]}"
        r = requests.put(f"{API}/auth/profile", json={"name": new_name},
                         headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["name"] == new_name
        # verify persistence via /auth/me
        me = requests.get(f"{API}/auth/me", headers=headers, timeout=30).json()
        assert me["name"] == new_name

    def test_update_profile_requires_auth(self):
        r = requests.put(f"{API}/auth/profile", json={"name": "hacker"}, timeout=30)
        assert r.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Stats endpoint
# ---------------------------------------------------------------------------
class TestStats:
    def test_stats_returns_positive_counters(self):
        r = requests.get(f"{API}/stats", timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("companies", "users", "countries"):
            assert k in d
            assert isinstance(d[k], int)
        # after multiple prior test runs there must be at least one of each
        assert d["users"] > 0
        assert d["companies"] > 0

    def test_stats_users_increases_after_register(self):
        before = requests.get(f"{API}/stats", timeout=30).json()
        _register("user")
        after = requests.get(f"{API}/stats", timeout=30).json()
        assert after["users"] >= before["users"] + 1


# ---------------------------------------------------------------------------
# Account deletion — request stage + wrong-code 400 path
# ---------------------------------------------------------------------------
class TestAccountDeletion:
    def test_request_deletion_returns_200(self):
        data, email = _register("user")
        headers = {"Authorization": f"Bearer {data['token']}"}
        r = requests.post(f"{API}/account/request-deletion", headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        assert "status" in r.json()

    def test_confirm_deletion_wrong_code_returns_400(self):
        data, email = _register("user")
        headers = {"Authorization": f"Bearer {data['token']}"}
        # request first so a verification record exists (but code is unknown)
        requests.post(f"{API}/account/request-deletion", headers=headers, timeout=30)
        r = requests.post(f"{API}/account/confirm-deletion",
                          json={"code": "000000"}, headers=headers, timeout=30)
        assert r.status_code == 400
        assert "detail" in r.json()

    def test_confirm_deletion_without_request_returns_400(self):
        data, email = _register("user")
        headers = {"Authorization": f"Bearer {data['token']}"}
        # try to confirm without requesting first
        r = requests.post(f"{API}/account/confirm-deletion",
                          json={"code": "123456"}, headers=headers, timeout=30)
        assert r.status_code == 400

    def test_confirm_deletion_requires_auth(self):
        r = requests.post(f"{API}/account/confirm-deletion",
                          json={"code": "123456"}, timeout=30)
        assert r.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Company update — service_cities persistence (multi-country)
# ---------------------------------------------------------------------------
class TestServiceCities:
    def test_multi_country_cities_persist(self):
        data, email = _register("company")
        cid = data["user"]["company_id"]
        headers = {"Authorization": f"Bearer {data['token']}"}
        cities = ["Tbilisi", "Batumi", "Paris", "Berlin"]
        r = requests.put(f"{API}/company/{cid}",
                         json={"country": "France", "service_cities": cities},
                         headers=headers, timeout=30)
        assert r.status_code == 200
        assert r.json()["service_cities"] == cities
        # persistence
        r2 = requests.get(f"{API}/company/{cid}", timeout=30)
        assert r2.status_code == 200
        for c in cities:
            assert c in r2.json()["service_cities"]
