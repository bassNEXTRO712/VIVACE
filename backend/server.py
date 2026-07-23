from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import re
import uuid
import random
import logging
import asyncio
import jwt
import bcrypt
import httpx
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, UploadFile, File, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field, field_validator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

MONGO_URL     = os.environ['MONGO_URL']
DB_NAME       = os.environ['DB_NAME']
JWT_SECRET    = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"

EMERGENT_KEY      = os.environ.get("EMERGENT_LLM_KEY")
STORAGE_URL       = "https://integrations.emergentagent.com/objstore/api/v1/storage"
APP_NAME          = "company-profile"
EMAIL_BASE_URL    = "https://integrations.emergentagent.com"
EMAIL_KEY         = os.environ.get("EMERGENT_EMAIL_KEY")
EMAIL_FROM_NAME   = os.environ.get("EMAIL_FROM_NAME", "Company Profile")
TRUST_PROXY_HEADERS = os.environ.get("TRUST_PROXY_HEADERS", "0") == "1"

MIME_TYPES = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif",  "webp": "image/webp",
    "mp4": "video/mp4",  "webm": "video/webm", "mov": "video/quicktime",
}
IMAGE_EXTS     = {"jpg", "jpeg", "png", "gif", "webp"}
VIDEO_EXTS     = {"mp4", "webm", "mov"}
MAX_IMAGE_SIZE = 10  * 1024 * 1024
MAX_VIDEO_SIZE = 100 * 1024 * 1024
SAFE_PATH_RE   = re.compile(r"^[a-zA-Z0-9_\-./]+$")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

mongo_client: AsyncIOMotorClient = None  # type: ignore
db = None

storage_key: Optional[str] = None
_storage_lock = asyncio.Lock()


async def init_storage() -> str:
    global storage_key
    if storage_key:
        return storage_key
    async with _storage_lock:
        if storage_key:
            return storage_key
        async with httpx.AsyncClient(timeout=30) as c:
            resp = await c.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY})
            resp.raise_for_status()
        storage_key = resp.json()["storage_key"]
        return storage_key


async def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = await init_storage()
    last_err: Exception = RuntimeError("put_object: no attempts made")
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=120) as c:
                resp = await c.put(
                    f"{STORAGE_URL}/objects/{path}",
                    headers={"X-Storage-Key": key, "Content-Type": content_type},
                    content=data,
                )
                resp.raise_for_status()
            return resp.json()
        except Exception as e:
            last_err = e
            logger.warning(f"put_object attempt {attempt + 1} failed for {path}: {e}")
            await asyncio.sleep(0.5 * (attempt + 1))
    raise last_err


async def get_object(path: str) -> tuple[bytes, str]:
    key = await init_storage()
    async with httpx.AsyncClient(timeout=60) as c:
        resp = await c.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key})
        resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global mongo_client, db
    mongo_client = AsyncIOMotorClient(MONGO_URL)
    db = mongo_client[DB_NAME]
    logger.info("MongoDB connected")
    yield
    mongo_client.close()
    logger.info("MongoDB disconnected")


app = FastAPI(lifespan=lifespan)

origins = [
    "https://vivace-lime.vercel.app",
    "https://vivace-gh9w.onrender.com",
    "http://localhost:3000",
    "http://localhost:5173",
]

app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"]   = "nosniff"
        response.headers["X-Frame-Options"]           = "DENY"
        response.headers["Referrer-Policy"]           = "strict-origin-when-cross-origin"
        response.headers["X-XSS-Protection"]          = "1; mode=block"
        response.headers["Permissions-Policy"]        = "geolocation=(), microphone=(), camera=()"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


app.add_middleware(SecurityHeadersMiddleware)

api_router = APIRouter(prefix="/api")
security   = HTTPBearer(auto_error=False)


def client_ip(request: Request) -> str:
    if TRUST_PROXY_HEADERS:
        xff = request.headers.get("x-forwarded-for")
        if xff:
            return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


limiter = Limiter(key_func=client_ip, default_limits=[])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())

