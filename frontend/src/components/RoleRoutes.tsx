import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";

import { AccessDenied } from "@/components/AccessDenied";
import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import { useCurrentUserMe } from "@/hooks/useCurrentUserMe";
import type { Pipeline } from "@/lib/types";
import { CrmPage } from "@/pages/CrmPage";
import { OnlineBookingPage } from "@/pages/OnlineBookingPage";

function isManagerNavRole(role: ReturnType<typeof decodeRoleFromToken>) {
  return role === "manager" || role === "admin";
}

function ManagerNavHomeEntry({ role }: { role: "manager" | "admin" }) {
  const pipelinesQuery = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => apiFetch<Pipeline[]>("/api/pipelines"),
  });

  if (role === "admin") {
    return <Navigate to="/crm" replace />;
  }

  if (pipelinesQuery.isLoading) {
    return <p className="px-4 py-10 text-sm lux-caption">Загрузка…</p>;
  }

  if (pipelinesQuery.isError) {
    return <Navigate to="/my-leads" replace />;
  }

  const count = pipelinesQuery.data?.length ?? 0;
  if (count > 0) {
    return <Navigate to="/crm" replace />;
  }
  return <Navigate to="/my-leads" replace />;
}

function isChiefExpertFromMe(role: ReturnType<typeof decodeRoleFromToken>, isChiefExpert?: boolean) {
  return role === "expert" && Boolean(isChiefExpert);
}

export function HomeEntry() {
  const token = getStoredToken();
  const role = decodeRoleFromToken(token);
  const meQuery = useCurrentUserMe();
  const salesSpace =
    meQuery.data?.crm_mode === "sales" || Boolean(meQuery.data?.desk_sales_enabled);
  const chatStages = meQuery.data?.chat_stages_enabled !== false;

  if (role === "super_owner") {
    return <Navigate to="/companies" replace />;
  }
  if (role === "accountant" || role === "finance_analyst") {
    return <Navigate to="/finance" replace />;
  }
  // Менеджер/админ: стадии только из чата (и clinic admin/admin, и sales).
  if (chatStages && (role === "manager" || role === "admin")) {
    return <Navigate to="/chat" replace />;
  }
  // Второе пространство: владелец сразу в продажи / калькуляцию, не в канбан клиники
  if (salesSpace) {
    if (role === "owner") {
      return <Navigate to="/sales" replace />;
    }
  }
  if (role === "expert" && meQuery.data?.is_chief_expert) {
    return <Navigate to="/crm" replace />;
  }
  if (role === "manager" || role === "admin") {
    if (role === "manager") {
      return <Navigate to="/desk" replace />;
    }
    return <ManagerNavHomeEntry role={role} />;
  }
  return <CrmPage />;
}

/** В sales-пространстве онлайн-запись отключена — редирект в окно продаж. */
export function BookingOrSalesEntry() {
  const meQuery = useCurrentUserMe();
  const salesSpace =
    meQuery.data?.crm_mode === "sales" || Boolean(meQuery.data?.desk_sales_enabled);
  if (meQuery.isLoading) {
    return <p className="px-4 py-10 text-sm lux-caption">Загрузка…</p>;
  }
  if (salesSpace || meQuery.data?.booking_enabled === false) {
    return <Navigate to="/sales" replace />;
  }
  return <OnlineBookingPage />;
}

export function RequireNotManager({ children }: { children: ReactNode }) {
  if (isManagerNavRole(decodeRoleFromToken(getStoredToken()))) {
    return (
      <AccessDenied message="Этот раздел недоступен для роли менеджера или администратора воронки. Обратитесь к владельцу компании." />
    );
  }
  return <>{children}</>;
}

export function RequireOwner({ children }: { children: ReactNode }) {
  if (decodeRoleFromToken(getStoredToken()) !== "owner") {
    return <AccessDenied message="Раздел доступен только владельцу компании (роль owner)." />;
  }
  return <>{children}</>;
}

export function RequireOwnerOrAdmin({ children }: { children: ReactNode }) {
  const r = decodeRoleFromToken(getStoredToken());
  const meQuery = useCurrentUserMe();
  if (r !== "owner" && r !== "admin" && !isChiefExpertFromMe(r, meQuery.data?.is_chief_expert)) {
    return <AccessDenied message="Раздел доступен владельцу, администратору или главному эксперту воронки." />;
  }
  return <>{children}</>;
}

export function RequireFinance({ children }: { children: ReactNode }) {
  const r = decodeRoleFromToken(getStoredToken());
  const meQuery = useCurrentUserMe();
  if (
    r !== "owner" &&
    r !== "admin" &&
    r !== "super_owner" &&
    r !== "finance_analyst" &&
    r !== "accountant" &&
    !isChiefExpertFromMe(r, meQuery.data?.is_chief_expert)
  ) {
    return (
      <AccessDenied message="Раздел «Финансы» доступен владельцу, администратору, бухгалтеру, финансовому аналитику или главному эксперту воронки." />
    );
  }
  return <>{children}</>;
}

export function RequireSuperOwner({ children }: { children: ReactNode }) {
  if (decodeRoleFromToken(getStoredToken()) !== "super_owner") {
    return <AccessDenied message="Раздел «Компании» доступен только супер-владельцу платформы." />;
  }
  return <>{children}</>;
}
