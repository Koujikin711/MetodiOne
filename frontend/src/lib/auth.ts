import type { UserRole } from "@/lib/types";

function base64UrlToBase64(input: string): string {
  return input.replace(/-/g, "+").replace(/_/g, "/");
}

export function decodeRoleFromToken(token: string | null): UserRole | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payloadB64 = base64UrlToBase64(parts[1]);
    const padded = payloadB64.padEnd(payloadB64.length + (4 - (payloadB64.length % 4)) % 4, "=");
    const json = atob(padded);
    const payload = JSON.parse(json) as { role?: unknown };
    const role = payload.role;
    if (
      role === "super_owner" ||
      role === "owner" ||
      role === "admin" ||
      role === "manager" ||
      role === "expert" ||
      role === "finance_analyst"
    )
      return role;
    return null;
  } catch {
    return null;
  }
}

/** JWT subject — id пользователя (число). */
/** Для super_owner: компания из JWT после «Войти в компанию». */
export function decodeCompanyIdFromToken(token: string | null): number | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payloadB64 = base64UrlToBase64(parts[1]);
    const padded = payloadB64.padEnd(payloadB64.length + (4 - (payloadB64.length % 4)) % 4, "=");
    const json = atob(padded);
    const payload = JSON.parse(json) as { company_id?: unknown };
    const cid = payload.company_id;
    if (cid === undefined || cid === null) return null;
    const id = Number(cid);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function decodeUserIdFromToken(token: string | null): number | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payloadB64 = base64UrlToBase64(parts[1]);
    const padded = payloadB64.padEnd(payloadB64.length + (4 - (payloadB64.length % 4)) % 4, "=");
    const json = atob(padded);
    const payload = JSON.parse(json) as { sub?: unknown };
    const sub = payload.sub;
    if (sub === undefined || sub === null) return null;
    const id = Number(sub);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}
