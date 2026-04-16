const TOKEN_KEY = "crm_access_token";
const ACTIVE_COMPANY_ID_KEY = "crm_active_company_id";

const REQUEST_TIMEOUT_MS = 20_000;
/** Загрузка файлов/голоса (конвертация + Green) может занять дольше обычного JSON. */
const FORM_DATA_REQUEST_TIMEOUT_MS = 120_000;

export function resolveApiUrl(path: string): string {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
  const base = raw.replace(/\/$/, "");
  if (!base) {
    if (import.meta.env.PROD) {
      throw new Error(
        "Не задан VITE_API_BASE_URL. В Vercel → Settings → Environment Variables укажите URL бэкенда Amvera (без / в конце) и сделайте Redeploy.",
      );
    }
    return path;
  }
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ACTIVE_COMPANY_ID_KEY);
  }
}

export function getActiveCompanyId(): number | null {
  const raw = localStorage.getItem(ACTIVE_COMPANY_ID_KEY);
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function setActiveCompanyId(companyId: number | null): void {
  if (companyId == null) localStorage.removeItem(ACTIVE_COMPANY_ID_KEY);
  else localStorage.setItem(ACTIVE_COMPANY_ID_KEY, String(companyId));
}

/** Абсолютный URL для медиа (полный https или путь от API). */
export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return u;
  return resolveApiUrl(u.startsWith("/") ? u : `/${u}`);
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const token = getStoredToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const companyId = getActiveCompanyId();
  if (companyId != null) headers.set("X-Company-Id", String(companyId));
  // Для FormData не ставим Content-Type вручную (fetch сам добавит boundary)
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (init.body && !headers.has("Content-Type") && !isFormData) {
    headers.set("Content-Type", "application/json");
  }

  const timeoutMs = isFormData ? FORM_DATA_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(resolveApiUrl(path), { ...init, headers, signal: controller.signal });
  } catch (e: unknown) {
    const aborted =
      (e instanceof DOMException && e.name === "AbortError") ||
      (e instanceof Error && e.name === "AbortError");
    if (aborted) {
      const sec = Math.round(timeoutMs / 1000);
      throw new Error(
        `Сервер не ответил за ${sec} с. Запустите API: в папке backend выполните python -m uvicorn app.main:app --reload --port 8000 (и поднимите БД или задайте SQLite: DATABASE_URL=sqlite+aiosqlite:///./crm.db).`,
      );
    }
      throw new Error(
        import.meta.env.VITE_API_BASE_URL
          ? "Нет связи с API. Проверьте VITE_API_BASE_URL и доступность бэкенда."
          : "Нет связи с сервером. Убедитесь, что бэкенд слушает http://127.0.0.1:8000 и dev-сервер Vite запущен (прокси /api).",
      );
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      throw new Error(
        res.ok
          ? "Сервер вернул не JSON"
          : `Ошибка сервера (${res.status}). Проверьте, что запущен FastAPI на порту 8000.`,
      );
    }
  }

  if (!res.ok) {
    const d = data as { detail?: unknown } | null;
    const detail = d?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((x: { msg?: string }) => x.msg).filter(Boolean).join(", ")
          : res.statusText;

    if (res.status === 401 && token) {
      const authLost = [
        "Invalid token",
        "Token expired",
        "Not authenticated",
        "User not found",
        "Аккаунт отключён",
      ].includes(message);
      if (authLost) {
        setStoredToken(null);
        const reason = message === "Token expired" ? "expired" : "invalid";
        window.location.assign(`/login?session=${reason}`);
        throw new Error(
          message === "Token expired"
            ? "Сессия истекла. Войдите снова."
            : "Сессия недействительна (другой сервер или сброс ключа). Войдите снова.",
        );
      }
    }

    /** Компания остановлена super_owner — старый JWT ещё валиден, но доступ к данным закрыт. */
    if (res.status === 403 && token && message === "Компания временно приостановлена") {
      setStoredToken(null);
      window.location.assign("/login?session=company_suspended");
      throw new Error("Доступ к компании приостановлен. Войдите снова после возобновления работы.");
    }

    throw new Error(message || `Запрос не выполнен (${res.status})`);
  }
  return data as T;
}
