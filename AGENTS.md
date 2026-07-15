# AGENTS.md — MetodiOne

## Purpose
- **Public face:** MetodiOne Studio — bilingual portfolio of custom operational software (ERP/CRM/automation) with live sandbox demos.
- **Also in repo:** multi-tenant CRM SaaS (pipelines, omnichannel chat, booking) used as a product line + backend.

Live site: https://metodione.com/ (Vercel). Demo hub: `/demos`. Investor brief: `/investors`.

## Stack
Backend: FastAPI, SQLAlchemy async, PostgreSQL.  
Frontend: React 18, Vite, TanStack Query, Tailwind 4 + Studio CSS (`frontend/src/index.css`).

## Run
```bash
docker compose up -d
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000
cd frontend && npm install && npm run dev
```

## Studio landing — critical context
Read `.cursor/rules/studio-landing.mdc` for the full handoff of the Jul 2026 Studio landing work.

Key paths: `frontend/src/pages/LandingPage.tsx`, `DemoHubPage.tsx`, `content/cases.ts`, `content/products.ts`, `i18n/landing.ts`.

## Agent rules
- Monorepo: `backend/` vs `frontend/`; CRM data scoped by `company_id`
- Schema changes in `database_migrate.py`; Russian UI for CRM product
- Seed: `admin@crm.local` / `admin`; `super@crm.local` / `admin`
- Deploy frontend: Vercel — push **both** `main` and `master` after landing changes
- Studio copy: RU/EN parity; anonymized cases; sandbox demos only
- Do not restore the old somoni SaaS pricing homepage

## Recent Studio commits (reference)
- `07ead25` — hero clarity, offer strip, collapsible cases
- `9ff9ffc` — richer case stories + business impact
- `355e4de` — one-click sandbox demos
- `c34d345` — initial Studio portfolio + demo hub
