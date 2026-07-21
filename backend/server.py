from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
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
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

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
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120,
    )
    resp.raise_for_status()
    return resp.json()

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
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="სესიის ვადა ამოიწურა")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="არასწორი ტოკენი")

# ---------------------------------------------------------------------------
# Email helper
# ---------------------------------------------------------------------------
async def send_verification_email(recipient: str, code: str, purpose: str):
    subject = "დადასტურების კოდი"
    html = f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a20;padding:32px;font-family:Arial,sans-serif;">
      <tr><td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#16162a;border-radius:12px;padding:32px;">
          <tr><td style="color:#ffffff;font-size:20px;font-weight:bold;padding-bottom:16px;">დადასტურების კოდი</td></tr>
          <tr><td style="color:#cbd5e1;font-size:14px;padding-bottom:24px;">{purpose}</td></tr>
          <tr><td align="center" style="background:#f97316;border-radius:8px;padding:16px;color:#ffffff;font-size:32px;font-weight:bold;letter-spacing:8px;">{code}</td></tr>
          <tr><td style="color:#94a3b8;font-size:12px;padding-top:24px;">კოდი მოქმედია 10 წუთის განმავლობაში.</td></tr>
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

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class RegisterInput(BaseModel):
    name: str
    email: EmailStr
    password: str

class LoginInput(BaseModel):
    email: EmailStr
    password: str

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

def public_company(doc: dict) -> dict:
    doc.pop("_id", None)
    doc.pop("owner_id", None)
    return doc

# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------
@api_router.post("/auth/register")
async def register(data: RegisterInput):
    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="ეს მეილი უკვე რეგისტრირებულია")
    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    await db.users.insert_one({
        "id": user_id, "email": email, "name": data.name,
        "phone": "", "role": "company",
        "password_hash": hash_password(data.password), "created_at": now,
    })
    company_id = str(uuid.uuid4())
    await db.companies.insert_one({
        "id": company_id, "owner_id": user_id, "name": data.name, "email": email,
        "phone": "", "address": "", "country": "", "service_cities": [],
        "description": "", "logo_url": "", "cover_url": "",
        "media": [], "created_at": now, "updated_at": now,
    })
    token = create_access_token(user_id, email)
    return {"token": token, "user": {"id": user_id, "email": email, "name": data.name, "phone": "", "company_id": company_id}}

@api_router.post("/auth/login")
async def login(data: LoginInput):
    email = data.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="არასწორი მეილი ან პაროლი")
    company = await db.companies.find_one({"owner_id": user["id"]}, {"_id": 0})
    token = create_access_token(user["id"], email)
    return {"token": token, "user": {"id": user["id"], "email": email, "name": user["name"],
            "phone": user.get("phone", ""), "company_id": company["id"] if company else None}}

@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"owner_id": user["id"]}, {"_id": 0})
    return {"id": user["id"], "email": user["email"], "name": user["name"],
            "phone": user.get("phone", ""), "company_id": company["id"] if company else None}

# ---------------------------------------------------------------------------
# Company profile endpoints
# ---------------------------------------------------------------------------
@api_router.get("/company/me")
async def get_my_company(user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"owner_id": user["id"]}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="პროფილი ვერ მოიძებნა")
    return company

@api_router.get("/company/{company_id}")
async def get_company(company_id: str):
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="პროფილი ვერ მოიძებნა")
    return public_company(company)

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

# ---------------------------------------------------------------------------
# App wiring
# ---------------------------------------------------------------------------
@api_router.get("/")
async def root():
    return {"message": "Company Profile API"}

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
    except Exception as e:
        logger.error(f"Index creation failed: {e}")
    try:
        init_storage()
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
