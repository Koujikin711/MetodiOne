import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";

import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import type { Pipeline } from "@/lib/types";
import { CrmPage } from "@/pages/CrmPage";

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
  if (role === "super_owner") {
    return <Navigate to="/companies" replace />;
  }
  if (role === "manager" || role === "admin") {
    return <ManagerNavHomeEntry role={role} />;
  }
  return <CrmPage />;
}

export function RequireNotManager({ children }: { children: ReactNode }) {
  if (isManagerNavRole(decodeRoleFromToken(getStoredToken()))) {
    return <Navigate to="/crm" replace />;
  }
  return <>{children}</>;
}

export function RequireOwner({ children }: { children: ReactNode }) {
  if (decodeRoleFromToken(getStoredToken()) !== "owner") {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

export function RequireSuperOwner({ children }: { children: ReactNode }) {
  if (decodeRoleFromToken(getStoredToken()) !== "super_owner") {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
