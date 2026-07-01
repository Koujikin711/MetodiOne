# Agent: MetodiOne SaaS

# AGENTS.md — MetodiOne

## Purpose
Multi-tenant CRM SaaS: pipelines, omnichannel chat (WhatsApp/Telegram/Instagram), booking, finance, team ops.

## Stack
Backend: FastAPI, SQLAlchemy async, PostgreSQL. Frontend: React 18, Vite, TanStack Query, Tailwind 4.

## Run
```bash
docker compose up -d
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000
cd frontend && npm install && npm run dev
```

## Agent rules
- Monorepo: backend/ vs frontend/; scope by `company_id` (multi-tenant)
- Schema changes in `database_migrate.py`; Russian UI
- Seed: admin@crm.local / admin; super@crm.local / admin
- Deploy: Vercel (frontend) + Amvera (backend Docker)