def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id, "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(request: Request, creds: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> dict:
    token = creds.credentials if creds else None
    if not token:
        raise HTTPException(status_code=401, detail="ავტორიზაცია საჭიროა")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=401, detail="მომხმარებელი ვერ მოიძებნა")
        if user.get("blocked") and user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="თქვენი ანგარიში დაბლოკილია")
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="სესიის ვადა ამოიწურა")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="არასწორი ტოკენი")

async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="მხოლოდ ადმინისთვის")
    return user

async def send_verification_email(recipient: str, code: str, purpose: str) -> bool:
    if not EMAIL_KEY:
        logger.error("EMERGENT_EMAIL_KEY არ არის კონფიგურირებული")
        return False
    html = f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a20;padding:40px 16px;font-family:'Segoe UI',Arial,sans-serif;">
      <tr><td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#16162a;border:1px solid #262645;border-radius:16px;overflow:hidden;">
          <tr><td style="background:#0f0f24;padding:24px 32px;border-bottom:1px solid #262645;">
            <span style="color:#fff;font-size:24px;font-weight:800;letter-spacing:1px;">VIVACE</span>
            <span style="color:#f97316;font-size:22px;">&#9992;</span>
          </td></tr>
          <tr><td style="padding:32px;">
            <div style="color:#fff;font-size:20px;font-weight:700;padding-bottom:8px;">დადასტურების კოდი</div>
            <div style="color:#cbd5e1;font-size:14px;line-height:1.6;padding-bottom:24px;">{purpose}</div>
            <div align="center" style="background:linear-gradient(135deg,#f97316,#ea580c);border-radius:10px;padding:18px;color:#fff;font-size:34px;font-weight:800;letter-spacing:10px;">{code}</div>
            <div style="color:#94a3b8;font-size:12px;padding-top:24px;line-height:1.6;">კოდი მოქმედია 10 წუთის განმავლობაში.</div>
          </td></tr>
          <tr><td style="background:#0f0f24;padding:20px 32px;border-top:1px solid #262645;text-align:center;">
            <div style="color:#94a3b8;font-size:13px;">გისურვებთ სასიამოვნო მოგზაურობას,</div>
            <div style="color:#f97316;font-size:14px;font-weight:700;padding-top:4px;">VIVACE Team</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
    """
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            resp = await c.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                                headers={"X-Email-Key": EMAIL_KEY},
                                json={"to": [recipient], "subject": "VIVACE — დადასტურების კოდი", "html": html, "from_name": EMAIL_FROM_NAME})
            resp.raise_for_status()
        return True
    except httpx.HTTPStatusError as e:
        logger.error(f"Email send failed {e.response.status_code}: {e}")
    except httpx.RequestError as e:
        logger.error(f"Email request error: {e}")
    return False

def gen_code() -> str:
    return f"{random.randint(0, 999999):06d}"

async def _purge_user_data(user_id: str, email: str, cids: list):
    if cids:
        await db.messages.delete_many({"company_id": {"$in": cids}})
        await db.reviews.delete_many({"company_id": {"$in": cids}})
        await db.photo_comments.delete_many({"company_id": {"$in": cids}})
        await db.support_messages.delete_many({"company_id": {"$in": cids}})
        await db.typing.delete_many({"company_id": {"$in": cids}})
        await db.company_views.delete_many({"company_id": {"$in": cids}})
    await db.messages.delete_many({"visitor_id": user_id})
    await db.reviews.delete_many({"user_id": user_id})
    await db.photo_comments.delete_many({"user_id": user_id})
    await db.support_messages.delete_many({"user_id": user_id})
    await db.verifications.delete_many({"user_id": user_id})
    if email:
        await db.password_resets.delete_many({"email": email})

class RegisterInput(BaseModel):
    name:     str      = Field(..., min_length=1, max_length=120)
    email:    EmailStr
    password: str      = Field(..., min_length=6, max_length=200)
    role:     str      = "user"
    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("სახელი სავალდებულოა")
        return v

class LoginInput(BaseModel):
    email:    EmailStr
    password: str = Field(..., min_length=1, max_length=200)

class ForgotPasswordInput(BaseModel):
    email: EmailStr

class ResetPasswordInput(BaseModel):
    email:        EmailStr
    code:         str = Field(..., min_length=4, max_length=10)
    new_password: str = Field(..., min_length=6, max_length=200)

class UserUpdate(BaseModel):
    name: Optional[str] = None

class UserAdminUpdate(BaseModel):
    blocked: Optional[bool] = None
    role:    Optional[str]  = None

class CompanyUpdate(BaseModel):
    name:           Optional[str]       = None
    phone:          Optional[str]       = None
    address:        Optional[str]       = None
    country:        Optional[str]       = None
    service_cities: Optional[List[str]] = None
    description:    Optional[str]       = None
    logo_url:       Optional[str]       = None
    cover_url:      Optional[str]       = None

class PasswordChange(BaseModel):
    current_password: str
    new_password:     str

class ContactChangeRequest(BaseModel):
    new_value: str

class CodeConfirm(BaseModel):
    code: str

def user_response(user: dict, company_id=None) -> dict:
    return {
        "id": user["id"], "email": user["email"], "name": user["name"],
        "phone": user.get("phone", ""), "role": user.get("role", "user"),
        "avatar_url": user.get("avatar_url", ""),
        "email_verified": user.get("email_verified", False),
        "blocked": user.get("blocked", False),
        "company_id": company_id,
    }

async def _send_email_code(user_id: str, email: str, field: str, purpose: str):
    code = gen_code()
    await db.verifications.delete_many({"user_id": user_id, "field": field})
    await db.verifications.insert_one({
        "user_id": user_id, "field": field, "new_value": email, "code": code,
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(),
    })
    await send_verification_email(email, code, purpose)

@api_router.post("/auth/register")
@limiter.limit("10/hour")
async def register(request: Request, data: RegisterInput):
    email = data.email.lower()
    role  = "company" if data.role == "company" else "user"
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="ეს მეილი უკვე რეგისტრირებულია")
    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    user_doc = {
        "id": user_id, "email": email, "name": data.name,
        "phone": "", "role": role, "avatar_url": "", "email_verified": False,
        "blocked": False, "seen_by_admin": False,
        "password_hash": hash_password(data.password), "created_at": now,
    }
    await db.users.insert_one(user_doc)
    await db.notifications.insert_one({"id": str(uuid.uuid4()), "user_id": "admin",
        "text": f"ახალი მომხმარებელი: {data.name} ({email})", "created_at": now})
    company_id = None
    if role == "company":
        company_id = str(uuid.uuid4())
        await db.companies.insert_one({
            "id": company_id, "owner_id": user_id, "name": data.name, "email": email,
            "phone": "", "address": "", "country": "", "service_cities": [],
            "description": "", "logo_url": "", "cover_url": "", "verified": False,
            "media": [], "views": 0, "created_at": now, "updated_at": now,
        })
    await _send_email_code(user_id, email, "email_verify", "დაადასტურეთ თქვენი მეილი")
    return {"token": create_access_token(user_id, email), "user": user_response(user_doc, company_id)}

@api_router.post("/auth/verify-email")
@limiter.limit("10/hour")
async def verify_email(request: Request, data: CodeConfirm, user: dict = Depends(get_current_user)):
    v = await db.verifications.find_one({"user_id": user["id"], "field": "email_verify", "code": data.code})
    if not v:
        raise HTTPException(status_code=400, detail="არასწორი კოდი")
    if datetime.fromisoformat(v["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="კოდის ვადა ამოიწურა")
    await db.users.update_one({"id": user["id"]}, {"$set": {"email_verified": True}})
    await db.verifications.delete_many({"user_id": user["id"], "field": "email_verify"})
    return {"status": "მეილი დადასტურდა"}

@api_router.post("/auth/resend-verification")
@limiter.limit("5/hour")
async def resend_verification(request: Request, user: dict = Depends(get_current_user)):
    await _send_email_code(user["id"], user["email"], "email_verify", "დაადასტურეთ თქვენი მეილი")
    return {"status": "კოდი ხელახლა გაიგზავნა"}

@api_router.post("/auth/login")
@limiter.limit("10/minute")
async def login(request: Request, data: LoginInput):
    email = data.email.lower()
    user  = await db.users.find_one({"email": email})
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="არასწორი მეილი ან პაროლი")
    if user.get("blocked") and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="თქვენი ანგარიში დაბლოკილია.")
    company = await db.companies.find_one({"owner_id": user["id"]}, {"_id": 0})
    return {"token": create_access_token(user["id"], email), "user": user_response(user, company["id"] if company else None)}

@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"owner_id": user["id"]}, {"_id": 0})
    return user_response(user, company["id"] if company else None)

@api_router.post("/auth/forgot-password")
@limiter.limit("5/hour")
async def forgot_password(request: Request, data: ForgotPasswordInput):
    email = data.email.lower()
    user  = await db.users.find_one({"email": email})
    if user:
        code = gen_code()
        await db.password_resets.delete_many({"email": email})
        await db.password_resets.insert_one({"email": email, "code": code,
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()})
        await send_verification_email(email, code, "პაროლის აღდგენის კოდი")
    return {"status": "თუ ეს მეილი რეგისტრირებულია, კოდი გაიგზავნა"}

@api_router.post("/auth/reset-password")
@limiter.limit("10/hour")
async def reset_password(request: Request, data: ResetPasswordInput):
    email = data.email.lower()
    rec   = await db.password_resets.find_one({"email": email, "code": data.code})
    if not rec:
        raise HTTPException(status_code=400, detail="არასწორი კოდი")
    if datetime.fromisoformat(rec["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="კოდის ვადა ამოიწურა")
    await db.users.update_one({"email": email}, {"$set": {"password_hash": hash_password(data.new_password)}})
    await db.password_resets.delete_many({"email": email})
    return {"status": "პაროლი აღდგენილია"}

@api_router.put("/auth/profile")
async def update_profile(data: UserUpdate, user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if updates:
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
        if "name" in updates:
            await db.companies.update_one({"owner_id": user["id"]}, {"$set": {"name": updates["name"]}})
    fresh   = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    company = await db.companies.find_one({"owner_id": user["id"]}, {"_id": 0})
    return user_response(fresh, company["id"] if company else None)

@api_router.get("/stats")
async def stats():
    companies = await db.companies.count_documents({})
    users     = await db.users.count_documents({})
    countries = await db.companies.distinct("country", {"country": {"$ne": ""}})
    return {"companies": companies, "users": users, "countries": len(countries)}

@api_router.get("/companies")
async def get_companies_by_country(country: Optional[str] = None):
    query = {"country": country} if country else {}
    return await db.companies.find(query, {"_id": 0}).to_list(100) or []

@api_router.get("/companies-countries")
async def get_companies_countries():
    return await db.companies.distinct("country", {"country": {"$ne": ""}}) or ["საქართველო"]

@api_router.get("/ads")
async def get_ads():
    return await db.ads.find({}, {"_id": 0}).to_list(50) or []

@api_router.get("/notifications")
async def get_user_notifications(user: dict = Depends(get_current_user)):
    return await db.notifications.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50) or []

@api_router.post("/admin/seen")
async def admin_seen(user: dict = Depends(require_admin)):
    await db.users.update_many({"seen_by_admin": False}, {"$set": {"seen_by_admin": True}})
    return {"status": "ok"}

@api_router.get("/admin/users")
async def admin_get_users(user: dict = Depends(require_admin)):
    return await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000) or []

@api_router.put("/admin/users/{user_id}")
async def admin_update_user(user_id: str, data: UserAdminUpdate, user: dict = Depends(require_admin)):
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="განახლება ცარიელია")
    await db.users.update_one({"id": user_id}, {"$set": updates})
    updated = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not updated:
        raise HTTPException(status_code=404, detail="მომხმარებელი ვერ მოიძებნა")
    return updated

@api_router.get("/admin/companies")
async def admin_get_companies(user: dict = Depends(require_admin)):
    return await db.companies.find({}, {"_id": 0}).to_list(1000) or []

@api_router.post("/admin/companies/{company_id}/verify")
async def admin_verify_company(company_id: str, user: dict = Depends(require_admin)):
    company = await db.companies.find_one({"id": company_id})
    if not company:
        raise HTTPException(status_code=404, detail="კომპანია ვერ მოიძებნა")
    new_status = not company.get("verified", False)
    await db.companies.update_one({"id": company_id}, {"$set": {"verified": new_status}})
    return {"status": "ok", "verified": new_status}

@api_router.get("/admin/stats")
async def admin_get_stats(user: dict = Depends(require_admin)):
    return {"companies": await db.companies.count_documents({}), "users": await db.users.count_documents({})}

@api_router.get("/admin/notifications")
async def admin_get_notifications(user: dict = Depends(require_admin)):
    return await db.notifications.find({"user_id": "admin"}, {"_id": 0}).sort("created_at", -1).to_list(100) or []

@api_router.get("/admin/ads")
async def admin_get_ads(user: dict = Depends(require_admin)):
    return await db.ads.find({}, {"_id": 0}).to_list(100) or []

@api_router.post("/admin/ads")
async def admin_create_ad(request: Request, user: dict = Depends(require_admin)):
    body = await request.json()
    ad_doc = {"id": str(uuid.uuid4()), "title": body.get("title", ""),
              "image_url": body.get("image_url", ""), "link": body.get("link", ""),
              "created_at": datetime.now(timezone.utc).isoformat()}
    await db.ads.insert_one(ad_doc)
    ad_doc.pop("_id", None)
    return ad_doc

@api_router.delete("/admin/ads/{ad_id}")
async def admin_delete_ad(ad_id: str, user: dict = Depends(require_admin)):
    await db.ads.delete_one({"id": ad_id})
    return {"status": "ok"}

@api_router.delete("/admin/companies/{company_id}")
async def admin_delete_specific_company(company_id: str, user: dict = Depends(require_admin)):
    await db.companies.delete_one({"id": company_id})
    return {"status": "ok"}

@api_router.delete("/admin/users/{user_id}")
async def admin_delete_specific_user(user_id: str, user: dict = Depends(require_admin)):
    await db.users.delete_one({"id": user_id})
    return {"status": "ok"}

@api_router.delete("/admin/{item_id}")
async def admin_delete_generic(item_id: str, user: dict = Depends(require_admin)):
    await db.users.delete_one({"id": item_id})
    await db.companies.delete_one({"id": item_id})
    await db.support_messages.delete_one({"id": item_id})
    return {"status": "ok"}

@api_router.get("/admin/support/inbox")
@api_router.get("/support/inbox")
async def admin_support_inbox(user: dict = Depends(require_admin)):
    return await db.support_messages.find({}, {"_id": 0}).sort("created_at", -1).to_list(100) or []

@api_router.get("/support/inbox/{user_id}")
async def get_support_thread(user_id: str, user: dict = Depends(require_admin)):
    return await db.support_messages.find({"user_id": user_id}, {"_id": 0}).sort("created_at", 1).to_list(200) or []

@api_router.post("/support/inbox/{user_id}")
async def admin_reply_to_user(user_id: str, request: Request, user: dict = Depends(require_admin)):
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="ტექსტი ცარიელია")
    doc = {"id": str(uuid.uuid4()), "user_id": user_id, "user_name": "ადმინი",
           "email": "", "text": text, "sender": "admin",
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.support_messages.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.post("/support")
async def post_support_message(request: Request, user: dict = Depends(get_current_user)):
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="ტექსტი ცარიელია")
    doc = {"id": str(uuid.uuid4()), "user_id": user["id"], "user_name": user.get("name", ""),
           "email": user.get("email", ""), "text": text, "sender": "user",
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.support_messages.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.get("/support/messages")
async def get_my_support_messages(user: dict = Depends(get_current_user)):
    return await db.support_messages.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", 1).to_list(200) or []

@api_router.get("/company/{company_id}/reviews")
async def get_company_reviews(company_id: str):
    return await db.reviews.find({"company_id": company_id}, {"_id": 0}).sort("created_at", -1).to_list(200) or []

@api_router.post("/company/{company_id}/reviews")
async def post_company_review(company_id: str, request: Request, user: dict = Depends(get_current_user)):
    body = await request.json()
    doc  = {"id": str(uuid.uuid4()), "company_id": company_id, "user_id": user["id"],
            "user_name": user.get("name", "მომხმარებელი"), "avatar_url": user.get("avatar_url", ""),
            "rating": int(body.get("rating", 5)), "text": (body.get("text") or "").strip(),
            "created_at": datetime.now(timezone.utc).isoformat()}
    await db.reviews.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.post("/account/avatar")
async def update_account_avatar(request: Request, user: dict = Depends(get_current_user)):
    body = await request.json()
    avatar_url = body.get("avatar_url", "")
    await db.users.update_one({"id": user["id"]}, {"$set": {"avatar_url": avatar_url}})
    return {"status": "ok", "avatar_url": avatar_url}

@api_router.post("/chat/read")
async def chat_mark_read(request: Request, user: dict = Depends(get_current_user)):
    body = await request.json()
    sender_id = body.get("sender_id")
    query: dict = {"recipient_id": user["id"], "read": False}
    if sender_id:
        query["sender_id"] = sender_id
    await db.messages.update_many(query, {"$set": {"read": True}})
    return {"status": "ok"}

@api_router.post("/chat/{company_id}/read")
async def chat_mark_read_company(company_id: str, request: Request, user: dict = Depends(get_current_user)):
    body = await request.json()
    sender_id = body.get("sender_id")
    query: dict = {"recipient_id": user["id"], "company_id": company_id, "read": False}
    if sender_id:
        query["sender_id"] = sender_id
    await db.messages.update_many(query, {"$set": {"read": True}})
    return {"status": "ok"}

@api_router.post("/chat/typing")
async def chat_typing(request: Request, user: dict = Depends(get_current_user)):
    return {"status": "ok"}

@api_router.post("/chat/{company_id}/typing")
async def chat_typing_company(company_id: str, user: dict = Depends(get_current_user)):
    return {"status": "ok"}

@api_router.get("/company/me")
async def get_my_company(user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"owner_id": user["id"]}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="პროფილი ვერ მოიძებნა")
    return company

async def rating_stats(company_id: str) -> dict:
    docs  = await db.reviews.find({"company_id": company_id}, {"_id": 0, "rating": 1}).to_list(5000)
    count = len(docs)
    avg   = round(sum(d["rating"] for d in docs) / count, 1) if count else 0
    return {"rating_avg": avg, "review_count": count}

@api_router.get("/company/{company_id}")
async def get_company(company_id: str, request: Request):
    company = await db.companies.find_one({"id": company_id})
    if not company:
        raise HTTPException(status_code=404, detail="პროფილი ვერ მოიძებნა")
    viewer  = client_ip(request)
    already = await db.company_views.find_one({"company_id": company_id, "viewer": viewer})
    if not already:
        await db.company_views.insert_one({"company_id": company_id, "viewer": viewer,
                                           "ts": datetime.now(timezone.utc).isoformat()})
        await db.companies.update_one({"id": company_id}, {"$inc": {"views": 1}})
        company["views"] = company.get("views", 0) + 1
    company.pop("_id", None)
    company.pop("owner_id", None)
    company.update(await rating_stats(company_id))
    return company

@api_router.put("/company/{company_id}")
async def update_company(company_id: str, data: CompanyUpdate, user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"id": company_id})
    if not company:
        raise HTTPException(status_code=404, detail="პროფილი ვერ მოიძებნა")
    if company["owner_id"] != user["id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="უფლება არ გაქვთ")
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.companies.update_one({"id": company_id}, {"$set": updates})
    return await db.companies.find_one({"id": company_id}, {"_id": 0})

@api_router.post("/upload")
@limiter.limit("30/hour")
async def generic_upload(request: Request, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    ext      = (file.filename.rsplit(".", 1)[-1] if "." in file.filename else "").lower()
    is_video = ext in VIDEO_EXTS
    path, _, _ = await _upload_to_storage(user["id"], file, VIDEO_EXTS if is_video else IMAGE_EXTS, MAX_VIDEO_SIZE if is_video else MAX_IMAGE_SIZE)
    return {"url": f"/api/files/{path}", "type": "video" if is_video else "image"}

async def _upload_to_storage(user_id: str, file: UploadFile, allowed_exts: set, max_size: int) -> tuple[str, str, str]:
    ext = (file.filename.rsplit(".", 1)[-1] if "." in file.filename else "").lower()
    if ext not in allowed_exts:
        raise HTTPException(status_code=400, detail=f"ფაილის ტიპი დაუშვებელია: .{ext}")
    data = await file.read()
    if len(data) > max_size:
        raise HTTPException(status_code=400, detail="ფაილის ზომა ძალიან დიდია")
    path         = f"{APP_NAME}/uploads/{user_id}/{uuid.uuid4()}.{ext}"
    content_type = MIME_TYPES.get(ext, file.content_type or "application/octet-stream")
    result       = await put_object(path, data, content_type)
    return result["path"], content_type, ext

@api_router.get("/files/{path:path}")
async def serve_file(path: str):
    if ".." in path or not SAFE_PATH_RE.match(path):
        raise HTTPException(status_code=400, detail="არასწორი მისამართი")
    try:
        data, content_type = await get_object(path)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise HTTPException(status_code=404, detail="ფაილი ვერ მოიძებნა")
        raise HTTPException(status_code=502, detail="ფაილის სერვისი მიუწვდომელია")
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="ფაილის სერვისი მიუწვდომელია")
    return Response(content=data, media_type=content_type)

@api_router.post("/account/change-password")
@limiter.limit("10/hour")
async def change_password(request: Request, data: PasswordChange, user: dict = Depends(get_current_user)):
    full = await db.users.find_one({"id": user["id"]})
    if not verify_password(data.current_password, full["password_hash"]):
        raise HTTPException(status_code=400, detail="მიმდინარე პაროლი არასწორია")
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="ახალი პაროლი მინიმუმ 6 სიმბოლო")
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_password(data.new_password)}})
    return {"status": "პაროლი განახლდა"}

async def _create_verification(user_id: str, field: str, new_value: str, deliver_to: str, purpose: str) -> bool:
    code = gen_code()
    await db.verifications.delete_many({"user_id": user_id, "field": field})
    await db.verifications.insert_one({"user_id": user_id, "field": field, "new_value": new_value,
        "code": code, "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()})
    return await send_verification_email(deliver_to, code, purpose)

@api_router.post("/account/request-email-change")
@limiter.limit("5/hour")
async def request_email_change(request: Request, data: ContactChangeRequest, user: dict = Depends(get_current_user)):
    new_email = data.new_value.lower()
    if await db.users.find_one({"email": new_email}):
        raise HTTPException(status_code=400, detail="ეს მეილი უკვე გამოყენებულია")
    await _create_verification(user["id"], "email", new_email, new_email, f"დაადასტურეთ ახალი მეილი: {new_email}")
    return {"status": "კოდი გაიგზავნა ახალ მეილზე"}

@api_router.post("/account/request-phone-change")
@limiter.limit("5/hour")
async def request_phone_change(request: Request, data: ContactChangeRequest, user: dict = Depends(get_current_user)):
    await _create_verification(user["id"], "phone", data.new_value, user["email"], f"დაადასტურეთ ტელეფონის ცვლილება: {data.new_value}")
    return {"status": "დადასტურების კოდი გაიგზავნა თქვენს მეილზე"}

@api_router.post("/account/confirm-change")
@limiter.limit("10/hour")
async def confirm_change(request: Request, data: CodeConfirm, user: dict = Depends(get_current_user)):
    v = await db.verifications.find_one({"user_id": user["id"], "code": data.code})
    if not v:
        raise HTTPException(status_code=400, detail="არასწორი კოდი")
    if datetime.fromisoformat(v["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="კოდის ვადა ამოიწურა")
    field, new_val = v["field"], v["new_value"]
    if field == "email":
        if await db.users.find_one({"email": new_val, "id": {"$ne": user["id"]}}):
            await db.verifications.delete_many({"user_id": user["id"], "field": field})
            raise HTTPException(status_code=400, detail="ეს მეილი უკვე გამოყენებულია")
        await db.users.update_one({"id": user["id"]}, {"$set": {"email": new_val}})
        await db.companies.update_one({"owner_id": user["id"]}, {"$set": {"email": new_val}})
    elif field == "phone":
        await db.users.update_one({"id": user["id"]}, {"$set": {"phone": new_val}})
        await db.companies.update_one({"owner_id": user["id"]}, {"$set": {"phone": new_val}})
    await db.verifications.delete_many({"user_id": user["id"], "field": field})
    return {"status": "მონაცემები წარმატებით განახლდა"}

@api_router.delete("/account")
async def delete_account(user: dict = Depends(get_current_user)):
    user_id   = user["id"]
    email     = user.get("email")
    companies = await db.companies.find({"owner_id": user_id}, {"id": 1}).to_list(100)
    cids      = [c["id"] for c in companies]
    await _purge_user_data(user_id, email, cids)
    await db.companies.delete_many({"owner_id": user_id})
    await db.users.delete_one({"id": user_id})
    return {"status": "ანგარიში წაშლილია"}

@api_router.get("/chat/inbox")
async def chat_inbox(user: dict = Depends(get_current_user)):
    return await db.messages.find(
        {"$or": [{"sender_id": user["id"]}, {"recipient_id": user["id"]}]}, {"_id": 0}
    ).sort("created_at", -1).to_list(100) or []

@api_router.get("/chat/inbox/unread-count")
async def chat_unread_count(user: dict = Depends(get_current_user)):
    count = await db.messages.count_documents({"recipient_id": user["id"], "read": False})
    return {"unread": count}

@api_router.get("/chat/messages/{recipient_id}")
async def get_chat_messages(recipient_id: str, user: dict = Depends(get_current_user)):
    return await db.messages.find({
        "$or": [{"sender_id": user["id"], "recipient_id": recipient_id},
                {"sender_id": recipient_id, "recipient_id": user["id"]}]
    }, {"_id": 0}).sort("created_at", 1).to_list(200) or []

@api_router.post("/chat/messages")
async def send_chat_message(request: Request, user: dict = Depends(get_current_user)):
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="შეტყობინება ცარიელია")
    doc = {"id": str(uuid.uuid4()), "sender_id": user["id"], "recipient_id": body.get("recipient_id"),
           "text": text, "read": False, "created_at": datetime.now(timezone.utc).isoformat()}
    await db.messages.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.get("/chat/{company_id}/messages")
async def get_company_chat_messages(company_id: str, user: dict = Depends(get_current_user)):
    return await db.messages.find({
        "$or": [{"company_id": company_id, "sender_id": user["id"]},
                {"company_id": company_id, "recipient_id": user["id"]}]
    }, {"_id": 0}).sort("created_at", 1).to_list(200) or []

@api_router.post("/chat/{company_id}/messages")
async def send_company_chat_message(company_id: str, request: Request, user: dict = Depends(get_current_user)):
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="შეტყობინება ცარიელია")
    company      = await db.companies.find_one({"id": company_id})
    recipient_id = company["owner_id"] if company else None
    doc = {"id": str(uuid.uuid4()), "company_id": company_id, "sender_id": user["id"],
           "recipient_id": recipient_id, "text": text, "read": False,
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.messages.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.get("/company/{company_id}/media/{media_id}/comments")
async def get_media_comments(company_id: str, media_id: str):
    return await db.photo_comments.find(
        {"company_id": company_id, "media_id": media_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(200) or []

@api_router.post("/company/{company_id}/media/{media_id}/comments")
async def post_media_comment(company_id: str, media_id: str, request: Request, user: dict = Depends(get_current_user)):
    body      = await request.json()
    text      = (body.get("text") or "").strip()
    image_url = (body.get("image_url") or "").strip()
    if not text and not image_url:
        raise HTTPException(status_code=400, detail="კომენტარი ცარიელია")
    comment = {"id": str(uuid.uuid4()), "company_id": company_id, "media_id": media_id,
               "user_id": user["id"], "user_name": user.get("name", "მომხმარებელი"),
               "avatar_url": user.get("avatar_url", ""), "text": text, "image_url": image_url,
               "created_at": datetime.now(timezone.utc).isoformat()}
    await db.photo_comments.insert_one(comment)
    comment.pop("_id", None)
    return comment


app.include_router(api_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
