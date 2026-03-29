import { Navigate, Outlet, useLocation } from "react-router-dom";

import { getStoredToken } from "@/lib/api";

export function ProtectedRoute() {
  const location = useLocation();
  const token = getStoredToken();
  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
