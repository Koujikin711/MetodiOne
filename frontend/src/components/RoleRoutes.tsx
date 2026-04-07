import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import { CrmPage } from "@/pages/CrmPage";

function isManagerNavRole(role: ReturnType<typeof decodeRoleFromToken>) {
  return role === "manager" || role === "admin";
}

export function HomeEntry() {
  if (isManagerNavRole(decodeRoleFromToken(getStoredToken()))) {
    return <Navigate to="/my-leads" replace />;
  }
  return <CrmPage />;
}

export function RequireNotManager({ children }: { children: ReactNode }) {
  if (isManagerNavRole(decodeRoleFromToken(getStoredToken()))) {
    return <Navigate to="/my-leads" replace />;
  }
  return <>{children}</>;
}

export function RequireOwner({ children }: { children: ReactNode }) {
  if (decodeRoleFromToken(getStoredToken()) !== "owner") {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
