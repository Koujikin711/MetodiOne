import { Outlet } from "react-router-dom";

/** Тарифные ограничения маршрутов отключены. */
export function TariffFeatureOutletGate() {
  return <Outlet />;
}
