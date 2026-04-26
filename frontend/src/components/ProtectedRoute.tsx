import { Navigate, Outlet, useLocation } from "react-router-dom";

import { getStoredToken } from "@/lib/api";
import { decodeMustChangePasswordFromToken } from "@/lib/auth";

export function ProtectedRoute() {
  const location = useLocation();
  const token = getStoredToken();
  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  const mustChange = decodeMustChangePasswordFromToken(token);
  if (mustChange && location.pathname !== "/force-password") {
    return <Navigate to="/force-password" replace />;
  }
  if (!mustChange && location.pathname === "/force-password") {
    return <Navigate to="/app" replace />;
  }
  return <Outlet />;
}
