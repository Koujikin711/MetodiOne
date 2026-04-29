import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";

import { AccessDenied } from "@/components/AccessDenied";
import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import { useTariffNavAccess } from "@/hooks/useTariffNavAccess";
import type { Pipeline } from "@/lib/types";
import { CrmPage } from "@/pages/CrmPage";

function isManagerNavRole(role: ReturnType<typeof decodeRoleFromToken>) {
  return role === "manager" || role === "admin";
}

function ManagerNavHomeEntry({ role }: { role: "manager" | "admin" }) {
  const { restaurantMode } = useTariffNavAccess();
  const pipelinesQuery = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => apiFetch<Pipeline[]>("/api/pipelines"),
  });

  if (restaurantMode) {
    return <Navigate to="/horeca/orders" replace />;
  }

  if (role === "admin") {
    return <Navigate to="/crm" replace />;
  }

  if (pipelinesQuery.isLoading) {
    return <p className="px-4 py-10 text-sm text-slate-400">Загрузка…</p>;
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

export function HomeEntry() {
  const role = decodeRoleFromToken(getStoredToken());
  const { restaurantMode } = useTariffNavAccess();
  if (role === "super_owner") {
    return <Navigate to="/companies" replace />;
  }
  if (role === "manager" || role === "admin") {
    return <ManagerNavHomeEntry role={role} />;
  }
  if (role === "owner" && restaurantMode) {
    return <Navigate to="/horeca/orders" replace />;
  }
  return <CrmPage />;
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
  if (r !== "owner" && r !== "admin") {
    return <AccessDenied message="Раздел доступен владельцу или администратору компании." />;
  }
  return <>{children}</>;
}

export function RequireSuperOwner({ children }: { children: ReactNode }) {
  if (decodeRoleFromToken(getStoredToken()) !== "super_owner") {
    return <AccessDenied message="Раздел «Компании» доступен только супер-владельцу платформы." />;
  }
  return <>{children}</>;
}

export function RequireFinance({ children }: { children: ReactNode }) {
  const r = decodeRoleFromToken(getStoredToken());
  if (r !== "owner" && r !== "admin" && r !== "super_owner") {
    return (
      <AccessDenied message="Раздел «Финансы» доступен владельцу, администратору и супер-владельцу. Попросите владельца выдать вам роль или открыть отчёты." />
    );
  }
  return <>{children}</>;
}
