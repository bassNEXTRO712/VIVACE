"""
Iteration 6 backend tests: admin powers (block/edit/verify/delete), support chat,
ads, typing, notifications, generic upload, photo comment with image, blocked user
enforcement, verified badge propagation.
"""
import io
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL",
    "https://fastapi-company-db.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000d49444154789c62000100000005000106b60c67000000004945"
    "4e44ae426082"
)

ADMIN_EMAIL = "nikaabrumia1985@gmail.com"
ADMIN_PASSWORD = "NEXTRO2006NEXTRO"
USER_EMAIL = "user_verified@test.com"
USER_PASSWORD = "test123"
COMP_EMAIL = "comp_verified@test.com"
COMP_PASSWORD = "test123"


# ---------- fixtures ----------
def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def user():
    return _login(USER_EMAIL, USER_PASSWORD)


@pytest.fixture(scope="module")
def company():
    return _login(COMP_EMAIL, COMP_PASSWORD)


@pytest.fixture(scope="module")
def admin_headers(admin):
    return {"Authorization": f"Bearer {admin['token']}"}


@pytest.fixture(scope="module")
def user_headers(user):
    return {"Authorization": f"Bearer {user['token']}"}


@pytest.fixture(scope="module")
def company_headers(company):
    return {"Authorization": f"Bearer {company['token']}"}


