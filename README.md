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

В корне есть **Dockerfile**: собирает только `backend/`, старт `uvicorn` на порту **8000**.

В панели Amvera задайте переменные окружения (см. `backend/.env.example`), в том числе `DATABASE_URL` на управляемый PostgreSQL Amvera и `CORS_ORIGINS` с URL фронтенда.

## Локально

- БД: `docker compose up -d`
- API: `cd backend && python -m uvicorn app.main:app --reload --port 8000`
- UI: `cd frontend && npm install && npm run dev`
