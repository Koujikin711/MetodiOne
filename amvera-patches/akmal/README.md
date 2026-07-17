# StarMIX (akmal) — passwordless `/demo`

Live host: `https://akmal-koujikin.amvera.io`  
Portfolio name on MetodiOne Studio: **TradeDesk**

## Problem

`GET /demo` currently serves the SPA shell, which redirects unauthenticated visitors to `/login`. Hardcoded UI chips (`director@stroymat.ru` / `director123`, …) only appear when `production=false` and do **not** match the live SQLite users.

## Fix (same pattern as FuelOps / CraftLine / StaffDesk)

1. Add `POST /api/auth/demo-login` that issues a JWT for a sandbox director (create the user if missing).
2. Serve `demo.html` at `GET /demo` **before** the SPA catch-all. The page calls demo-login, writes `localStorage.token`, redirects to `/`.
3. Keep `ALLOW_DEMO_LOGIN=true` (default in the snippet) even when `PRODUCTION=true`, so the landing can stay one-click.

## Deploy on Amvera (`akmal`)

```bash
# from the StarMIX project root linked to Amvera git
cp /path/to/MetodiOne/amvera-patches/akmal/demo.html ./frontend/public/demo.html   # or your static dir
# merge demo_login.py into the auth router + call mount_demo_page(app)
git add -A && git commit -m "feat: passwordless /demo sandbox entry"
git push amvera master
```

After deploy, verify:

```bash
curl -sS https://akmal-koujikin.amvera.io/demo | head
curl -sS -X POST https://akmal-koujikin.amvera.io/api/auth/demo-login -H 'Content-Type: application/json' -d '{}'
```

Studio landing already points TradeDesk at `https://akmal-koujikin.amvera.io/demo` (via `/enter/tradedesk`).
