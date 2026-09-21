/** Клиентские хелперы ролей Куратор / Администратор / Бухгалтер. */

import type { UserRole } from "@/lib/types";

export function roleLabelRu(role: UserRole | string | null | undefined): string {
  switch (role) {
    case "owner":
      return "Владелец";
    case "manager":
      return "Менеджер";
    case "expert":
      return "Эксперт";
    case "admin":
      return "Админ воронки";
    case "administrator":
      return "Администратор";
    case "curator":
      return "Куратор";
    case "accountant":
      return "Бухгалтер";
    case "finance_analyst":
      return "Фин. аналитик";
    case "super_owner":
      return "Супер-владелец";
    case "rop":
      return "РОП";
    default:
      return role || "—";
  }
}

export function isAdministrator(role: UserRole | null): boolean {
  return role === "administrator";
}

export function isCurator(role: UserRole | null): boolean {
  return role === "curator";
}

export function isAccountant(role: UserRole | null): boolean {
  return role === "accountant";
}

export function isRop(role: UserRole | null): boolean {
  return role === "rop";
}

export function canAccessRop(role: UserRole | null): boolean {
  return role === "rop" || role === "owner" || role === "super_owner";
}

export function canAccessCuratorJournal(role: UserRole | null): boolean {
  return (
    role === "owner" ||
    role === "super_owner" ||
    role === "admin" ||
    role === "administrator" ||
    role === "curator"
  );
}
