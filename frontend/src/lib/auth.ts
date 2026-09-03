import type { UserRole } from "@/lib/types";

function base64UrlToBase64(input: string): string {
  return input.replace(/-/g, "+").replace(/_/g, "/");
}

function parseJwtPayload(token: string | null): Record<string, unknown> | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payloadB64 = base64UrlToBase64(parts[1]);
    const padded = payloadB64.padEnd(payloadB64.length + (4 - (payloadB64.length % 4)) % 4, "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function decodeRoleFromToken(token: string | null): UserRole | null {
  const payload = parseJwtPayload(token);
  if (!payload) return null;
  const role = payload.role;
  if (
    role === "super_owner" ||
    role === "owner" ||
    role === "admin" ||
    role === "administrator" ||
    role === "manager" ||
    role === "expert" ||
    role === "curator" ||
    role === "finance_analyst" ||
    role === "accountant"
  )
    return role;
  return null;
}

/** В JWT выставлено `must_change_password` — нужна смена пароля до остальных API. */
export function decodeMustChangePasswordFromToken(token: string | null): boolean {
  return parseJwtPayload(token)?.must_change_password === true;
}

/** ID super_owner, от имени которого выдан токен (режим поддержки). */
export function decodeImpersonatorFromToken(token: string | null): number | null {
  const raw = parseJwtPayload(token)?.impersonated_by;
  if (raw === undefined || raw === null) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** JWT subject — id пользователя (число). */
/** Для super_owner: компания из JWT после «Войти в компанию». */
export function decodeCompanyIdFromToken(token: string | null): number | null {
  const payload = parseJwtPayload(token);
  if (!payload) return null;
  const cid = payload.company_id;
  if (cid === undefined || cid === null) return null;
  const id = Number(cid);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function decodeUserIdFromToken(token: string | null): number | null {
  const payload = parseJwtPayload(token);
  if (!payload) return null;
  const sub = payload.sub;
  if (sub === undefined || sub === null) return null;
  const id = Number(sub);
  return Number.isFinite(id) ? id : null;
}

export function decodeDisplayNameFromToken(token: string | null): string | null {
  const payload = parseJwtPayload(token);
  if (!payload) return null;
  const fullName = typeof payload.full_name === "string" ? payload.full_name.trim() : "";
  if (fullName) return fullName;
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (name) return name;
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  if (email) return email;
  return null;
}
