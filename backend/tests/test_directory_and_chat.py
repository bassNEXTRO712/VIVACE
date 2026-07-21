"""
Backend tests for NEW public directory + chat features.
Covers:
  - GET /api/companies (with country/city/q filters, public)
  - GET /api/companies-countries (aggregation, public)
  - POST/GET /api/chat/{company_id}/messages (visitor side)
  - GET /api/chat/inbox, GET/POST /api/chat/inbox/{visitor_id}/messages (company owner side)
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


# ---------------------- fixtures ----------------------

@pytest.fixture(scope="module")
def owner():
    """Fresh company owner with country=Georgia."""
    email = f"test_owner_{uuid.uuid4().hex[:8]}@test.com"
    r = requests.post(f"{API}/auth/register",
                      json={"name": "TEST Owner Co", "email": email, "password": "test123"}, timeout=30)
    assert r.status_code == 200, r.text
    reg = r.json()
    headers = {"Authorization": f"Bearer {reg['token']}"}
    company_id = reg["user"]["company_id"]
    # Set country=Georgia and cities
    u = requests.put(f"{API}/company/{company_id}",
                     json={"country": "Georgia", "service_cities": ["Tbilisi", "Batumi"],
                           "description": "TEST tour co"}, headers=headers, timeout=30)
    assert u.status_code == 200, u.text
    return {"email": email, "token": reg["token"], "headers": headers,
            "company_id": company_id, "user_id": reg["user"]["id"]}


@pytest.fixture(scope="module")
def visitor():
    """Fresh visitor account (also a company account internally, but used as visitor)."""
    email = f"test_visitor_{uuid.uuid4().hex[:8]}@test.com"
    r = requests.post(f"{API}/auth/register",
                      json={"name": "TEST Visitor", "email": email, "password": "test123"}, timeout=30)
    assert r.status_code == 200, r.text
    reg = r.json()
    return {"email": email, "token": reg["token"],
            "headers": {"Authorization": f"Bearer {reg['token']}"},
            "user_id": reg["user"]["id"]}


# ---------------------- Public directory ----------------------
class TestPublicDirectory:
    def test_countries_public_no_auth(self, owner):
        r = requests.get(f"{API}/companies-countries", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        # After owner fixture ran, Georgia must be present with count >= 1
        by_country = {row["country"]: row["count"] for row in data}
        assert "Georgia" in by_country
        assert by_country["Georgia"] >= 1
        # Empty-country docs must be excluded
        assert "" not in by_country

    def test_companies_filter_by_country(self, owner):
        r = requests.get(f"{API}/companies", params={"country": "Georgia"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        # All returned companies must be Georgia
        for c in data:
            assert c["country"] == "Georgia"
        # Our owner must be in the list
        ids = [c["id"] for c in data]
        assert owner["company_id"] in ids

    def test_companies_filter_by_city(self, owner):
        r = requests.get(f"{API}/companies",
                         params={"country": "Georgia", "city": "Tbilisi"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 1
        assert any(c["id"] == owner["company_id"] for c in data)
        for c in data:
            assert "Tbilisi" in c["service_cities"]

    def test_companies_filter_by_city_nomatch(self):
        r = requests.get(f"{API}/companies",
                         params={"country": "Georgia", "city": "NoSuchCityXYZ"}, timeout=30)
        assert r.status_code == 200
        assert r.json() == []

    def test_companies_search_q(self, owner):
        r = requests.get(f"{API}/companies", params={"q": "TEST Owner"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert any(c["id"] == owner["company_id"] for c in data)

    def test_companies_card_fields(self, owner):
        r = requests.get(f"{API}/companies", params={"country": "Georgia"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 1
        card = next(c for c in data if c["id"] == owner["company_id"])
        # Contract fields
        for f in ("id", "name", "country", "service_cities", "address",
                  "description", "logo_url", "cover_url", "media_count"):
            assert f in card, f"missing {f}"
        # owner_id / _id must NOT leak
        assert "owner_id" not in card
        assert "_id" not in card
        assert isinstance(card["media_count"], int)


# ---------------------- Chat ----------------------
class TestChat:
    def test_visitor_send_message(self, owner, visitor):
        r = requests.post(f"{API}/chat/{owner['company_id']}/messages",
                          json={"text": "Hello TEST company"},
                          headers=visitor["headers"], timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["sender"] == "visitor"
        assert d["text"] == "Hello TEST company"
        assert d["visitor_id"] == visitor["user_id"]
        assert d["company_id"] == owner["company_id"]
        assert "id" in d and "created_at" in d
        assert "_id" not in d

    def test_visitor_send_requires_auth(self, owner):
        r = requests.post(f"{API}/chat/{owner['company_id']}/messages",
                          json={"text": "no auth"}, timeout=30)
        assert r.status_code in (401, 403)

    def test_visitor_send_bad_company(self, visitor):
        r = requests.post(f"{API}/chat/nonexistent-company-id/messages",
                          json={"text": "hi"}, headers=visitor["headers"], timeout=30)
        assert r.status_code == 404

    def test_visitor_get_own_conversation(self, owner, visitor):
        r = requests.get(f"{API}/chat/{owner['company_id']}/messages",
                         headers=visitor["headers"], timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        # Only this visitor's messages
        for m in data:
            assert m["visitor_id"] == visitor["user_id"]
            assert m["company_id"] == owner["company_id"]
            assert "_id" not in m

    def test_company_inbox_lists_visitor(self, owner, visitor):
        r = requests.get(f"{API}/chat/inbox", headers=owner["headers"], timeout=30)
        assert r.status_code == 200
        convos = r.json()
        assert isinstance(convos, list)
        ids = [c["visitor_id"] for c in convos]
        assert visitor["user_id"] in ids
        convo = next(c for c in convos if c["visitor_id"] == visitor["user_id"])
        for f in ("visitor_id", "visitor_name", "last_text", "last_at"):
            assert f in convo

    def test_company_get_conversation(self, owner, visitor):
        r = requests.get(f"{API}/chat/inbox/{visitor['user_id']}/messages",
                         headers=owner["headers"], timeout=30)
        assert r.status_code == 200
        msgs = r.json()
        assert len(msgs) >= 1
        for m in msgs:
            assert m["visitor_id"] == visitor["user_id"]
            assert m["company_id"] == owner["company_id"]

    def test_company_reply(self, owner, visitor):
        r = requests.post(f"{API}/chat/inbox/{visitor['user_id']}/messages",
                          json={"text": "TEST reply from company"},
                          headers=owner["headers"], timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["sender"] == "company"
        assert d["text"] == "TEST reply from company"
        assert d["visitor_id"] == visitor["user_id"]
        assert d["company_id"] == owner["company_id"]
        assert "_id" not in d

    def test_visitor_sees_company_reply(self, owner, visitor):
        r = requests.get(f"{API}/chat/{owner['company_id']}/messages",
                         headers=visitor["headers"], timeout=30)
        assert r.status_code == 200
        msgs = r.json()
        senders = [m["sender"] for m in msgs]
        assert "visitor" in senders
        assert "company" in senders
        # Ordered by created_at ascending
        times = [m["created_at"] for m in msgs]
        assert times == sorted(times)

    def test_chat_inbox_requires_auth(self):
        r = requests.get(f"{API}/chat/inbox", timeout=30)
        assert r.status_code in (401, 403)

    def test_visitor_isolation(self, owner, visitor):
        """A different visitor should NOT see the first visitor's messages."""
        email = f"test_visitor2_{uuid.uuid4().hex[:8]}@test.com"
        r = requests.post(f"{API}/auth/register",
                          json={"name": "TEST Visitor 2", "email": email, "password": "test123"}, timeout=30)
        assert r.status_code == 200
        v2 = r.json()
        h2 = {"Authorization": f"Bearer {v2['token']}"}
        # v2 hasn't sent anything yet -> should be empty for this company
        r = requests.get(f"{API}/chat/{owner['company_id']}/messages", headers=h2, timeout=30)
        assert r.status_code == 200
        assert r.json() == []
