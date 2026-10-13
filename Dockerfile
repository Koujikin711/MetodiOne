FROM python:3.12-slim-bookworm

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Baileys 6.7 требует Node 20+. В bookworm из apt только Node 18.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg ca-certificates curl xz-utils git && \
    curl -fsSL https://nodejs.org/dist/v22.20.0/node-v22.20.0-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1 && \
    rm -rf /var/lib/apt/lists/*

COPY wa_bridge/package.json wa_bridge/package-lock.json /app/wa_bridge/
RUN cd /app/wa_bridge && npm install --omit=dev --no-audit --no-fund

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /app/requirements.txt

COPY backend/ /app/
COPY wa_bridge/index.js /app/wa_bridge/index.js

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
