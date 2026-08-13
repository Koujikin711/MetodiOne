const TOKEN_KEY = "crm_access_token";
const ACTIVE_COMPANY_ID_KEY = "crm_active_company_id";

const REQUEST_TIMEOUT_MS = 20_000;
const MUTATION_REQUEST_TIMEOUT_MS = 45_000;
/** Загрузка файлов/голоса (конвертация + Green) может занять дольше обычного JSON. */
const FORM_DATA_REQUEST_TIMEOUT_MS = 120_000;

export type ApiFetchInit = RequestInit & {
  /** Переопределить таймаут (мс). */
  timeoutMs?: number;
};

/** Публичный base URL API (Amvera) — для WebSocket, webhook-подсказок, SSR. */
export function resolveExternalApiBase(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
  if (raw) return raw.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function resolveApiUrl(path: string): string {
  // В браузере всегда same-origin /api — Vercel/nginx/vite проксируют на бэкенд.
  // Так нет cross-origin, CORS и блокировок прямого доступа к Amvera.
  if (typeof window !== "undefined" && path.startsWith("/")) {
    return path;
  }
  const base = resolveExternalApiBase();
  if (!base) return path;
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

function requestTimeoutMs(init: ApiFetchInit, isFormData: boolean): number {
  if (typeof init.timeoutMs === "number" && init.timeoutMs > 0) return init.timeoutMs;
  if (isFormData) return FORM_DATA_REQUEST_TIMEOUT_MS;
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return MUTATION_REQUEST_TIMEOUT_MS;
  return REQUEST_TIMEOUT_MS;
}

function looksLikeHtmlPayload(text: string, contentType: string | null): boolean {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("json")) return false;
  const trimmed = text.trimStart().toLowerCase();
  return trimmed.startsWith("<!doctype") || trimmed.startsWith("<html");
}

function formatFetchFailure(url: string, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  if (url.startsWith("/")) {
    return `Нет связи с сервером (${detail}). Обновите страницу или проверьте интернет.`;
  }
  return `Нет связи с API (${detail}).`;
}

export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const { timeoutMs: _timeoutOverride, ...fetchInit } = init;
  const headers = new Headers(fetchInit.headers);
  headers.set("Accept", "application/json");
  const token = getStoredToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const companyId = getActiveCompanyId();
  if (companyId != null) headers.set("X-Company-Id", String(companyId));
  const isFormData = typeof FormData !== "undefined" && fetchInit.body instanceof FormData;
  if (fetchInit.body && !headers.has("Content-Type") && !isFormData) {
    headers.set("Content-Type", "application/json");
  }

  const url = resolveApiUrl(path);
  const timeoutMs = requestTimeoutMs(init, isFormData);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  let text = "";
  let data: unknown = null;
  try {
    res = await fetch(url, { ...fetchInit, headers, signal: controller.signal });
    text = await res.text();
    if (text && !looksLikeHtmlPayload(text, res.headers.get("content-type"))) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = null;
      }
    }
  } catch (e: unknown) {
    const aborted =
      (e instanceof DOMException && e.name === "AbortError") ||
      (e instanceof Error && e.name === "AbortError");
    if (aborted) {
      const sec = Math.round(timeoutMs / 1000);
      throw new Error(`Сервер не ответил за ${sec} с. Попробуйте ещё раз.`);
    }
    throw new Error(formatFetchFailure(url, e));
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (text && looksLikeHtmlPayload(text, res.headers.get("content-type"))) {
    throw new Error(
      "Сервер вернул HTML вместо JSON — прокси /api недоступен. Обновите страницу через минуту.",
    );
  }

  if (res.status === 204) return undefined as T;

  if (text && data == null) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      throw new Error(
        res.ok
          ? "Сервер вернул не JSON."
          : `Ошибка сервера (${res.status}).`,
      );
    }
  }

  if (!res.ok) {
    const d = data as { detail?: unknown } | null;
    const detail = d?.detail;
    function formatErrorDetail(err: unknown): string {
      if (typeof err === "string") return err;
      if (Array.isArray(err)) {
        return err.map((x: { msg?: string }) => x.msg).filter(Boolean).join(", ");
      }
      if (err && typeof err === "object") {
        const o = err as Record<string, unknown>;
        if (typeof o.message === "string") return o.message;
      }
      return "";
    }
    const message = formatErrorDetail(detail) || res.statusText;

    if (res.status === 409 && detail && typeof detail === "object") {
      const err = new Error(message || `Запрос не выполнен (${res.status})`) as Error & {
        status?: number;
        detail?: unknown;
      };
      err.status = 409;
      err.detail = detail;
      throw err;
    }

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

    if (res.status === 403 && token && message === "Компания временно приостановлена") {
      setStoredToken(null);
      window.location.assign("/login?session=company_suspended");
      throw new Error("Доступ к компании приостановлен. Войдите снова после возобновления работы.");
    }

    if (
      res.status === 403 &&
      token &&
      typeof message === "string" &&
      message.includes("Требуется смена пароля")
    ) {
      window.location.assign("/force-password");
      throw new Error("Сначала смените пароль.");
    }

    throw new Error(message || `Запрос не выполнен (${res.status})`);
  }
  return data as T;
}

