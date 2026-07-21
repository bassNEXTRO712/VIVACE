"""
Iteration 5 backend tests:
- /api/stats (companies/users/countries counts)
- Email verification gate (register -> email_verified=false; wrong code 400; resend 200)
- Reviews (add/update by non-owner; owner-self 400; get)
- Company GET increments views + returns rating_avg/review_count
- Photo comments (POST/GET)
- Avatar upload (multipart)
- Notifications (visitor unread from company replies count)
- Admin: non-admin 403; admin stats/users/companies work;
         admin delete throwaway user works; delete admin -> 400
"""
import io
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL",
                          "https://fastapi-company-db.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "nikaabrumia1985@gmail.com"
ADMIN_PASSWORD = "NEXTRO2006NEXTRO"
COMP_VERIFIED = ("comp_verified@test.com", "test123")
USER_VERIFIED = ("user_verified@test.com", "test123")

# 1x1 PNG
PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000d49444154789c62000100000005000106b60c67000000004945"
    "4e44ae426082"
)


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def _register(role="user"):
    email = f"test_it5_{uuid.uuid4().hex[:8]}@test.com"
    payload = {"name": f"TEST it5 {role}", "email": email, "password": "test123", "role": role}
    r = requests.post(f"{API}/auth/register", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    return r.json(), email


# ---------------- STATS ----------------
class TestStats:
    def test_stats_shape(self):
        r = requests.get(f"{API}/stats", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert set(d.keys()) == {"companies", "users", "countries"}
        assert all(isinstance(d[k], int) for k in d)

    def test_stats_users_bump_on_register(self):
        before = requests.get(f"{API}/stats", timeout=30).json()
        _register("user")
        after = requests.get(f"{API}/stats", timeout=30).json()
        assert after["users"] >= before["users"] + 1


# ---------------- EMAIL VERIFICATION ----------------
class TestEmailVerify:
    def test_register_returns_unverified(self):
        data, _ = _register("user")
        assert data["user"]["email_verified"] is False

    def test_verify_wrong_code_400(self):
        data, _ = _register("user")
        r = requests.post(f"{API}/auth/verify-email",
                          json={"code": "000000"}, headers=_headers(data["token"]), timeout=30)
        assert r.status_code == 400

    def test_verify_requires_auth(self):
        r = requests.post(f"{API}/auth/verify-email", json={"code": "000000"}, timeout=30)
        assert r.status_code in (401, 403)

    def test_resend_verification_success(self):
        data, _ = _register("user")
        r = requests.post(f"{API}/auth/resend-verification",
                          headers=_headers(data["token"]), timeout=30)
        assert r.status_code == 200
        assert "status" in r.json()


# ---------------- REVIEWS ----------------
class TestReviews:
    def test_owner_cannot_review_own_company(self):
        comp = _login(*COMP_VERIFIED)
        cid = comp["user"]["company_id"]
        r = requests.post(f"{API}/company/{cid}/reviews",
                          json={"rating": 5, "text": "self"}, headers=_headers(comp["token"]), timeout=30)
        assert r.status_code == 400

    def test_review_requires_auth(self):
        comp = _login(*COMP_VERIFIED)
        cid = comp["user"]["company_id"]
        r = requests.post(f"{API}/company/{cid}/reviews",
                          json={"rating": 5, "text": "no auth"}, timeout=30)
        assert r.status_code in (401, 403)

    def test_add_and_update_review_by_non_owner(self):
        comp = _login(*COMP_VERIFIED)
        cid = comp["user"]["company_id"]
        u = _login(*USER_VERIFIED)
        # add
        r = requests.post(f"{API}/company/{cid}/reviews",
                          json={"rating": 4, "text": "nice"},
                          headers=_headers(u["token"]), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "reviews" in d and "rating_avg" in d and "review_count" in d
        assert d["review_count"] >= 1
        # update (same user re-posts)
        r2 = requests.post(f"{API}/company/{cid}/reviews",
                           json={"rating": 5, "text": "even nicer"},
                           headers=_headers(u["token"]), timeout=30)
        assert r2.status_code == 200
        d2 = r2.json()
        # Non-decreasing count (upsert semantics)
        assert d2["review_count"] == d["review_count"]
        my = [x for x in d2["reviews"] if x.get("user_id") == u["user"]["id"]]
        assert my and my[0]["rating"] == 5

    def test_get_reviews_returns_stats(self):
        comp = _login(*COMP_VERIFIED)
        cid = comp["user"]["company_id"]
        r = requests.get(f"{API}/company/{cid}/reviews", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert set(["reviews", "rating_avg", "review_count"]).issubset(d.keys())

    def test_company_get_returns_rating_and_bumps_views(self):
        comp = _login(*COMP_VERIFIED)
        cid = comp["user"]["company_id"]
        r1 = requests.get(f"{API}/company/{cid}", timeout=30)
        assert r1.status_code == 200
        d1 = r1.json()
        assert "rating_avg" in d1 and "review_count" in d1 and "views" in d1
        v1 = d1["views"]
        r2 = requests.get(f"{API}/company/{cid}", timeout=30)
        assert r2.json()["views"] >= v1 + 1


# ---------------- PHOTO COMMENTS ----------------
class TestPhotoComments:
    def test_add_and_get_photo_comment(self):
        comp = _login(*COMP_VERIFIED)
        cid = comp["user"]["company_id"]
        # upload a media item as company
        files = {"file": ("m.png", io.BytesIO(PNG_BYTES), "image/png")}
        r = requests.post(f"{API}/company/{cid}/media", files=files,
                          headers=_headers(comp["token"]), timeout=60)
        assert r.status_code == 200, r.text
        media_id = r.json()["id"]

        # user posts a comment
        u = _login(*USER_VERIFIED)
        text = f"TEST photo comment {uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/company/{cid}/media/{media_id}/comments",
                          json={"text": text}, headers=_headers(u["token"]), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["text"] == text
        # GET returns list containing our comment
        r = requests.get(f"{API}/company/{cid}/media/{media_id}/comments", timeout=30)
        assert r.status_code == 200
        assert any(c["text"] == text for c in r.json())

    def test_comment_requires_auth(self):
        r = requests.post(f"{API}/company/xxx/media/yyy/comments",
                          json={"text": "hi"}, timeout=30)
        assert r.status_code in (401, 403)


# ---------------- AVATAR ----------------
class TestAvatar:
    def test_avatar_upload_sets_user_url(self):
        u = _login(*USER_VERIFIED)
        files = {"file": ("a.png", io.BytesIO(PNG_BYTES), "image/png")}
        r = requests.post(f"{API}/account/avatar", files=files,
                          headers=_headers(u["token"]), timeout=60)
        assert r.status_code == 200, r.text
        url = r.json()["url"]
        assert url.startswith("/api/files/")
        # /auth/me reflects it
        me = requests.get(f"{API}/auth/me", headers=_headers(u["token"]), timeout=30).json()
        assert me["avatar_url"] == url

    def test_avatar_rejects_bad_ext(self):
        u = _login(*USER_VERIFIED)
        files = {"file": ("bad.exe", io.BytesIO(b"MZ"), "application/octet-stream")}
        r = requests.post(f"{API}/account/avatar", files=files,
                          headers=_headers(u["token"]), timeout=30)
        assert r.status_code == 400


# ---------------- NOTIFICATIONS ----------------
class TestNotifications:
    def test_notifications_requires_auth(self):
        r = requests.get(f"{API}/notifications", timeout=30)
        assert r.status_code in (401, 403)

    def test_visitor_gets_notification_on_company_reply(self):
        comp = _login(*COMP_VERIFIED)
        cid = comp["user"]["company_id"]
        # a throwaway user sends a message and receives a reply
        vis, _ = _register("user")
        text_v = f"TEST visitor msg {uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/chat/{cid}/messages",
                          json={"text": text_v}, headers=_headers(vis["token"]), timeout=30)
        assert r.status_code == 200
        # company reply
        text_c = f"TEST company reply {uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/chat/inbox/{vis['user']['id']}/messages",
                          json={"text": text_c}, headers=_headers(comp["token"]), timeout=30)
        assert r.status_code == 200
        # visitor now should have unread notification
        r = requests.get(f"{API}/notifications", headers=_headers(vis["token"]), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "count" in d and "items" in d
        assert d["count"] >= 1
        assert any(i.get("subtitle") == text_c for i in d["items"])

    def test_company_notifications_count_unread_visitor_msgs(self):
        comp = _login(*COMP_VERIFIED)
        cid = comp["user"]["company_id"]
        vis, _ = _register("user")
        text_v = f"TEST visitor msg2 {uuid.uuid4().hex[:6]}"
        requests.post(f"{API}/chat/{cid}/messages",
                      json={"text": text_v}, headers=_headers(vis["token"]), timeout=30)
        r = requests.get(f"{API}/notifications", headers=_headers(comp["token"]), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["count"] >= 1


# ---------------- ADMIN ----------------
class TestAdmin:
    def test_non_admin_forbidden(self):
        u = _login(*USER_VERIFIED)
        for path in ("/admin/stats", "/admin/users", "/admin/companies"):
            r = requests.get(f"{API}{path}", headers=_headers(u["token"]), timeout=30)
            assert r.status_code == 403, f"{path} -> {r.status_code}"

    def test_admin_stats(self):
        admin = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        assert admin["user"]["role"] == "admin"
        r = requests.get(f"{API}/admin/stats", headers=_headers(admin["token"]), timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("users", "companies", "reviews", "messages", "total_accounts"):
            assert k in d and isinstance(d[k], int)

    def test_admin_lists(self):
        admin = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        r = requests.get(f"{API}/admin/users", headers=_headers(admin["token"]), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        r = requests.get(f"{API}/admin/companies", headers=_headers(admin["token"]), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_cannot_delete_admin(self):
        admin = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        r = requests.delete(f"{API}/admin/users/{admin['user']['id']}",
                            headers=_headers(admin["token"]), timeout=30)
        assert r.status_code == 400

    def test_admin_delete_throwaway_user(self):
        admin = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        target, _ = _register("user")
        tid = target["user"]["id"]
        r = requests.delete(f"{API}/admin/users/{tid}",
                            headers=_headers(admin["token"]), timeout=30)
        assert r.status_code == 200
        # login should fail now
        r2 = requests.post(f"{API}/auth/login",
                           json={"email": target["user"]["email"], "password": "test123"}, timeout=30)
        assert r2.status_code == 401

    def test_admin_delete_throwaway_company(self):
        admin = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        target, _ = _register("company")
        cid = target["user"]["company_id"]
        r = requests.delete(f"{API}/admin/companies/{cid}",
                            headers=_headers(admin["token"]), timeout=30)
        assert r.status_code == 200
        # company profile now 404
        r2 = requests.get(f"{API}/company/{cid}", timeout=30)
        assert r2.status_code == 404
