import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import { CrmPage } from "@/pages/CrmPage";

export function HomeEntry() {
  if (decodeRoleFromToken(getStoredToken()) === "manager") {
    return <Navigate to="/my-leads" replace />;
  }
  return <CrmPage />;
}

export function RequireNotManager({ children }: { children: ReactNode }) {
  if (decodeRoleFromToken(getStoredToken()) === "manager") {
    return <Navigate to="/my-leads" replace />;
  }
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  if (decodeRoleFromToken(getStoredToken()) !== "admin") {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
