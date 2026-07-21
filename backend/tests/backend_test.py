"""
Backend regression tests for Company Profile Platform.
Covers: auth (register/login/me), company CRUD, logo/cover/media uploads,
media delete, password change, email/phone change request stage, public profile.
"""
import io
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://fastapi-company-db.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

# 1x1 PNG
PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000d49444154789c62000100000005000106b60c67000000004945"
    "4e44ae426082"
)


@pytest.fixture(scope="module")
def rand_email():
    return f"test_{uuid.uuid4().hex[:8]}@test.com"


@pytest.fixture(scope="module")
def creds(rand_email):
    return {"name": "TEST Company", "email": rand_email, "password": "test123", "role": "company"}


@pytest.fixture(scope="module")
def registered(creds):
    r = requests.post(f"{API}/auth/register", json=creds, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data
    assert data["user"]["email"] == creds["email"]
    assert data["user"]["company_id"]
    return data


@pytest.fixture(scope="module")
def token(registered):
    return registered["token"]


@pytest.fixture(scope="module")
def company_id(registered):
    return registered["user"]["company_id"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------- AUTH ----------------
class TestAuth:
    def test_register_duplicate(self, registered, creds):
        # registered fixture already created the user; a second call must fail
        r = requests.post(f"{API}/auth/register", json=creds, timeout=30)
        assert r.status_code == 400

    def test_login_success(self, creds):
        r = requests.post(f"{API}/auth/login", json={"email": creds["email"], "password": creds["password"]}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["token"]
        assert d["user"]["email"] == creds["email"]
        assert d["user"]["company_id"]

    def test_login_bad_password(self, creds):
        r = requests.post(f"{API}/auth/login", json={"email": creds["email"], "password": "wrong"}, timeout=30)
        assert r.status_code == 401

    def test_me_requires_auth(self):
        r = requests.get(f"{API}/auth/me", timeout=30)
        assert r.status_code in (401, 403)

    def test_me_with_token(self, auth_headers, creds):
        r = requests.get(f"{API}/auth/me", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == creds["email"]
        assert d["company_id"]


# ---------------- COMPANY CRUD ----------------
class TestCompany:
    def test_get_my_company(self, auth_headers):
        r = requests.get(f"{API}/company/me", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "id" in d
        assert "media" in d

    def test_update_company(self, auth_headers, company_id):
        payload = {
            "name": "TEST Updated Co",
            "phone": "+995555000000",
            "address": "TEST Address 1",
            "country": "Georgia",
            "service_cities": ["Tbilisi", "Batumi"],
            "description": "TEST description",
        }
        r = requests.put(f"{API}/company/{company_id}", json=payload, headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == payload["name"]
        assert d["phone"] == payload["phone"]
        assert d["service_cities"] == payload["service_cities"]
        assert d["description"] == payload["description"]

    def test_update_persistence(self, auth_headers, company_id):
        r = requests.get(f"{API}/company/me", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["name"] == "TEST Updated Co"
        assert "Tbilisi" in d["service_cities"]

    def test_public_profile_no_auth(self, company_id):
        r = requests.get(f"{API}/company/{company_id}", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["id"] == company_id
        assert "owner_id" not in d  # sanitized
        assert "_id" not in d

    def test_update_unauthorized(self, company_id):
        r = requests.put(f"{API}/company/{company_id}", json={"name": "hacked"}, timeout=30)
        assert r.status_code in (401, 403)


# ---------------- MEDIA / FILES ----------------
class TestMedia:
    def test_upload_logo(self, auth_headers, company_id):
        files = {"file": ("test.png", io.BytesIO(PNG_BYTES), "image/png")}
        r = requests.post(f"{API}/company/{company_id}/logo", files=files, headers=auth_headers, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["url"].startswith("/api/files/")
        # fetch back
        fr = requests.get(f"{BASE_URL}{d['url']}", timeout=30)
        assert fr.status_code == 200
        assert fr.headers.get("content-type", "").startswith("image/")

    def test_upload_cover(self, auth_headers, company_id):
        files = {"file": ("cover.png", io.BytesIO(PNG_BYTES), "image/png")}
        r = requests.post(f"{API}/company/{company_id}/cover", files=files, headers=auth_headers, timeout=60)
        assert r.status_code == 200, r.text
        assert r.json()["url"].startswith("/api/files/")

    def test_upload_media_image(self, auth_headers, company_id):
        files = {"file": ("m.png", io.BytesIO(PNG_BYTES), "image/png")}
        r = requests.post(f"{API}/company/{company_id}/media", files=files, headers=auth_headers, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["type"] == "image"
        assert d["url"].startswith("/api/files/")
        assert "id" in d
        pytest.media_id = d["id"]

    def test_upload_media_disallowed_ext(self, auth_headers, company_id):
        files = {"file": ("bad.exe", io.BytesIO(b"MZ"), "application/octet-stream")}
        r = requests.post(f"{API}/company/{company_id}/media", files=files, headers=auth_headers, timeout=30)
        assert r.status_code == 400

    def test_media_appears_in_company(self, auth_headers, company_id):
        r = requests.get(f"{API}/company/me", headers=auth_headers, timeout=30)
        d = r.json()
        assert any(m["id"] == pytest.media_id for m in d.get("media", []))

    def test_delete_media(self, auth_headers, company_id):
        mid = pytest.media_id
        r = requests.delete(f"{API}/company/{company_id}/media/{mid}", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        # verify removal
        r2 = requests.get(f"{API}/company/me", headers=auth_headers, timeout=30)
        assert all(m["id"] != mid for m in r2.json().get("media", []))


# ---------------- ACCOUNT SECURITY ----------------
class TestAccountSecurity:
    def test_change_password_wrong_current(self, auth_headers):
        r = requests.post(f"{API}/account/change-password",
                          json={"current_password": "WRONG", "new_password": "newpass1"},
                          headers=auth_headers, timeout=30)
        assert r.status_code == 400

    def test_change_password_success(self, creds, auth_headers):
        # change to new
        r = requests.post(f"{API}/account/change-password",
                          json={"current_password": creds["password"], "new_password": "newtestpass"},
                          headers=auth_headers, timeout=30)
        assert r.status_code == 200
        # login with new password
        lr = requests.post(f"{API}/auth/login",
                           json={"email": creds["email"], "password": "newtestpass"}, timeout=30)
        assert lr.status_code == 200
        # revert
        rr = requests.post(f"{API}/account/change-password",
                           json={"current_password": "newtestpass", "new_password": creds["password"]},
                           headers=auth_headers, timeout=30)
        assert rr.status_code == 200

    def test_request_email_change(self, auth_headers):
        new_email = f"newmail_{uuid.uuid4().hex[:6]}@test.com"
        r = requests.post(f"{API}/account/request-email-change",
                          json={"new_value": new_email}, headers=auth_headers, timeout=30)
        # Email may fail but backend still creates verification and returns 200
        assert r.status_code == 200, r.text

    def test_request_phone_change(self, auth_headers):
        r = requests.post(f"{API}/account/request-phone-change",
                          json={"new_value": "+995555111222"}, headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text

    def test_confirm_change_bad_code(self, auth_headers):
        r = requests.post(f"{API}/account/confirm-change",
                          json={"code": "000000"}, headers=auth_headers, timeout=30)
        # code should not match
        assert r.status_code == 400
