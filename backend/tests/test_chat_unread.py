"""
Backend tests for NEW unread-message indicator feature.
Covers:
  - POST /api/chat/{company_id}/messages sets read_by_company=false
  - GET /api/chat/inbox/unread-count returns count for company owner
  - GET /api/chat/inbox unread integer per conversation; sum equals unread-count
  - GET /api/chat/inbox/{visitor_id}/messages marks that visitor's messages read
  - POST /api/chat/{company_id}/read marks company->visitor messages read_by_visitor=true
  - Chat text validation: empty & >2000 chars => 422
  - Company reply creates message with read_by_visitor=false so visitor unread count grows.

NOTE: Kept in a SINGLE class (TestUnreadFlow) because tests share state (messages)
and depend on execution order. pytest runs class methods in definition order;
xdist loadscope pins the whole class to one worker.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://fastapi-company-db.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


def _register(name_prefix):
    email = f"test_{name_prefix}_{uuid.uuid4().hex[:8]}@test.com"
    r = requests.post(f"{API}/auth/register",
                      json={"name": f"TEST {name_prefix}", "email": email, "password": "test123"}, timeout=30)
    assert r.status_code == 200, r.text
    reg = r.json()
    return {"email": email, "token": reg["token"],
            "headers": {"Authorization": f"Bearer {reg['token']}"},
            "user_id": reg["user"]["id"],
            "company_id": reg["user"].get("company_id")}


@pytest.fixture(scope="module")
def owner():
    o = _register("owner_ur")
    u = requests.put(f"{API}/company/{o['company_id']}",
                     json={"country": "Georgia", "service_cities": ["Tbilisi"],
                           "description": "TEST unread co"}, headers=o["headers"], timeout=30)
    assert u.status_code == 200, u.text
    return o


@pytest.fixture(scope="module")
def visitor_a():
    return _register("visitor_a_ur")


@pytest.fixture(scope="module")
def visitor_b():
    return _register("visitor_b_ur")


class TestUnreadFlow:
    """Sequential unread/read-state flow. Methods run in definition order."""

    def test_01_baseline_unread_zero(self, owner):
        r = requests.get(f"{API}/chat/inbox/unread-count",
                         headers=owner["headers"], timeout=30)
        assert r.status_code == 200
        assert r.json()["count"] == 0

    def test_02_visitor_a_sends_two_msgs_increments_unread(self, owner, visitor_a):
        for text in ["A-hi 1", "A-hi 2"]:
            r = requests.post(f"{API}/chat/{owner['company_id']}/messages",
                              json={"text": text},
                              headers=visitor_a["headers"], timeout=30)
            assert r.status_code == 200, r.text
            assert r.json()["sender"] == "visitor"

        r = requests.get(f"{API}/chat/inbox/unread-count",
                         headers=owner["headers"], timeout=30)
        assert r.json()["count"] == 2

    def test_03_visitor_b_sends_one_msg(self, owner, visitor_b):
        r = requests.post(f"{API}/chat/{owner['company_id']}/messages",
                          json={"text": "B-hi"},
                          headers=visitor_b["headers"], timeout=30)
        assert r.status_code == 200

        rc = requests.get(f"{API}/chat/inbox/unread-count",
                          headers=owner["headers"], timeout=30)
        assert rc.json()["count"] == 3

    def test_04_inbox_sum_equals_unread_count(self, owner, visitor_a, visitor_b):
        rinbox = requests.get(f"{API}/chat/inbox",
                              headers=owner["headers"], timeout=30)
        assert rinbox.status_code == 200
        convos = rinbox.json()
        assert isinstance(convos, list)
        assert len(convos) >= 2

        total = sum(c.get("unread", 0) for c in convos)
        rc = requests.get(f"{API}/chat/inbox/unread-count",
                          headers=owner["headers"], timeout=30)
        assert rc.json()["count"] == total

        by_vid = {c["visitor_id"]: c for c in convos}
        assert by_vid[visitor_a["user_id"]]["unread"] == 2
        assert by_vid[visitor_b["user_id"]]["unread"] == 1

    def test_05_open_a_conversation_marks_read(self, owner, visitor_a, visitor_b):
        rconv = requests.get(f"{API}/chat/inbox/{visitor_a['user_id']}/messages",
                             headers=owner["headers"], timeout=30)
        assert rconv.status_code == 200
        msgs = rconv.json()
        # All visitor messages must be read_by_company=True after opening
        for m in msgs:
            if m["sender"] == "visitor":
                assert m.get("read_by_company") is True, m

        # A's convo unread drops to 0; B still 1
        rinbox = requests.get(f"{API}/chat/inbox",
                              headers=owner["headers"], timeout=30)
        by_vid = {c["visitor_id"]: c for c in rinbox.json()}
        assert by_vid[visitor_a["user_id"]]["unread"] == 0
        assert by_vid[visitor_b["user_id"]]["unread"] == 1

        # Global count now 1
        rc = requests.get(f"{API}/chat/inbox/unread-count",
                          headers=owner["headers"], timeout=30)
        assert rc.json()["count"] == 1

    def test_06_company_reply_is_unread_for_visitor(self, owner, visitor_a):
        r = requests.post(f"{API}/chat/inbox/{visitor_a['user_id']}/messages",
                          json={"text": "TEST reply UR"},
                          headers=owner["headers"], timeout=30)
        assert r.status_code == 200, r.text
        reply = r.json()
        assert reply["sender"] == "company"
        assert reply.get("read_by_visitor") is False

        # Visitor sees at least one unread company message
        rv = requests.get(f"{API}/chat/{owner['company_id']}/messages",
                          headers=visitor_a["headers"], timeout=30)
        assert rv.status_code == 200
        company_msgs = [m for m in rv.json() if m["sender"] == "company"]
        assert len(company_msgs) >= 1
        assert any(m.get("read_by_visitor") is False for m in company_msgs)

    def test_07_visitor_post_read_marks_company_msgs_read(self, owner, visitor_a):
        r = requests.post(f"{API}/chat/{owner['company_id']}/read",
                          headers=visitor_a["headers"], timeout=30)
        assert r.status_code == 200

        rv = requests.get(f"{API}/chat/{owner['company_id']}/messages",
                          headers=visitor_a["headers"], timeout=30)
        assert rv.status_code == 200
        for m in rv.json():
            if m["sender"] == "company":
                assert m.get("read_by_visitor") is True

    def test_08_owner_unread_count_unaffected_by_visitor_mark_read(self, owner, visitor_b):
        # Visitor marking company msgs read must NOT change owner's unread count
        # (which tracks visitor->company). B still has 1 unread pending.
        rc = requests.get(f"{API}/chat/inbox/unread-count",
                          headers=owner["headers"], timeout=30)
        assert rc.json()["count"] == 1

    # -------- text validation --------
    def test_09_empty_text_rejected(self, owner, visitor_b):
        r = requests.post(f"{API}/chat/{owner['company_id']}/messages",
                          json={"text": ""}, headers=visitor_b["headers"], timeout=30)
        assert r.status_code == 422, r.text

    def test_10_over_2000_chars_rejected(self, owner, visitor_b):
        big = "x" * 2001
        r = requests.post(f"{API}/chat/{owner['company_id']}/messages",
                          json={"text": big}, headers=visitor_b["headers"], timeout=30)
        assert r.status_code == 422, r.text

    def test_11_exactly_2000_chars_accepted(self, owner, visitor_b):
        exact = "y" * 2000
        r = requests.post(f"{API}/chat/{owner['company_id']}/messages",
                          json={"text": exact}, headers=visitor_b["headers"], timeout=30)
        assert r.status_code == 200, r.text

    def test_12_company_reply_empty_rejected(self, owner, visitor_a):
        r = requests.post(f"{API}/chat/inbox/{visitor_a['user_id']}/messages",
                          json={"text": ""}, headers=owner["headers"], timeout=30)
        assert r.status_code == 422, r.text
