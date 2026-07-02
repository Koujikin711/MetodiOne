# MetodiOne (CRM MVP)

Монорепозиторий: **FastAPI** (`backend/`), **React + Vite** (`frontend/`), **Docker Compose** для PostgreSQL локально.

## Быстрый push на GitHub

Замените `ВАШ_ЛОГИН` на свой GitHub username.

```bash
cd "путь/к/проекту"
git init
git add .
git commit -m "Initial commit: CRM backend + frontend"
git branch -M main
git remote add origin https://github.com/ВАШ_ЛОГИН/MetodiOne.git
git push -u origin main
```

Если репозиторий уже создан на GitHub с README — используйте `git pull origin main --allow-unrelated-histories`, затем `git push`.

## Amvera (бэкенд)

В корне **Dockerfile** (сборка только `backend/`) и **amvera.yaml** с `containerPort: 8000` — у Amvera по умолчанию ожидается порт 80, без этого маршрутизация к uvicorn не сработает.

В панели задайте переменные из `backend/.env.example`: `DATABASE_URL` (PostgreSQL Amvera), `SECRET_KEY`, `CORS_ORIGINS` (URL вашего фронта), **`PUBLIC_API_BASE_URL`** (публичный URL Amvera — **обязателен для входящих WhatsApp**).
Если оставить SQLite внутри контейнера, после пересборки/деплоя данные обнулятся.

## Vercel (фронт)

Репозиторий — монорепо: в корне **`vercel.json`** — сборка из **`frontend/`**, выход **`frontend/dist`**, SPA-роутинг на `index.html`.

В **Project → Settings → Environment Variables** добавьте **`VITE_API_BASE_URL`** = публичный URL API (Amvera), **без** слэша в конце, например `https://xxx.amvera.app`. После изменения переменных сделайте **Redeploy**.

**Если push в GitHub не обновляет сайт:** откройте Vercel → **Deployments** → **Redeploy** последнего коммита с ветки `main`. Убедитесь, что сборка **Ready** (не Failed). В CSS нельзя писать `@apply mo-muted` — только Tailwind-утилиты или `color: var(--mo-text-muted)`.

**Автодеплой через GitHub Actions (опционально):** Vercel → Project → Settings → **Git** → **Deploy Hooks** → создать hook для `main`. В GitHub → Settings → Secrets → **`VERCEL_DEPLOY_HOOK`** = URL hook. Workflow `.github/workflows/deploy-vercel.yml` после успешной сборки вызовет hook.

В `CORS_ORIGINS` на бэкенде перечислите домены Vercel и свой домен (например `https://metodi-one.vercel.app`, `https://www.metodione.com`).

## Локально

- БД: `docker compose up -d`
- API: `cd backend && python -m uvicorn app.main:app --reload --port 8000`
- UI: `cd frontend && npm install && npm run dev`

## Valuation readiness (для оценки стоимости)

Подготовленные артефакты для инвестора/оценщика находятся в `docs/valuation-readiness`:

- `01-production-metrics.md` — как снимать продакшн baseline (`/health/metrics`)
- `02-case-study-template.md` — шаблон кейсов "до/после"
- `03-implementation-playbook.md` — упакованный процесс внедрения
- `04-support-sla.md` — регламент поддержки и SLA
- `05-qa-and-tests.md` — базовый QA/test контур и DoD