def _register_throwaway(role="user"):
    email = f"it6_{uuid.uuid4().hex[:8]}@test.com"
    r = requests.post(f"{API}/auth/register",
                      json={"name": "IT6 Throw", "email": email, "password": "test123", "role": role},
                      timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    return {"email": email, "token": d["token"], "id": d["user"]["id"],
            "company_id": d["user"].get("company_id")}


# ---------- Admin endpoints (auth gate) ----------
class TestAdminAuthGate:
    def test_stats_requires_admin(self, user_headers):
        assert requests.get(f"{API}/admin/stats", headers=user_headers, timeout=30).status_code == 403

    def test_users_requires_admin(self, user_headers):
        assert requests.get(f"{API}/admin/users", headers=user_headers, timeout=30).status_code == 403

    def test_companies_requires_admin(self, user_headers):
        assert requests.get(f"{API}/admin/companies", headers=user_headers, timeout=30).status_code == 403

    def test_ads_admin_requires_admin(self, user_headers):
        assert requests.get(f"{API}/admin/ads", headers=user_headers, timeout=30).status_code == 403

    def test_support_inbox_requires_admin(self, user_headers):
        assert requests.get(f"{API}/support/inbox", headers=user_headers, timeout=30).status_code == 403

    def test_admin_ok(self, admin_headers):
        s = requests.get(f"{API}/admin/stats", headers=admin_headers, timeout=30)
        assert s.status_code == 200
        d = s.json()
        for k in ("users", "companies", "reviews", "messages", "total_accounts"):
            assert k in d


# ---------- Block / Unblock ----------
class TestAdminBlock:
    def test_block_then_unblock_user(self, admin_headers):
        t = _register_throwaway("user")
        r = requests.post(f"{API}/admin/users/{t['id']}/block",
                          json={"blocked": True}, headers=admin_headers, timeout=30)
        assert r.status_code == 200
        # blocked user cannot support-send
        h = {"Authorization": f"Bearer {t['token']}"}
        s = requests.post(f"{API}/support/messages", json={"text": "hi"}, headers=h, timeout=30)
        assert s.status_code == 403
        # unblock
        r = requests.post(f"{API}/admin/users/{t['id']}/block",
                          json={"blocked": False}, headers=admin_headers, timeout=30)
        assert r.status_code == 200
        s2 = requests.post(f"{API}/support/messages", json={"text": "hi2"}, headers=h, timeout=30)
        assert s2.status_code == 200

    def test_cannot_block_admin(self, admin_headers, admin):
        r = requests.post(f"{API}/admin/users/{admin['user']['id']}/block",
                          json={"blocked": True}, headers=admin_headers, timeout=30)
        assert r.status_code == 400


# ---------- Admin edit user (name + password) ----------
class TestAdminEditUser:
    def test_edit_name_and_password(self, admin_headers):
        t = _register_throwaway("user")
        # update name and password
        r = requests.put(f"{API}/admin/users/{t['id']}",
                         json={"name": "IT6 Renamed", "password": "newpw123"},
                         headers=admin_headers, timeout=30)
        assert r.status_code == 200
        # verify via admin/users
        users = requests.get(f"{API}/admin/users", headers=admin_headers, timeout=30).json()
        row = next((u for u in users if u["id"] == t["id"]), None)
        assert row is not None and row["name"] == "IT6 Renamed"
        # login with new password
        lr = requests.post(f"{API}/auth/login",
                           json={"email": t["email"], "password": "newpw123"}, timeout=30)
        assert lr.status_code == 200

    def test_edit_password_too_short_400(self, admin_headers):
        t = _register_throwaway("user")
        r = requests.put(f"{API}/admin/users/{t['id']}",
                         json={"password": "abc"}, headers=admin_headers, timeout=30)
        assert r.status_code == 400


# ---------- Verify company ----------
class TestVerifyCompany:
    def test_verify_toggle_reflects_in_public_and_cards(self, admin_headers):
        t = _register_throwaway("company")
        cid = t["company_id"]
        # set a country so it appears in country listing
        h = {"Authorization": f"Bearer {t['token']}"}
        requests.put(f"{API}/company/{cid}",
                     json={"country": "TestCountry_it6"}, headers=h, timeout=30)
        # verify
        r = requests.post(f"{API}/admin/companies/{cid}/verify",
                          json={"verified": True}, headers=admin_headers, timeout=30)
        assert r.status_code == 200
        pub = requests.get(f"{API}/company/{cid}", timeout=30).json()
        assert pub.get("verified") is True
        cards = requests.get(f"{API}/companies?country=TestCountry_it6", timeout=30).json()
        card = next(c for c in cards if c["id"] == cid)
        assert card["verified"] is True
        # cleanup
        requests.delete(f"{API}/admin/companies/{cid}", headers=admin_headers, timeout=30)


# ---------- Support chat ----------
class TestSupportChat:
    def test_user_send_then_admin_reply_thread(self, admin_headers):
        t = _register_throwaway("user")
        h = {"Authorization": f"Bearer {t['token']}"}
        msg_txt = f"help me {uuid.uuid4().hex[:6]}"
        s = requests.post(f"{API}/support/messages", json={"text": msg_txt}, headers=h, timeout=30)
        assert s.status_code == 200
        assert s.json()["sender"] == "user"
        # admin inbox contains this user
        inbox = requests.get(f"{API}/support/inbox", headers=admin_headers, timeout=30).json()
        row = next((c for c in inbox if c["user_id"] == t["id"]), None)
        assert row is not None
        assert row["unread"] >= 1
        assert row["last_text"] == msg_txt
        # admin reads convo -> unread cleared
        conv = requests.get(f"{API}/support/inbox/{t['id']}", headers=admin_headers, timeout=30).json()
        assert any(m["text"] == msg_txt for m in conv)
        # admin reply
        reply_txt = f"reply {uuid.uuid4().hex[:6]}"
        rep = requests.post(f"{API}/support/inbox/{t['id']}", json={"text": reply_txt},
                            headers=admin_headers, timeout=30)
        assert rep.status_code == 200
        # user sees reply
        thr = requests.get(f"{API}/support/messages", headers=h, timeout=30).json()
        assert any(m["text"] == reply_txt and m["sender"] == "admin" for m in thr)

    def test_non_admin_cannot_reply(self, user_headers):
        r = requests.post(f"{API}/support/inbox/anyid", json={"text": "x"},
                          headers=user_headers, timeout=30)
        assert r.status_code == 403


# ---------- Admin notification bell ----------
class TestAdminNotifications:
    def test_admin_notif_shows_support_and_new_regs(self, admin_headers):
        # Prime a new registration and a support msg
        t = _register_throwaway("user")
        h = {"Authorization": f"Bearer {t['token']}"}
        requests.post(f"{API}/support/messages", json={"text": "notify-me"}, headers=h, timeout=30)
        n = requests.get(f"{API}/notifications", headers=admin_headers, timeout=30).json()
        assert n["count"] >= 1
        # /admin/seen clears seen_by_admin flags for new registrations
        r = requests.post(f"{API}/admin/seen", headers=admin_headers, timeout=30)
        assert r.status_code == 200


# ---------- Ads ----------
class TestAds:
    def test_admin_create_list_delete_ad(self, admin_headers):
        payload = {"title": "TEST AD", "link": "https://example.com",
                   "media_url": "/api/files/x.png", "media_type": "image"}
        c = requests.post(f"{API}/admin/ads", json=payload, headers=admin_headers, timeout=30)
        assert c.status_code == 200
        ad = c.json()
        assert ad["id"] and ad["active"] is True
        # public /ads returns it
        pub = requests.get(f"{API}/ads", timeout=30).json()
        assert any(a["id"] == ad["id"] for a in pub)
        # admin listing
        all_ads = requests.get(f"{API}/admin/ads", headers=admin_headers, timeout=30).json()
        assert any(a["id"] == ad["id"] for a in all_ads)
        # delete
        d = requests.delete(f"{API}/admin/ads/{ad['id']}", headers=admin_headers, timeout=30)
        assert d.status_code == 200
        pub2 = requests.get(f"{API}/ads", timeout=30).json()
        assert not any(a["id"] == ad["id"] for a in pub2)

    def test_non_admin_cannot_create_ad(self, user_headers):
        r = requests.post(f"{API}/admin/ads",
                          json={"title": "x", "media_url": "/x", "media_type": "image"},
                          headers=user_headers, timeout=30)
        assert r.status_code == 403


# ---------- Typing indicator ----------
class TestTyping:
    def test_visitor_typing_visible_to_company(self, user_headers, company, company_headers):
        cid = company["user"]["company_id"]
        # user posts typing
        r = requests.post(f"{API}/chat/{cid}/typing", headers=user_headers, timeout=30)
        assert r.status_code == 200
        # need visitor_id -> user id
        me = requests.get(f"{API}/auth/me", headers=user_headers, timeout=30).json()
        vid = me["id"]
        # company polls typing status for that visitor
        r2 = requests.get(f"{API}/chat/inbox/{vid}/typing", headers=company_headers, timeout=30)
        assert r2.status_code == 200
        assert r2.json()["typing"] is True

    def test_company_typing_visible_to_visitor(self, user_headers, company, company_headers):
        cid = company["user"]["company_id"]
        me = requests.get(f"{API}/auth/me", headers=user_headers, timeout=30).json()
        vid = me["id"]
        # company sets typing
        r = requests.post(f"{API}/chat/inbox/{vid}/typing", headers=company_headers, timeout=30)
        assert r.status_code == 200
        r2 = requests.get(f"{API}/chat/{cid}/typing", headers=user_headers, timeout=30)
        assert r2.status_code == 200
        assert r2.json()["typing"] is True

    def test_typing_expires(self, user_headers, company, company_headers):
        cid = company["user"]["company_id"]
        me = requests.get(f"{API}/auth/me", headers=user_headers, timeout=30).json()
        vid = me["id"]
        # wait for typing to expire (>5s)
        time.sleep(6)
        r = requests.get(f"{API}/chat/inbox/{vid}/typing", headers=company_headers, timeout=30)
        assert r.json()["typing"] is False


# ---------- Generic upload + photo comment with image ----------
class TestGenericUploadAndPhotoComment:
    def test_upload_and_comment_with_image(self, user_headers, company_headers, company):
        # upload an image
        files = {"file": ("c.png", io.BytesIO(PNG_BYTES), "image/png")}
        u = requests.post(f"{API}/upload", files=files, headers=user_headers, timeout=60)
        assert u.status_code == 200
        url = u.json()["url"]
        assert url.startswith("/api/files/")
        # get a media item on the company (upload one to be sure)
        cid = company["user"]["company_id"]
        mf = {"file": ("m.png", io.BytesIO(PNG_BYTES), "image/png")}
        m = requests.post(f"{API}/company/{cid}/media", files=mf, headers=company_headers, timeout=60)
        assert m.status_code == 200
        media_id = m.json()["id"]
        # add a photo comment with image_url
        cr = requests.post(f"{API}/company/{cid}/media/{media_id}/comments",
                           json={"text": "nice pic", "image_url": url},
                           headers=user_headers, timeout=30)
        assert cr.status_code == 200
        got = cr.json()
        assert got["text"] == "nice pic"
        assert got["image_url"] == url
        assert got["avatar_url"] is not None  # field exists (may be empty)
        assert "user_name" in got
        # get list returns it
        lst = requests.get(f"{API}/company/{cid}/media/{media_id}/comments", timeout=30).json()
        assert any(c["id"] == got["id"] for c in lst)

    def test_empty_comment_rejected(self, user_headers, company):
        cid = company["user"]["company_id"]
        r = requests.post(f"{API}/company/{cid}/media/fake/comments",
                          json={"text": "", "image_url": ""},
                          headers=user_headers, timeout=30)
        assert r.status_code == 400

    def test_upload_requires_auth(self):
        files = {"file": ("c.png", io.BytesIO(PNG_BYTES), "image/png")}
        r = requests.post(f"{API}/upload", files=files, timeout=30)
        assert r.status_code in (401, 403)


# ---------- Review avatar ----------
class TestReviewAvatar:
    def test_review_carries_avatar_url(self, user_headers, company):
        cid = company["user"]["company_id"]
        r = requests.post(f"{API}/company/{cid}/reviews",
                          json={"rating": 4, "text": "IT6 avatar test"},
                          headers=user_headers, timeout=30)
        assert r.status_code == 200
        # GET reviews shows avatar_url field on the user's review
        me = requests.get(f"{API}/auth/me", headers=user_headers, timeout=30).json()
        rev = requests.get(f"{API}/company/{cid}/reviews", timeout=30).json()
        mine = next((x for x in rev["reviews"] if x["user_id"] == me["id"]), None)
        assert mine is not None
        assert "avatar_url" in mine  # field exists (may be empty for user_verified)
