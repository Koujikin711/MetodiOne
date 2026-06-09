import { useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { PageHeader } from "@/components/ui/PageHeader";
import { FINANCE_SUBROUTES, financeTabsForRole } from "@/config/navByRole";
import { getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import { theme } from "@/lib/theme";

export function FinanceShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const role = decodeRoleFromToken(getStoredToken());
  const tabs = financeTabsForRole(role);

  useEffect(() => {
    if (role === "accountant" && (location.pathname === "/finance" || location.pathname === "/finance/")) {
      navigate("/finance/accountant", { replace: true });
    }
  }, [role, location.pathname, navigate]);

  const allowedPaths = new Set(tabs.map((t) => t.path));
  useEffect(() => {
    const match = FINANCE_SUBROUTES.find((t) =>
      t.path === "/finance"
        ? location.pathname === "/finance" || location.pathname === "/finance/"
        : location.pathname.startsWith(t.path),
    );
    if (match && !allowedPaths.has(match.path)) {
      navigate(tabs[0]?.path ?? "/finance", { replace: true });
    }
  }, [location.pathname, allowedPaths, tabs, navigate]);

  return (
    <div className={`${theme.pageBg} pb-10`}>
      <PageHeader
        title="Финансы"
        description="Обзор, учёт, бухгалтерия, дебиторка и отчётность в одном разделе."
      />
      <nav className="mb-6 flex flex-wrap gap-2">
        {tabs.map((item) => {
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
