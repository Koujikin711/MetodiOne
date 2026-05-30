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
                  ? "border-[#d4af37] bg-[#f7f2e8] text-[#2c2520] shadow-[var(--mo-shadow-luxury)]"
                  : "border-[var(--mo-border)] bg-white/90 mo-muted hover:border-[#d4af37]/50 hover:text-[var(--mo-text)]",
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
