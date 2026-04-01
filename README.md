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

В панели задайте переменные из `backend/.env.example`: `DATABASE_URL` (PostgreSQL Amvera), `SECRET_KEY`, `CORS_ORIGINS` (URL вашего фронта).
Если оставить SQLite внутри контейнера, после пересборки/деплоя данные обнулятся.

## Vercel (фронт)

Репозиторий — монорепо: в корне **`vercel.json`** — сборка из **`frontend/`**, выход **`frontend/dist`**, SPA-роутинг на `index.html`.

В **Project → Settings → Environment Variables** добавьте **`VITE_API_BASE_URL`** = публичный URL API (Amvera), **без** слэша в конце, например `https://xxx.amvera.app`. После изменения переменных сделайте **Redeploy**.

В `CORS_ORIGINS` на бэкенде перечислите домены Vercel и свой домен (например `https://metodi-one.vercel.app`, `https://www.metodione.com`).

## Локально

- БД: `docker compose up -d`
- API: `cd backend && python -m uvicorn app.main:app --reload --port 8000`
- UI: `cd frontend && npm install && npm run dev`
