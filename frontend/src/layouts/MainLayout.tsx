import { LogOut } from "@/components/icons";
import { AppBanners } from "@/components/AppBanners";
import { TaskDueBanner } from "@/components/TaskDueBanner";
import { ShellSidebarNav } from "@/components/ShellSidebarNav";
import { TariffFeatureOutletGate } from "@/components/TariffFeatureOutletGate";
import { GradientIconBox } from "@/components/GradientIconBox";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import metodiMarkUrl from "@/assets/metodione-mark.svg?url";
import { getStoredToken, setStoredToken } from "@/lib/api";
import { decodeRoleFromToken, decodeUserIdFromToken } from "@/lib/auth";
import { useTariffNavAccess } from "@/hooks/useTariffNavAccess";
import { useCurrentUserMe } from "@/hooks/useCurrentUserMe";
import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";
import { useShellSidebarExpanded } from "@/hooks/useShellSidebarExpanded";
import {
  leadIdFromPath,
  readJournalSection,
  readLeadReturn,
  rememberLeadReturn,
  restoreLeadPlace,
} from "@/lib/leadReturn";

function MetodiBrandMark({ className = "" }: { className?: string }) {
  return (
    <img
      src={metodiMarkUrl}
      alt=""
      className={["shell-sidebar-brand-mark", className].filter(Boolean).join(" ")}
      decoding="async"
    />
  );
}

