import { NavLink, Outlet, useLocation } from "react-router-dom";

import { PageHeader } from "@/components/ui/PageHeader";
import { FINANCE_SUBROUTES } from "@/config/navByRole";
import { theme } from "@/lib/theme";

export function FinanceShell() {
  const location = useLocation();

  return (
    <div className={`${theme.pageBg} pb-10`}>
      <PageHeader
        title="Финансы"
        description="Обзор, учёт, склад и отчётность в отдельных разделах."
      />
      <nav className="mb-6 flex flex-wrap gap-2">
        {FINANCE_SUBROUTES.map((item) => {
          const active =
            item.path === "/finance"
              ? location.pathname === "/finance" || location.pathname === "/finance/"
              : location.pathname.startsWith(item.path);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={[
                "rounded-xl border px-4 py-2 text-sm font-medium transition",
                active
                  ? "border-[#2f5f85] bg-[#e8f0f7] text-[#1e3348]"
                  : "border-[#d8d2c6] bg-white/70 text-[#5c6b7a] hover:border-[#2f5f85]/50 hover:text-[#1e3348]",
              ].join(" ")}
            >
              {item.label}
            </NavLink>
          );
        })}
      </nav>
      <Outlet />
    </div>
  );
}
