# Amvera / Docker: FastAPI + собранный frontend (Vite)

FROM node:20-bookworm-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* /frontend/
RUN npm ci
COPY frontend/ /frontend/
RUN npm run build

FROM python:3.12-slim-bookworm AS backend

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /app/requirements.txt

COPY backend/ /app/
COPY --from=frontend-build /frontend/dist /app/static

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
