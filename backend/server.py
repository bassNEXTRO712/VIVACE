from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import re
import uuid
import random
import logging
import jwt
import bcrypt
import httpx
import requests
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, UploadFile, File, Form, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field, field_validator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"

EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
APP_NAME = "company-profile"

EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "Company Profile")

MIME_TYPES = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif", "webp": "image/webp",
    "mp4": "video/mp4", "webm": "video/webm", "mov": "video/quicktime",
}
IMAGE_EXTS = {"jpg", "jpeg", "png", "gif", "webp"}
VIDEO_EXTS = {"mp4", "webm", "mov"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024      # 10 MB
MAX_VIDEO_SIZE = 100 * 1024 * 1024     # 100 MB

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI()
api_router = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)


def client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


limiter = Limiter(key_func=client_ip, default_limits=[])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


app.add_middleware(SecurityHeadersMiddleware)

# ---------------------------------------------------------------------------
# Object storage helpers
# ---------------------------------------------------------------------------
storage_key = None

def init_storage():
    global storage_key
    if storage_key:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key

def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    last_err = None
    for attempt in range(3):
        try:
            resp = requests.put(
                f"{STORAGE_URL}/objects/{path}",
                headers={"X-Storage-Key": key, "Content-Type": content_type},
                data=data, timeout=120,
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            last_err = e
            import time as _t
            _t.sleep(0.5 * (attempt + 1))
    raise last_err

def get_object(path: str):
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")

# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))

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

# ---------------------------------------------------------------------------
# Email helper
# ---------------------------------------------------------------------------
async def send_verification_email(recipient: str, code: str, purpose: str):
    subject = "VIVACE — დადასტურების კოდი"
    html = f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a20;padding:40px 16px;font-family:'Segoe UI',Arial,sans-serif;">
      <tr><td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#16162a;border:1px solid #262645;border-radius:16px;overflow:hidden;">
          <tr><td style="background:#0f0f24;padding:24px 32px;border-bottom:1px solid #262645;">
            <span style="color:#ffffff;font-size:24px;font-weight:800;letter-spacing:1px;">VIVACE</span>
            <span style="color:#f97316;font-size:22px;">&#9992;</span>
          </td></tr>
          <tr><td style="padding:32px;">
            <div style="color:#ffffff;font-size:20px;font-weight:700;padding-bottom:8px;">დადასტურების კოდი</div>
            <div style="color:#cbd5e1;font-size:14px;line-height:1.6;padding-bottom:24px;">{purpose}</div>
            <div align="center" style="background:linear-gradient(135deg,#f97316,#ea580c);border-radius:10px;padding:18px;color:#ffffff;font-size:34px;font-weight:800;letter-spacing:10px;">{code}</div>
            <div style="color:#94a3b8;font-size:12px;padding-top:24px;line-height:1.6;">კოდი მოქმედია 10 წუთის განმავლობაში. თუ ეს თქვენ არ მოგითხოვიათ, უბრალოდ იგნორირება გაუკეთეთ ამ წერილს.</div>
          </td></tr>
          <tr><td style="background:#0f0f24;padding:20px 32px;border-top:1px solid #262645;text-align:center;">
            <div style="color:#94a3b8;font-size:13px;">გისურვებთ სასიამოვნო მოგზაურობას,</div>
            <div style="color:#f97316;font-size:14px;font-weight:700;padding-top:4px;">VIVACE Team</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
    """
    payload = {"to": [recipient], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            resp = await c.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                                headers={"X-Email-Key": EMAIL_KEY}, json=payload)
        resp.raise_for_status()
        return True
    except Exception as e:
        logger.error(f"Email send failed: {e}")
        return False

def gen_code() -> str:
    return f"{random.randint(0, 999999):06d}"


async def _purge_user_data(user_id: str, email: str, cids: list):
    """Cascade-delete all rows that belong to a user / their companies to avoid orphans."""
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

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class RegisterInput(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=200)
    role: str = "user"

    @field_validator("name")
    @classmethod
    def strip_name(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("სახელი სავალდებულოა")
        return v

class LoginInput(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=200)

class ForgotPasswordInput(BaseModel):
    email: EmailStr

class ResetPasswordInput(BaseModel):
    email: EmailStr
    code: str = Field(..., min_length=4, max_length=10)
    new_password: str = Field(..., min_length=6, max_length=200)

class UserUpdate(BaseModel):
    name: Optional[str] = None

class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    country: Optional[str] = None
    service_cities: Optional[List[str]] = None
    description: Optional[str] = None
    logo_url: Optional[str] = None
    cover_url: Optional[str] = None

class PasswordChange(BaseModel):
    current_password: str
    new_password: str

class ContactChangeRequest(BaseModel):
    new_value: str

class CodeConfirm(BaseModel):
    code: str

class ChatMessageInput(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)

class ReviewInput(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    text: str = Field(default="", max_length=2000)

class CommentInput(BaseModel):
    text: str = Field(default="", max_length=1000)
    image_url: str = Field(default="")

class AdminUserUpdate(BaseModel):
    name: Optional[str] = None
    password: Optional[str] = None

class BlockInput(BaseModel):
    blocked: bool

class VerifyInput(BaseModel):
    verified: bool

class SupportInput(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)

class AdInput(BaseModel):
    title: str = Field(default="", max_length=200)
    link: str = Field(default="", max_length=500)
    media_url: str
    media_type: str = "image"

def company_card(doc: dict) -> dict:
    return {
        "id": doc.get("id"),
        "name": doc.get("name"),
        "country": doc.get("country", ""),
        "service_cities": doc.get("service_cities", []),
        "address": doc.get("address", ""),
        "description": doc.get("description", ""),
        "logo_url": doc.get("logo_url", ""),
        "cover_url": doc.get("cover_url", ""),
        "verified": doc.get("verified", False),
        "media_count": len(doc.get("media", [])),
    }

def public_company(doc: dict) -> dict:
    doc.pop("_id", None)
    doc.pop("owner_id", None)
    return doc

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

# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------
@api_router.post("/auth/register")
@limiter.limit("10/hour")
async def register(request: Request, data: RegisterInput):
    email = data.email.lower()
    role = "company" if data.role == "company" else "user"
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
    token = create_access_token(user_id, email)
    return {"token": token, "user": user_response(user_doc, company_id)}

@api_router.post("/auth/verify-email")
async def verify_email(data: CodeConfirm, user: dict = Depends(get_current_user)):
    v = await db.verifications.find_one({"user_id": user["id"], "field": "email_verify", "code": data.code})
    if not v:
        raise HTTPException(status_code=400, detail="არასწორი კოდი")
    if datetime.fromisoformat(v["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="კოდის ვადა ამოიწურა")
    await db.users.update_one({"id": user["id"]}, {"$set": {"email_verified": True}})
    await db.verifications.delete_many({"user_id": user["id"], "field": "email_verify"})
    return {"status": "მეილი დადასტურდა"}

@api_router.post("/auth/resend-verification")
async def resend_verification(user: dict = Depends(get_current_user)):
    await _send_email_code(user["id"], user["email"], "email_verify", "დაადასტურეთ თქვენი მეილი")
    return {"status": "კოდი ხელახლა გაიგზავნა"}

@api_router.post("/auth/login")
@limiter.limit("10/minute")
async def login(request: Request, data: LoginInput):
    email = data.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="არასწორი მეილი ან პაროლი")
    if user.get("blocked") and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="თქვენი ანგარიში დაბლოკილია. დაუკავშირდით ადმინისტრაციას.")
    company = await db.companies.find_one({"owner_id": user["id"]}, {"_id": 0})
    token = create_access_token(user["id"], email)
    return {"token": token, "user": user_response(user, company["id"] if company else None)}

@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"owner_id": user["id"]}, {"_id": 0})
    return user_response(user, company["id"] if company else None)

@api_router.post("/auth/forgot-password")
@limiter.limit("5/hour")
async def forgot_password(request: Request, data: ForgotPasswordInput):
    email = data.email.lower()
    user = await db.users.find_one({"email": email})
    if user:
        code = gen_code()
        await db.password_resets.delete_many({"email": email})
        await db.password_resets.insert_one({
            "email": email, "code": code,
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(),
        })
        await send_verification_email(email, code, "პაროლის აღდგენის კოდი")
    return {"status": "თუ ეს მეილი რეგისტრირებულია, კოდი გაიგზავნა"}

@api_router.post("/auth/reset-password")
@limiter.limit("10/hour")
async def reset_password(request: Request, data: ResetPasswordInput):
    email = data.email.lower()
    rec = await db.password_resets.find_one({"email": email, "code": data.code})
    if not rec:
        raise HTTPException(status_code=400, detail="არასწორი კოდი")
    if datetime.fromisoformat(rec["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="კოდის ვადა ამოიწურა")
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="პაროლი მინიმუმ 6 სიმბოლო")
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
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    company = await db.companies.find_one({"owner_id": user["id"]}, {"_id": 0})
    return user_response(fresh, company["id"] if company else None)

@api_router.get("/stats")
async def stats():
    companies = await db.companies.count_documents({})
    users = await db.users.count_documents({})
    countries = await db.companies.distinct("country", {"country": {"$ne": ""}})
    return {"companies": companies, "users": users, "countries": len(countries)}

# ---------------------------------------------------------------------------
# Company profile endpoints
# ---------------------------------------------------------------------------
@api_router.get("/company/me")
async def get_my_company(user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"owner_id": user["id"]}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="პროფილი ვერ მოიძებნა")
    return company

async def rating_stats(company_id: str) -> dict:
    docs = await db.reviews.find({"company_id": company_id}, {"_id": 0, "rating": 1}).to_list(5000)
    count = len(docs)
    avg = round(sum(d["rating"] for d in docs) / count, 1) if count else 0
    return {"rating_avg": avg, "review_count": count}

@api_router.get("/company/{company_id}")
async def get_company(company_id: str, request: Request):
    company = await db.companies.find_one({"id": company_id})
    if not company:
        raise HTTPException(status_code=404, detail="პროფილი ვერ მოიძებნა")
    viewer = client_ip(request)
    already = await db.company_views.find_one({"company_id": company_id, "viewer": viewer})
    if not already:
        await db.company_views.insert_one({
            "company_id": company_id, "viewer": viewer,
            "ts": datetime.now(timezone.utc).isoformat(),
        })
        await db.companies.update_one({"id": company_id}, {"$inc": {"views": 1}})
        company["views"] = company.get("views", 0) + 1
    company = public_company(company)
    company.update(await rating_stats(company_id))
    return company

@api_router.get("/company/{company_id}/reviews")
async def get_reviews(company_id: str):
    docs = await db.reviews.find({"company_id": company_id}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    stats = await rating_stats(company_id)
    return {"reviews": docs, **stats}

@api_router.post("/company/{company_id}/reviews")
async def add_review(company_id: str, data: ReviewInput, user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="კომპანია ვერ მოიძებნა")
    if company["owner_id"] == user["id"]:
        raise HTTPException(status_code=400, detail="საკუთარ პროფილს ვერ შეაფასებთ")
    now = datetime.now(timezone.utc).isoformat()
    existing = await db.reviews.find_one({"company_id": company_id, "user_id": user["id"]})
    if existing:
        await db.reviews.update_one(
            {"company_id": company_id, "user_id": user["id"]},
            {"$set": {"rating": data.rating, "text": data.text, "created_at": now,
                      "avatar_url": user.get("avatar_url", "")}},
        )
    else:
        await db.reviews.insert_one({
            "id": str(uuid.uuid4()), "company_id": company_id,
            "user_id": user["id"], "user_name": user["name"],
            "avatar_url": user.get("avatar_url", ""),
            "rating": data.rating, "text": data.text, "created_at": now,
        })
    return await get_reviews(company_id)

@api_router.get("/company/{company_id}/media/{media_id}/comments")
async def get_photo_comments(company_id: str, media_id: str):
    docs = await db.photo_comments.find(
        {"company_id": company_id, "media_id": media_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(1000)
    return docs

@api_router.post("/company/{company_id}/media/{media_id}/comments")
async def add_photo_comment(company_id: str, media_id: str, data: CommentInput, user: dict = Depends(get_current_user)):
    if not data.text.strip() and not data.image_url:
        raise HTTPException(status_code=400, detail="ცარიელი კომენტარი")
    comment = {
        "id": str(uuid.uuid4()), "company_id": company_id, "media_id": media_id,
        "user_id": user["id"], "user_name": user["name"],
        "avatar_url": user.get("avatar_url", ""),
        "text": data.text, "image_url": data.image_url,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.photo_comments.insert_one(comment)
    comment.pop("_id", None)
    return comment

@api_router.post("/upload")
async def generic_upload(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    ext = (file.filename.rsplit(".", 1)[-1] if "." in file.filename else "").lower()
    is_video = ext in VIDEO_EXTS
    allowed = VIDEO_EXTS if is_video else IMAGE_EXTS
    max_size = MAX_VIDEO_SIZE if is_video else MAX_IMAGE_SIZE
    path, _, _ = await _upload_to_storage(user["id"], file, allowed, max_size)
    return {"url": f"/api/files/{path}", "type": "video" if is_video else "image"}

@api_router.put("/company/{company_id}")
async def update_company(company_id: str, data: CompanyUpdate, user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"id": company_id})
    if not company:
        raise HTTPException(status_code=404, detail="პროფილი ვერ მოიძებნა")
    if company["owner_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="უფლება არ გაქვთ")
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.companies.update_one({"id": company_id}, {"$set": updates})
    updated = await db.companies.find_one({"id": company_id}, {"_id": 0})
    return updated

# ---------------------------------------------------------------------------
# Media / file endpoints
# ---------------------------------------------------------------------------
async def _upload_to_storage(user_id: str, file: UploadFile, allowed_exts, max_size):
    ext = (file.filename.rsplit(".", 1)[-1] if "." in file.filename else "").lower()
    if ext not in allowed_exts:
        raise HTTPException(status_code=400, detail=f"ფაილის ტიპი დაუშვებელია: .{ext}")
    data = await file.read()
    if len(data) > max_size:
        raise HTTPException(status_code=400, detail="ფაილის ზომა ძალიან დიდია")
    path = f"{APP_NAME}/uploads/{user_id}/{uuid.uuid4()}.{ext}"
    content_type = MIME_TYPES.get(ext, file.content_type or "application/octet-stream")
    result = put_object(path, data, content_type)
    return result["path"], content_type, ext

@api_router.post("/company/{company_id}/logo")
async def upload_logo(company_id: str, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"id": company_id})
    if not company or company["owner_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="უფლება არ გაქვთ")
    path, _, _ = await _upload_to_storage(user["id"], file, IMAGE_EXTS, MAX_IMAGE_SIZE)
    url = f"/api/files/{path}"
    await db.companies.update_one({"id": company_id}, {"$set": {"logo_url": url}})
    return {"url": url}

@api_router.post("/company/{company_id}/cover")
async def upload_cover(company_id: str, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"id": company_id})
    if not company or company["owner_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="უფლება არ გაქვთ")
    path, _, _ = await _upload_to_storage(user["id"], file, IMAGE_EXTS, MAX_IMAGE_SIZE)
    url = f"/api/files/{path}"
    await db.companies.update_one({"id": company_id}, {"$set": {"cover_url": url}})
    return {"url": url}

@api_router.post("/company/{company_id}/media")
async def upload_media(company_id: str, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"id": company_id})
    if not company or company["owner_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="უფლება არ გაქვთ")
    ext = (file.filename.rsplit(".", 1)[-1] if "." in file.filename else "").lower()
    is_video = ext in VIDEO_EXTS
    allowed = VIDEO_EXTS if is_video else IMAGE_EXTS
    max_size = MAX_VIDEO_SIZE if is_video else MAX_IMAGE_SIZE
    path, content_type, ext = await _upload_to_storage(user["id"], file, allowed, max_size)
    item = {
        "id": str(uuid.uuid4()),
        "url": f"/api/files/{path}",
        "storage_path": path,
        "type": "video" if is_video else "image",
        "content_type": content_type,
        "original_filename": file.filename,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.companies.update_one({"id": company_id}, {"$push": {"media": item}})
    return item

@api_router.delete("/company/{company_id}/media/{media_id}")
async def delete_media(company_id: str, media_id: str, user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"id": company_id})
    if not company or company["owner_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="უფლება არ გაქვთ")
    await db.companies.update_one({"id": company_id}, {"$pull": {"media": {"id": media_id}}})
    return {"status": "deleted"}

@api_router.post("/account/avatar")
async def upload_avatar(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    path, _, _ = await _upload_to_storage(user["id"], file, IMAGE_EXTS, MAX_IMAGE_SIZE)
    url = f"/api/files/{path}"
    await db.users.update_one({"id": user["id"]}, {"$set": {"avatar_url": url}})
    return {"url": url}

@api_router.get("/files/{path:path}")
async def serve_file(path: str):
    try:
        data, content_type = get_object(path)
    except Exception:
        raise HTTPException(status_code=404, detail="ფაილი ვერ მოიძებნა")
    return Response(content=data, media_type=content_type)

# ---------------------------------------------------------------------------
# Account security endpoints
# ---------------------------------------------------------------------------
@api_router.post("/account/change-password")
async def change_password(data: PasswordChange, user: dict = Depends(get_current_user)):
    full = await db.users.find_one({"id": user["id"]})
    if not verify_password(data.current_password, full["password_hash"]):
        raise HTTPException(status_code=400, detail="მიმდინარე პაროლი არასწორია")
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="ახალი პაროლი მინიმუმ 6 სიმბოლო")
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_password(data.new_password)}})
    return {"status": "პაროლი განახლდა"}

async def _create_verification(user_id: str, field: str, new_value: str, deliver_to: str, purpose: str):
    code = gen_code()
    await db.verifications.delete_many({"user_id": user_id, "field": field})
    await db.verifications.insert_one({
        "user_id": user_id, "field": field, "new_value": new_value, "code": code,
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
    })
    sent = await send_verification_email(deliver_to, code, purpose)
    return sent

@api_router.post("/account/request-email-change")
async def request_email_change(data: ContactChangeRequest, user: dict = Depends(get_current_user)):
    new_email = data.new_value.lower()
    if await db.users.find_one({"email": new_email}):
        raise HTTPException(status_code=400, detail="ეს მეილი უკვე გამოყენებულია")
    await _create_verification(user["id"], "email", new_email, new_email,
                               f"დაადასტურეთ ახალი მეილი: {new_email}")
    return {"status": "კოდი გაიგზავნა ახალ მეილზე"}

@api_router.post("/account/request-phone-change")
async def request_phone_change(data: ContactChangeRequest, user: dict = Depends(get_current_user)):
    await _create_verification(user["id"], "phone", data.new_value, user["email"],
                               f"დაადასტურეთ ტელეფონის ცვლილება: {data.new_value}")
    return {"status": "დადასტურების კოდი გაიგზავნა თქვენს მეილზე"}

@api_router.post("/account/confirm-change")
async def confirm_change(data: CodeConfirm, user: dict = Depends(get_current_user)):
    v = await db.verifications.find_one({"user_id": user["id"], "code": data.code})
    if not v:
        raise HTTPException(status_code=400, detail="არასწორი კოდი")
    if datetime.fromisoformat(v["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="კოდის ვადა ამოიწურა")
    await db.users.update_one({"id": user["id"]}, {"$set": {v["field"]: v["new_value"]}})
    if v["field"] == "email":
        await db.companies.update_one({"owner_id": user["id"]}, {"$set": {"email": v["new_value"]}})
    elif v["field"] == "phone":
        await db.companies.update_one({"owner_id": user["id"]}, {"$set": {"phone": v["new_value"]}})
    await db.verifications.delete_many({"user_id": user["id"], "field": v["field"]})
    return {"status": "ცვლილება დადასტურდა", "field": v["field"], "value": v["new_value"]}

@api_router.post("/account/request-deletion")
async def request_deletion(user: dict = Depends(get_current_user)):
    await _create_verification(user["id"], "delete", "1", user["email"],
                               "დაადასტურეთ ანგარიშის სამუდამო წაშლა")
    return {"status": "ანგარიშის წაშლის კოდი გაიგზავნა თქვენს მეილზე"}

@api_router.post("/account/confirm-deletion")
async def confirm_deletion(data: CodeConfirm, user: dict = Depends(get_current_user)):
    v = await db.verifications.find_one({"user_id": user["id"], "field": "delete", "code": data.code})
    if not v:
        raise HTTPException(status_code=400, detail="არასწორი კოდი")
    if datetime.fromisoformat(v["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="კოდის ვადა ამოიწურა")
    companies = await db.companies.find({"owner_id": user["id"]}, {"_id": 0, "id": 1}).to_list(100)
    company_ids = [c["id"] for c in companies]
    await db.companies.delete_many({"owner_id": user["id"]})
    await _purge_user_data(user["id"], user["email"], company_ids)
    await db.users.delete_one({"id": user["id"]})
    return {"status": "ანგარიში წაიშალა"}

# ---------------------------------------------------------------------------
# App wiring
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Public directory endpoints
# ---------------------------------------------------------------------------
@api_router.get("/companies")
async def list_companies(country: Optional[str] = None, city: Optional[str] = None,
                         q: Optional[str] = None, sort: Optional[str] = None):
    query = {}
    if country:
        query["country"] = country
    if city:
        query["service_cities"] = city
    if q:
        query["name"] = {"$regex": re.escape(q), "$options": "i"}
    docs = await db.companies.find(query).to_list(1000)
    ids = [d["id"] for d in docs]
    stats = {}
    if ids:
        pipeline = [
            {"$match": {"company_id": {"$in": ids}}},
            {"$group": {"_id": "$company_id", "avg": {"$avg": "$rating"}, "count": {"$sum": 1}}},
        ]
        async for r in db.reviews.aggregate(pipeline):
            stats[r["_id"]] = {"rating_avg": round(r["avg"], 1), "review_count": r["count"]}
    cards = []
    for d in docs:
        card = company_card(d)
        card.update(stats.get(d["id"], {"rating_avg": 0, "review_count": 0}))
        card["views"] = d.get("views", 0)
        card["created_at"] = d.get("created_at", "")
        cards.append(card)
    if sort == "views":
        cards.sort(key=lambda c: c.get("views", 0), reverse=True)
    elif sort == "rating":
        cards.sort(key=lambda c: (c.get("rating_avg", 0), c.get("review_count", 0)), reverse=True)
    elif sort == "newest":
        cards.sort(key=lambda c: c.get("created_at", ""), reverse=True)
    return cards

@api_router.get("/companies-countries")
async def companies_countries():
    pipeline = [
        {"$match": {"country": {"$ne": ""}}},
        {"$group": {"_id": "$country", "count": {"$sum": 1}}},
    ]
    rows = await db.companies.aggregate(pipeline).to_list(1000)
    return [{"country": r["_id"], "count": r["count"]} for r in rows]

# ---------------------------------------------------------------------------
# Chat endpoints
# ---------------------------------------------------------------------------
@api_router.post("/chat/{company_id}/messages")
async def send_visitor_message(company_id: str, data: ChatMessageInput, user: dict = Depends(get_current_user)):
    if user.get("blocked"):
        raise HTTPException(status_code=403, detail="თქვენი ანგარიში დაბლოკილია")
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="კომპანია ვერ მოიძებნა")
    msg = {
        "id": str(uuid.uuid4()), "company_id": company_id,
        "visitor_id": user["id"], "visitor_name": user["name"],
        "sender": "visitor", "text": data.text,
        "read_by_company": False, "read_by_visitor": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.messages.insert_one(msg)
    msg.pop("_id", None)
    return msg

@api_router.get("/chat/{company_id}/messages")
async def get_visitor_messages(company_id: str, user: dict = Depends(get_current_user)):
    docs = await db.messages.find(
        {"company_id": company_id, "visitor_id": user["id"]}, {"_id": 0}
    ).sort("created_at", 1).to_list(1000)
    return docs

@api_router.post("/chat/{company_id}/read")
async def visitor_mark_read(company_id: str, user: dict = Depends(get_current_user)):
    await db.messages.update_many(
        {"company_id": company_id, "visitor_id": user["id"], "sender": "company", "read_by_visitor": {"$ne": True}},
        {"$set": {"read_by_visitor": True}},
    )
    return {"status": "ok"}

@api_router.get("/chat/inbox")
async def chat_inbox(user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"owner_id": user["id"]}, {"_id": 0})
    if not company:
        return []
    docs = await db.messages.find({"company_id": company["id"]}, {"_id": 0}).sort("created_at", 1).to_list(2000)
    convos = {}
    for m in docs:
        vid = m["visitor_id"]
        if vid not in convos:
            convos[vid] = {
                "visitor_id": vid,
                "visitor_name": m.get("visitor_name", "მომხმარებელი"),
                "last_text": m["text"],
                "last_at": m["created_at"],
                "unread": 0,
            }
        convos[vid]["last_text"] = m["text"]
        convos[vid]["last_at"] = m["created_at"]
        if m["sender"] == "visitor" and not m.get("read_by_company", False):
            convos[vid]["unread"] += 1
    return sorted(convos.values(), key=lambda x: x["last_at"], reverse=True)

@api_router.get("/chat/inbox/unread-count")
async def inbox_unread_count(user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"owner_id": user["id"]}, {"_id": 0})
    if not company:
        return {"count": 0}
    count = await db.messages.count_documents(
        {"company_id": company["id"], "sender": "visitor", "read_by_company": {"$ne": True}}
    )
    return {"count": count}

@api_router.get("/chat/inbox/{visitor_id}/messages")
async def get_company_conversation(visitor_id: str, user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"owner_id": user["id"]}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="პროფილი ვერ მოიძებნა")
    await db.messages.update_many(
        {"company_id": company["id"], "visitor_id": visitor_id, "sender": "visitor", "read_by_company": {"$ne": True}},
        {"$set": {"read_by_company": True}},
    )
    docs = await db.messages.find(
        {"company_id": company["id"], "visitor_id": visitor_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(1000)
    return docs

@api_router.post("/chat/inbox/{visitor_id}/messages")
async def send_company_reply(visitor_id: str, data: ChatMessageInput, user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"owner_id": user["id"]}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="პროფილი ვერ მოიძებნა")
    visitor = await db.messages.find_one({"company_id": company["id"], "visitor_id": visitor_id}, {"_id": 0})
    msg = {
        "id": str(uuid.uuid4()), "company_id": company["id"],
        "visitor_id": visitor_id, "visitor_name": visitor.get("visitor_name") if visitor else "მომხმარებელი",
        "sender": "company", "text": data.text,
        "read_by_company": True, "read_by_visitor": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.messages.insert_one(msg)
    msg.pop("_id", None)
    return msg

@api_router.get("/")
async def root():
    return {"message": "Company Profile API"}

# ---------------------------------------------------------------------------
# Typing indicators
# ---------------------------------------------------------------------------
async def _set_typing(key: str):
    until = (datetime.now(timezone.utc) + timedelta(seconds=5)).isoformat()
    await db.typing.update_one({"key": key}, {"$set": {"key": key, "until": until}}, upsert=True)

async def _get_typing(key: str) -> bool:
    doc = await db.typing.find_one({"key": key})
    if not doc:
        return False
    return datetime.fromisoformat(doc["until"]) > datetime.now(timezone.utc)

@api_router.post("/chat/{company_id}/typing")
async def visitor_typing(company_id: str, user: dict = Depends(get_current_user)):
    await _set_typing(f"{company_id}:{user['id']}:visitor")
    return {"ok": True}

@api_router.get("/chat/{company_id}/typing")
async def visitor_typing_status(company_id: str, user: dict = Depends(get_current_user)):
    return {"typing": await _get_typing(f"{company_id}:{user['id']}:company")}

@api_router.post("/chat/inbox/{visitor_id}/typing")
async def company_typing(visitor_id: str, user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"owner_id": user["id"]}, {"_id": 0})
    if company:
        await _set_typing(f"{company['id']}:{visitor_id}:company")
    return {"ok": True}

@api_router.get("/chat/inbox/{visitor_id}/typing")
async def company_typing_status(visitor_id: str, user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"owner_id": user["id"]}, {"_id": 0})
    if not company:
        return {"typing": False}
    return {"typing": await _get_typing(f"{company['id']}:{visitor_id}:visitor")}

# ---------------------------------------------------------------------------
# Support chat (with administration)
# ---------------------------------------------------------------------------
@api_router.post("/support/messages")
async def support_send(data: SupportInput, user: dict = Depends(get_current_user)):
    if user.get("blocked"):
        raise HTTPException(status_code=403, detail="თქვენი ანგარიში დაბლოკილია")
    msg = {
        "id": str(uuid.uuid4()), "user_id": user["id"], "user_name": user["name"],
        "avatar_url": user.get("avatar_url", ""), "sender": "user", "text": data.text,
        "read_by_admin": False, "read_by_user": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.support_messages.insert_one(msg)
    msg.pop("_id", None)
    return msg

@api_router.get("/support/messages")
async def support_thread(user: dict = Depends(get_current_user)):
    await db.support_messages.update_many(
        {"user_id": user["id"], "sender": "admin", "read_by_user": {"$ne": True}},
        {"$set": {"read_by_user": True}},
    )
    return await db.support_messages.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", 1).to_list(1000)

@api_router.get("/support/inbox")
async def support_inbox(admin: dict = Depends(require_admin)):
    docs = await db.support_messages.find({}, {"_id": 0}).sort("created_at", 1).to_list(5000)
    convos = {}
    for m in docs:
        uid = m["user_id"]
        convos.setdefault(uid, {"user_id": uid, "user_name": m.get("user_name", "მომხმარებელი"),
                                "avatar_url": m.get("avatar_url", ""), "unread": 0})
        convos[uid]["last_text"] = m["text"]
        convos[uid]["last_at"] = m["created_at"]
        if m["sender"] == "user" and not m.get("read_by_admin", False):
            convos[uid]["unread"] += 1
    return sorted(convos.values(), key=lambda x: x.get("last_at", ""), reverse=True)

@api_router.get("/support/inbox/{user_id}")
async def support_conversation(user_id: str, admin: dict = Depends(require_admin)):
    await db.support_messages.update_many(
        {"user_id": user_id, "sender": "user", "read_by_admin": {"$ne": True}},
        {"$set": {"read_by_admin": True}},
    )
    return await db.support_messages.find({"user_id": user_id}, {"_id": 0}).sort("created_at", 1).to_list(1000)

@api_router.post("/support/inbox/{user_id}")
async def support_reply(user_id: str, data: SupportInput, admin: dict = Depends(require_admin)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    msg = {
        "id": str(uuid.uuid4()), "user_id": user_id,
        "user_name": target["name"] if target else "მომხმარებელი", "avatar_url": "",
        "sender": "admin", "text": data.text,
        "read_by_admin": True, "read_by_user": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.support_messages.insert_one(msg)
    msg.pop("_id", None)
    return msg

# ---------------------------------------------------------------------------
# Ads
# ---------------------------------------------------------------------------
@api_router.get("/ads")
async def list_ads():
    return await db.ads.find({"active": True}, {"_id": 0}).sort("created_at", -1).to_list(50)

@api_router.post("/admin/ads")
async def create_ad(data: AdInput, admin: dict = Depends(require_admin)):
    ad = {"id": str(uuid.uuid4()), "title": data.title, "link": data.link,
          "media_url": data.media_url, "media_type": data.media_type, "active": True,
          "created_at": datetime.now(timezone.utc).isoformat()}
    await db.ads.insert_one(ad)
    ad.pop("_id", None)
    return ad

@api_router.get("/admin/ads")
async def admin_list_ads(admin: dict = Depends(require_admin)):
    return await db.ads.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)

@api_router.delete("/admin/ads/{ad_id}")
async def delete_ad(ad_id: str, admin: dict = Depends(require_admin)):
    await db.ads.delete_one({"id": ad_id})
    return {"status": "deleted"}

# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------
@api_router.get("/notifications")
async def notifications(user: dict = Depends(get_current_user)):
    items = []
    if user.get("role") == "admin":
        sup = await db.support_messages.find({"sender": "user", "read_by_admin": {"$ne": True}}, {"_id": 0}).to_list(2000)
        grouped = {}
        for m in sup:
            grouped.setdefault(m["user_id"], {"title": m.get("user_name", "მომხმარებელი"),
                                              "subtitle": m["text"], "link": "/admin", "count": 0})
            grouped[m["user_id"]]["count"] += 1
        items = list(grouped.values())
        new_regs = await db.users.find({"role": {"$ne": "admin"}, "seen_by_admin": {"$ne": True}}, {"_id": 0}).sort("created_at", -1).to_list(50)
        for u in new_regs:
            items.append({"title": f"ახალი რეგისტრაცია: {u['name']}", "subtitle": u["email"], "link": "/admin", "count": 1})
        return {"count": sum(i["count"] for i in items), "items": items}
    if user.get("role") == "company":
        company = await db.companies.find_one({"owner_id": user["id"]}, {"_id": 0})
        if company:
            docs = await db.messages.find(
                {"company_id": company["id"], "sender": "visitor", "read_by_company": {"$ne": True}}, {"_id": 0}
            ).sort("created_at", -1).to_list(1000)
            grouped = {}
            for m in docs:
                grouped.setdefault(m["visitor_id"], {"title": m.get("visitor_name", "მომხმარებელი"),
                                                     "subtitle": m["text"], "link": "/dashboard", "count": 0})
                grouped[m["visitor_id"]]["count"] += 1
            items = list(grouped.values())
    else:
        docs = await db.messages.find(
            {"visitor_id": user["id"], "sender": "company", "read_by_visitor": {"$ne": True}}, {"_id": 0}
        ).sort("created_at", -1).to_list(1000)
        grouped = {}
        for m in docs:
            grouped.setdefault(m["company_id"], {"company_id": m["company_id"], "subtitle": m["text"], "count": 0})
            grouped[m["company_id"]]["count"] += 1
        for cid, g in grouped.items():
            company = await db.companies.find_one({"id": cid}, {"_id": 0, "name": 1})
            g["title"] = company["name"] if company else "კომპანია"
            g["link"] = f"/company/{cid}"
            items.append(g)
    return {"count": sum(i["count"] for i in items), "items": items}

# ---------------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------------
@api_router.get("/admin/stats")
async def admin_stats(admin: dict = Depends(require_admin)):
    return {
        "users": await db.users.count_documents({"role": "user"}),
        "companies": await db.companies.count_documents({}),
        "reviews": await db.reviews.count_documents({}),
        "messages": await db.messages.count_documents({}),
        "total_accounts": await db.users.count_documents({}),
    }

@api_router.get("/admin/users")
async def admin_users(admin: dict = Depends(require_admin)):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(5000)
    return docs

@api_router.get("/admin/companies")
async def admin_companies(admin: dict = Depends(require_admin)):
    docs = await db.companies.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    return [company_card(d) for d in docs]

@api_router.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, admin: dict = Depends(require_admin)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="მომხმარებელი ვერ მოიძებნა")
    if target.get("role") == "admin":
        raise HTTPException(status_code=400, detail="ადმინის წაშლა შეუძლებელია")
    companies = await db.companies.find({"owner_id": user_id}, {"_id": 0, "id": 1}).to_list(100)
    cids = [c["id"] for c in companies]
    await _purge_user_data(user_id, target.get("email", ""), cids)
    await db.companies.delete_many({"owner_id": user_id})
    await db.users.delete_one({"id": user_id})
    return {"status": "მომხმარებელი წაიშალა"}

@api_router.delete("/admin/companies/{company_id}")
async def admin_delete_company(company_id: str, admin: dict = Depends(require_admin)):
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="კომპანია ვერ მოიძებნა")
    owner_id = company["owner_id"]
    owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "email": 1, "role": 1})
    await db.companies.delete_one({"id": company_id})
    await _purge_user_data(owner_id, owner.get("email", "") if owner else "", [company_id])
    if owner and owner.get("role") != "admin":
        await db.users.delete_one({"id": owner_id})
    return {"status": "კომპანია წაიშალა"}

@api_router.get("/admin/users/{user_id}")
async def admin_user_detail(user_id: str, admin: dict = Depends(require_admin)):
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not u:
        raise HTTPException(status_code=404, detail="ვერ მოიძებნა")
    company = await db.companies.find_one({"owner_id": user_id}, {"_id": 0})
    u["company"] = company
    return u

@api_router.put("/admin/users/{user_id}")
async def admin_update_user(user_id: str, data: AdminUserUpdate, admin: dict = Depends(require_admin)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="ვერ მოიძებნა")
    updates = {}
    if data.name is not None:
        updates["name"] = data.name
        await db.companies.update_one({"owner_id": user_id}, {"$set": {"name": data.name}})
    if data.password:
        if len(data.password) < 6:
            raise HTTPException(status_code=400, detail="პაროლი მინიმუმ 6 სიმბოლო")
        updates["password_hash"] = hash_password(data.password)
    if updates:
        await db.users.update_one({"id": user_id}, {"$set": updates})
    return {"status": "განახლდა"}

@api_router.post("/admin/users/{user_id}/block")
async def admin_block_user(user_id: str, data: BlockInput, admin: dict = Depends(require_admin)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target or target.get("role") == "admin":
        raise HTTPException(status_code=400, detail="შეუძლებელია")
    await db.users.update_one({"id": user_id}, {"$set": {"blocked": data.blocked}})
    return {"status": "დაბლოკილია" if data.blocked else "განბლოკილია"}

@api_router.post("/admin/companies/{company_id}/verify")
async def admin_verify_company(company_id: str, data: VerifyInput, admin: dict = Depends(require_admin)):
    res = await db.companies.update_one({"id": company_id}, {"$set": {"verified": data.verified}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="ვერ მოიძებნა")
    return {"status": "verified" if data.verified else "unverified"}

@api_router.delete("/admin/chats/{company_id}/{visitor_id}")
async def admin_delete_chat(company_id: str, visitor_id: str, admin: dict = Depends(require_admin)):
    await db.messages.delete_many({"company_id": company_id, "visitor_id": visitor_id})
    return {"status": "ჩატი წაიშალა"}

@api_router.post("/admin/seen")
async def admin_mark_seen(admin: dict = Depends(require_admin)):
    await db.users.update_many({"seen_by_admin": {"$ne": True}}, {"$set": {"seen_by_admin": True}})
    return {"status": "ok"}

app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("id", unique=True)
        await db.companies.create_index("id", unique=True)
        await db.companies.create_index("owner_id")
        await db.companies.create_index("country")
        await db.messages.create_index("company_id")
        await db.messages.create_index("visitor_id")
        await db.company_views.create_index([("company_id", 1), ("viewer", 1)], unique=True)
    except Exception as e:
        logger.error(f"Index creation failed: {e}")
    try:
        admin_email = os.environ["ADMIN_EMAIL"].lower()
        admin_password = os.environ["ADMIN_PASSWORD"]
        existing = await db.users.find_one({"email": admin_email})
        if existing is None:
            await db.users.insert_one({
                "id": str(uuid.uuid4()), "email": admin_email, "name": "Admin",
                "phone": "", "role": "admin", "avatar_url": "", "email_verified": True,
                "blocked": False, "seen_by_admin": True,
                "password_hash": hash_password(admin_password),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        else:
            updates = {"role": "admin", "email_verified": True}
            if not verify_password(admin_password, existing["password_hash"]):
                updates["password_hash"] = hash_password(admin_password)
            await db.users.update_one({"email": admin_email}, {"$set": updates})
    except Exception as e:
        logger.error(f"Admin seed failed: {e}")
    try:
        init_storage()
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
