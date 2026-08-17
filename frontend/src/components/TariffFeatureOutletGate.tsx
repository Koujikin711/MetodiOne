import { useLocation, Outlet } from "react-router-dom";

const FILL_ROUTE_PREFIXES = [
  "/chat",
  "/crm",
  "/sales",
  "/messenger",
  "/tasks",
  "/analytics",
  "/employees",
  "/audit",
  "/integrations",
  "/finance",
] as const;

function isFillRoute(pathname: string) {
  return FILL_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Тарифные ограничения маршрутов отключены. Единый soft-fade при смене экрана. */
export function TariffFeatureOutletGate() {
  const location = useLocation();
  const fill = isFillRoute(location.pathname);
  return (
    <div
      key={fill ? "mo-fill-shell" : location.pathname}
      className={[
        "flex min-h-0 flex-1 flex-col [&_.crm-page]:flex-1 [&_.sales-desk-page]:flex-1",
        fill ? "" : "mo-page-enter",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Outlet />
    </div>
  );
}
