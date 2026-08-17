import { Outlet } from "react-router-dom";

/** Тарифные ограничения маршрутов отключены. */
export function TariffFeatureOutletGate() {
  return (
    <div className="flex min-h-0 flex-1 flex-col [&_.crm-page]:flex-1">
      <Outlet />
    </div>
  );
}