function filenameFromContentDisposition(cd: string | null, fallback: string): string {
  if (!cd) return fallback;
  const quoted = /filename="([^"]+)"/i.exec(cd);
  if (quoted?.[1]) return quoted[1].trim() || fallback;
  const plain = /filename=([^;\s]+)/i.exec(cd);
  if (plain?.[1]) {
    try {
      return decodeURIComponent(plain[1].trim());
    } catch {
      return plain[1].trim() || fallback;
    }
  }
  return fallback;
}

/** Скачивание бинарного/текстового ответа (CSV и т.п.) с теми же заголовками авторизации. */
export async function apiDownloadBlob(
  path: string,
  fallbackFilename: string,
  init: { method?: string; body?: string; timeoutMs?: number } = {},
): Promise<void> {
  const headers = new Headers();
  headers.set("Accept", "text/csv,*/*");
  if (init.body != null) headers.set("Content-Type", "application/json");
  const token = getStoredToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const companyId = getActiveCompanyId();
  if (companyId != null) headers.set("X-Company-Id", String(companyId));

  const controller = new AbortController();
  const timeoutMs = init.timeoutMs ?? Math.max(REQUEST_TIMEOUT_MS, 120_000);
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(resolveApiUrl(path), {
      method: init.method ?? "GET",
      headers,
      body: init.body,
      signal: controller.signal,
    });
  } catch (e: unknown) {
    const aborted =
      (e instanceof DOMException && e.name === "AbortError") ||
      (e instanceof Error && e.name === "AbortError");
    if (aborted) {
      throw new Error("Сервер не ответил вовремя при скачивании файла.");
    }
    throw new Error(formatFetchFailure(resolveApiUrl(path), e));
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (res.status === 401 && token) {
    setStoredToken(null);
    window.location.assign(`/login?session=invalid`);
    throw new Error("Сессия недействительна. Войдите снова.");
  }

  if (!res.ok) {
    const text = await res.text();
    let message = res.statusText;
    if (text) {
      try {
        const d = JSON.parse(text) as { detail?: unknown };
        const detail = d?.detail;
        message =
          typeof detail === "string"
            ? detail
            : Array.isArray(detail)
              ? detail.map((x: { msg?: string }) => x.msg).filter(Boolean).join(", ")
              : message;
      } catch {
        message = text.slice(0, 200);
      }
    }
    if (res.status === 403 && token && typeof message === "string" && message.includes("Требуется смена пароля")) {
      window.location.assign("/force-password");
      throw new Error("Сначала смените пароль.");
    }
    throw new Error(message || `Скачивание не выполнено (${res.status})`);
  }

  const blob = await res.blob();
  const name = filenameFromContentDisposition(res.headers.get("Content-Disposition"), fallbackFilename);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
