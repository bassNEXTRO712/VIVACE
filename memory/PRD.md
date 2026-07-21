# VIVACE — ტურისტული კომპანიების პლატფორმა (PRD)

## Original Problem
Company Profile Platform migrated from localStorage to FastAPI + MongoDB + Object Storage, evolved into VIVACE: a tourism directory where companies publish profiles and users discover & chat with them. Georgian UI, dark theme (#0a0a20/#16162a) + orange (#f97316).

## Architecture
- Frontend: React (CRA), Tailwind, shadcn/ui, axios, country-state-city, react-router.
- Backend: FastAPI, JWT + bcrypt, Motor (MongoDB). All routes under /api.
- Storage: Emergent Object Storage (logos, covers, gallery, avatars) served via /api/files/{path}.
- Email: Resend (Emergent managed) for verification / password reset / account deletion / contact-change codes.

## Personas
- Company (role=company): manages profile, gallery, messages inbox, reviews received.
- Regular user (role=user): browses, chats, reviews, comments on photos.
- Admin (role=admin, hidden): manages/deletes any user or company.

## Implemented (as of 2026-07)
- Auth: register (role user/company), login, JWT, bcrypt. Email verification GATE at registration.
- Password reset via emailed code. Change email/phone via code. Account self-deletion via code.
- Company profile: name, phone, address, country, multi-country service cities, logo, cover, description.
- Media gallery: photo/video upload (preview + progress), delete.
- Chat: visitor<->company polling chat; unread badges + browser notifications; notification bell.
- Directory: Home shows 3 featured countries (Italy/Germany/Georgia) + search over all countries/cities; /country/:country listing; company public profile with reviews (5-star), profile stats (views/rating), photo comments.
- Admin panel (/admin): stats, list + delete users/companies. Seeded from ADMIN_EMAIL/ADMIN_PASSWORD env.
- Stats counters on Home (companies/users/countries) reflect real registrations.

## Testing
- iteration_1..5.json all pass. Backend 89/89 pytest. Frontend flows verified.
- Pre-verified test accounts + admin documented in /app/memory/test_credentials.md.

## Backlog / Next
- P1: Real SMS (Twilio) for phone verification.
- P1: Company "verified" badge for trust/conversion.
- P2: Advanced filters (price, service type) in listings; review sort.
- P2: Split server.py into routers package; dedup view counting; orphan cleanup (photo_comments) on deletion.
- P2: Typing indicator + message timestamps in chat.