export function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const role = decodeRoleFromToken(getStoredToken());
  const userId = decodeUserIdFromToken(getStoredToken());
  const isSuperOwner = role === "super_owner";
  const isManagerNav = role === "manager" || role === "admin";
  const isAdministrator = role === "administrator";
  const isCurator = role === "curator";
  const isAccountant = role === "accountant";
  const isRop = role === "rop";
  const isExpert = role === "expert";
  const meQuery = useCurrentUserMe();
  const alsoCurator = isExpert && Boolean(meQuery.data?.also_curator);
  const alsoExpert =
    (role === "admin" || role === "administrator" || role === "expert") &&
    Boolean(meQuery.data?.also_expert);
  const isChiefExpert = Boolean(meQuery.data?.is_chief_expert);
  const isExpertElevated = isExpert && isChiefExpert;
  const isManagerLikeNav = isManagerNav || isExpertElevated;
  const showFinance =
    role === "owner" ||
    role === "admin" ||
    role === "super_owner" ||
    role === "finance_analyst" ||
    isChiefExpert;
  const showExpenses =
    role === "owner" ||
    role === "super_owner" ||
    role === "accountant" ||
    role === "admin";
  const showMarketing =
    role === "owner" || role === "super_owner" || role === "admin";
  const showIntegrationsHub = role === "owner" || isChiefExpert;
  const showKpi =
    role === "owner" ||
    role === "super_owner" ||
    role === "manager" ||
    role === "admin" ||
    role === "accountant" ||
    role === "curator";
  const crmMode = meQuery.data?.crm_mode;
  const salesSpace = crmMode === "sales" || Boolean(meQuery.data?.desk_sales_enabled);
  const chatStagesEnabled = meQuery.data?.chat_stages_enabled !== false;
  // Онлайн-запись только в clinic; в sales скрыта (booking_enabled=false).
  const bookingEnabled = meQuery.isSuccess && meQuery.data?.booking_enabled !== false;
  const deskSalesEnabled = salesSpace;
  const showExtraServices =
    role === "owner" || role === "admin" || role === "administrator" || role === "accountant";
  const managerChatFirst = chatStagesEnabled && isManagerLikeNav;
  const { showNavForFeature } = useTariffNavAccess();
  const { expanded: sidebarExpanded, toggle: toggleSidebar } = useShellSidebarExpanded();
  const [phoneLayout, setPhoneLayout] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const apply = () => setPhoneLayout(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const menuExpanded = sidebarExpanded && !phoneLayout;
  usePresenceHeartbeat();
  const sidebarOrderScope = useMemo(
    () => `${role ?? "guest"}:${userId ?? "0"}:${crmMode ?? "pending"}`,
    [role, userId, crmMode],
  );

  function logout() {
    setStoredToken(null);
    navigate("/login", { replace: true });
    window.location.assign("/login");
  }

  const mainRef = useRef<HTMLElement | null>(null);
  const prevFullPath = useRef<string | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      let pathname = "";
      try {
        pathname = new URL(anchor.href, window.location.origin).pathname;
      } catch {
        return;
      }
      const openedLeadId = leadIdFromPath(pathname);
      if (openedLeadId == null) return;
      rememberLeadReturn({
        path: `${location.pathname}${location.search}`,
        scroll: mainRef.current?.scrollTop ?? 0,
        leadId: openedLeadId,
        journalSection: readJournalSection(),
      });
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [location.pathname, location.search]);

  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const full = `${location.pathname}${location.search}`;
    const prev = prevFullPath.current;
    prevFullPath.current = full;
    if (prev == null) {
      main.scrollTo({ top: 0, left: 0, behavior: "auto" });
      return;
    }

    const openedLeadId = leadIdFromPath(location.pathname);
    const prevPathname = prev.split("?")[0] ?? prev;
    const closedLeadId = leadIdFromPath(prevPathname);

    if (openedLeadId != null && closedLeadId == null) {
      rememberLeadReturn({
        path: prev,
        scroll: main.scrollTop,
        leadId: openedLeadId,
        journalSection: readJournalSection(),
      });
      main.scrollTo({ top: 0, left: 0, behavior: "auto" });
      return;
    }

    const spot = readLeadReturn();
    if (closedLeadId != null && spot && spot.path === full && spot.leadId === closedLeadId) {
      restoreLeadPlace(main, spot);
      return;
    }

    if (prevPathname !== location.pathname) {
      main.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, [location.pathname, location.search]);

  return (
    <div className="relative h-screen overflow-hidden app-shell-bg">

      <div className="relative z-10 flex h-screen min-h-0 flex-row">
        <aside
          className={[
            "shell-sidebar print:hidden flex min-h-0 shrink-0 flex-col py-1 sticky top-0 h-dvh max-h-dvh",
            menuExpanded ? "is-expanded" : "is-collapsed",
          ].join(" ")}
        >
          <div className="shell-sidebar-header shrink-0">
            <button
              type="button"
              onClick={() => {
                if (!phoneLayout) toggleSidebar();
              }}
              className="shell-sidebar-brand"
              aria-label={phoneLayout ? "MetodiOne" : menuExpanded ? "Свернуть меню" : "Развернуть меню"}
            >
              <MetodiBrandMark />
              <span className="shell-sidebar-brand-text">MetodiOne</span>
            </button>
          </div>
          <nav className="shell-sidebar-nav no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto py-0">
            <ShellSidebarNav
              expanded={menuExpanded}
              scope={sidebarOrderScope}
              isSuperOwner={isSuperOwner}
              isManagerNav={isManagerNav}
              isExpert={isExpert}
              isChiefExpert={isChiefExpert}
              isAdministrator={isAdministrator}
              isCurator={isCurator}
              alsoCurator={alsoCurator}
              alsoExpert={alsoExpert}
              isAccountant={isAccountant}
              isRop={isRop}
              showFinance={showFinance}
              showExpenses={showExpenses}
              showMarketing={showMarketing}
              showIntegrationsHub={showIntegrationsHub}
              showKpi={showKpi}
              bookingEnabled={bookingEnabled}
              deskSalesEnabled={deskSalesEnabled}
              chatStagesEnabled={chatStagesEnabled}
              showExtraServices={showExtraServices}
              showCuratorJournal={role === "admin"}
              hideEmployees={role === "manager"}
              showNavForFeature={showNavForFeature}
            />
          </nav>
          <div className="shell-sidebar-footer shrink-0">
            <button
              type="button"
              className="shell-sidebar-logout"
              onClick={logout}
            >
              <GradientIconBox variant="pink" className="shell-nav-icon-box">
                <LogOut className="shell-nav-icon-glyph" />
              </GradientIconBox>
              {menuExpanded ? (
                <span className="shell-nav-text">Выход</span>
              ) : (
                <span className="shell-nav-label">Выход</span>
              )}
            </button>
          </div>
        </aside>

        <main
          ref={mainRef}
          className={[
            "shell-main relative min-h-0 min-w-0 flex-1 overflow-y-auto text-[var(--mo-text)] sm:px-10 sm:py-10 sm:pb-10 lg:flex lg:flex-col lg:px-14",
            deskSalesEnabled || managerChatFirst ? "px-2.5 py-1.5 sm:py-2.5" : "px-3 pt-1.5 pb-3 sm:py-4",
            location.pathname.startsWith("/chat")
              ? [
                  "max-lg:!px-0 max-lg:!pt-0 max-lg:!pb-0 max-lg:overflow-hidden",
                  "max-lg:flex max-lg:h-[100dvh] max-lg:max-h-[100dvh] max-lg:flex-col max-lg:transition-none",
                ].join(" ")
              : "",
            location.pathname.startsWith("/my-leads") || location.pathname.startsWith("/leads/")
              ? "max-lg:!px-0 max-lg:!pt-1 max-lg:overflow-x-hidden"
              : "",
            location.pathname.startsWith("/chat") ||
            location.pathname.startsWith("/crm") ||
            (location.pathname === "/sales" || location.pathname.startsWith("/sales/")) ||
            location.pathname.startsWith("/messenger") ||
            location.pathname.startsWith("/tasks") ||
            location.pathname.startsWith("/analytics") ||
            location.pathname.startsWith("/employees") ||
            location.pathname.startsWith("/audit") ||
            location.pathname.startsWith("/integrations") ||
            location.pathname.startsWith("/finance") ||
            location.pathname.startsWith("/extra-services")
              ? [
                  "max-lg:overflow-hidden max-lg:flex max-lg:flex-col max-lg:min-h-0 sm:flex sm:flex-col sm:overflow-hidden sm:!py-4 sm:!pb-4 lg:overflow-hidden lg:py-4 lg:pb-4",
                  location.pathname.startsWith("/chat") || location.pathname.startsWith("/messenger")
                    ? "lg:px-6"
                    : location.pathname.startsWith("/crm")
                      ? "sm:!px-6 lg:!px-8 sm:!py-2 sm:!pb-2 lg:!py-2 lg:!pb-2 max-lg:!h-[100dvh] max-lg:!max-h-[100dvh] max-lg:!px-3"
                      : (location.pathname === "/sales" || location.pathname.startsWith("/sales/"))
                        ? "sm:!px-3 lg:!px-4 sm:!py-2 sm:!pb-2 lg:!py-2 lg:!pb-2"
                        : "",
                ]
                  .filter(Boolean)
                  .join(" ")
              : "",
          ].join(" ")}
        >
          <div className="shell-tools relative z-40 flex shrink-0 items-center justify-end gap-2 print:hidden">
            <TaskDueBanner />
          </div>
          <AppBanners />
          <div
            className={
              location.pathname.startsWith("/chat") ||
              location.pathname.startsWith("/crm") ||
              (location.pathname === "/sales" || location.pathname.startsWith("/sales/")) ||
              location.pathname.startsWith("/messenger") ||
              location.pathname.startsWith("/tasks") ||
              location.pathname.startsWith("/analytics") ||
              location.pathname.startsWith("/employees") ||
              location.pathname.startsWith("/audit") ||
              location.pathname.startsWith("/integrations") ||
              location.pathname.startsWith("/finance") ||
              location.pathname.startsWith("/extra-services")
                ? [
                    "flex min-h-0 flex-1 flex-col",
                    location.pathname.startsWith("/chat") ? "max-lg:h-full max-lg:min-h-0" : "",
                    location.pathname.startsWith("/crm") || location.pathname.startsWith("/extra-services")
                      ? "min-h-0 flex-1 overflow-hidden [&>*]:min-h-0 [&>*]:flex-1"
                      : "",
                    (location.pathname === "/sales" || location.pathname.startsWith("/sales/")) ? "min-h-0 flex-1 [&>*]:min-h-0 [&>*]:flex-1" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")
                : undefined
            }
          >
            <TariffFeatureOutletGate />
          </div>
        </main>

      </div>
    </div>
  );
}
