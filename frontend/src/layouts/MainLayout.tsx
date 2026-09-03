import {
  BarChart3,
  Calendar,
  Target,
  CheckSquare,
  ClipboardList,
  Funnel,
  LogOut,
  MapPin,
  MessageCircle,
  UserRound,
  Users,
  Wallet,
} from "@/components/icons";
import { AppBanners } from "@/components/AppBanners";
import { ShellSidebarNav } from "@/components/ShellSidebarNav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TariffFeatureOutletGate } from "@/components/TariffFeatureOutletGate";
import { GradientIconBox } from "@/components/GradientIconBox";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import metodiMarkUrl from "@/assets/metodione-mark.svg?url";
import { getStoredToken, setStoredToken } from "@/lib/api";
import { decodeRoleFromToken, decodeUserIdFromToken } from "@/lib/auth";
import { useTariffNavAccess } from "@/hooks/useTariffNavAccess";
import { useCurrentUserMe } from "@/hooks/useCurrentUserMe";
import { useShellSidebarExpanded } from "@/hooks/useShellSidebarExpanded";
import { appLexicon } from "@/lib/appLexicon";

function mobileBottomNavLinkClass({ isActive }: { isActive: boolean }) {
  return [
    "shell-nav-link group flex shrink-0 min-w-[4.25rem] flex-col items-center gap-1 rounded-2xl px-2 py-1.5 text-center",
    isActive ? "is-active" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Компактная нижняя навигация для sales-пространства (всё влезает без горизонтального скролла). */
function salesMobileBottomNavLinkClass({ isActive }: { isActive: boolean }) {
  return [
    "shell-nav-link group flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-0.5 py-1 text-center",
    isActive ? "is-active" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const mobileBottomLogoutClass =
  "group flex shrink-0 min-w-[4.25rem] flex-col items-center gap-1 rounded-2xl px-2 py-1.5 text-center lux-caption transition-[background-color,color,transform] duration-[var(--mo-duration-fast)] ease-[var(--mo-ease)] hover:bg-white/[0.04] hover:text-[var(--mo-text)]";

const salesMobileBottomLogoutClass =
  "group flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-0.5 py-1 text-center lux-caption transition-[background-color,color,transform] duration-[var(--mo-duration-fast)] ease-[var(--mo-ease)] hover:bg-white/[0.04] hover:text-[var(--mo-text)]";
function NavIf({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null;
  return <>{children}</>;
}

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
  const isExpert = role === "expert";
  const meQuery = useCurrentUserMe();
  const isChiefExpert = Boolean(meQuery.data?.is_chief_expert);
  const isExpertElevated = isExpert && isChiefExpert;
  const isManagerLikeNav = isManagerNav || isExpertElevated;
  const showFinance =
    role === "owner" ||
    role === "admin" ||
    role === "administrator" ||
    role === "super_owner" ||
    role === "finance_analyst" ||
    role === "accountant" ||
    isChiefExpert;
  const showExpenses = role === "owner" || role === "super_owner" || role === "accountant" || role === "admin";
  const showIntegrationsHub = role === "owner" || isChiefExpert;
  const showKpi =
    role === "owner" ||
    role === "super_owner" ||
    role === "manager" ||
    role === "admin" ||
    role === "administrator" ||
    role === "curator";
  const crmMode = meQuery.data?.crm_mode;
  const salesSpace = crmMode === "sales" || Boolean(meQuery.data?.desk_sales_enabled);
  const chatStagesEnabled = meQuery.data?.chat_stages_enabled !== false;
  // Онлайн-запись только в clinic; в sales скрыта (booking_enabled=false).
  const bookingEnabled = meQuery.isSuccess && meQuery.data?.booking_enabled !== false;
  const deskSalesEnabled = salesSpace;
  const managerChatFirst = chatStagesEnabled && isManagerLikeNav;
  const { showNavForFeature } = useTariffNavAccess();
  const { expanded: sidebarExpanded, toggle: toggleSidebar } = useShellSidebarExpanded();
  const navLex = appLexicon;
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

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    main.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.pathname]);

  return (
    <div className="relative h-screen overflow-hidden app-shell-bg">

      <div className="relative z-10 flex h-screen min-h-0 flex-col sm:flex-row">
        <aside
          className={[
            "shell-sidebar print:hidden hidden min-h-0 shrink-0 py-2 sm:sticky sm:top-0 sm:flex sm:h-dvh sm:max-h-dvh sm:flex-col",
            sidebarExpanded ? "is-expanded" : "is-collapsed",
          ].join(" ")}
        >
          <div className="shell-sidebar-header">
            <button
              type="button"
              onClick={toggleSidebar}
              className="shell-sidebar-brand"
              title={sidebarExpanded ? "Свернуть меню" : "Развернуть меню"}
              aria-label={sidebarExpanded ? "Свернуть меню" : "Развернуть меню"}
            >
              <MetodiBrandMark />
              <span className="shell-sidebar-brand-text">MetodiOne</span>
            </button>
          </div>
          <nav className="shell-sidebar-nav no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto py-0">
            <ShellSidebarNav
              expanded={sidebarExpanded}
              scope={sidebarOrderScope}
              isSuperOwner={isSuperOwner}
              isManagerNav={isManagerNav}
              isExpert={isExpert}
              isChiefExpert={isChiefExpert}
              isAdministrator={isAdministrator}
              isCurator={isCurator}
              isAccountant={isAccountant}
              showFinance={showFinance}
              showExpenses={showExpenses}
              showIntegrationsHub={showIntegrationsHub}
              showKpi={showKpi}
              bookingEnabled={bookingEnabled}
              deskSalesEnabled={deskSalesEnabled}
              chatStagesEnabled={chatStagesEnabled}
              showNavForFeature={showNavForFeature}
              onLogout={logout}
            />
          </nav>
        </aside>

        <main
          ref={mainRef}
          className={[
            "shell-main relative min-h-0 min-w-0 flex-1 overflow-y-auto text-[var(--mo-text)] sm:px-10 sm:py-10 sm:pb-10 lg:flex lg:flex-col lg:px-14",
            deskSalesEnabled || managerChatFirst
              ? "px-2.5 py-2.5 pb-[calc(4.25rem+env(safe-area-inset-bottom))]"
              : "px-3 py-4 pb-[calc(5.75rem+env(safe-area-inset-bottom))]",
            location.pathname.startsWith("/chat")
              ? [
                  "max-lg:!px-0 max-lg:!pt-0 max-lg:overflow-hidden",
                  deskSalesEnabled || managerChatFirst
                    ? "max-lg:!pb-[calc(4.25rem+env(safe-area-inset-bottom))]"
                    : "max-lg:!pb-[calc(5.75rem+env(safe-area-inset-bottom))]",
                  "max-lg:flex max-lg:h-[100dvh] max-lg:max-h-[100dvh] max-lg:flex-col max-lg:transition-none",
                ].join(" ")
              : "",
            location.pathname.startsWith("/my-leads") || location.pathname.startsWith("/leads/")
              ? "max-lg:!px-0 max-lg:!pt-1 max-lg:overflow-x-hidden"
              : "",
            location.pathname.startsWith("/chat") ||
            location.pathname.startsWith("/crm") ||
            location.pathname.startsWith("/sales") ||
            location.pathname.startsWith("/messenger") ||
            location.pathname.startsWith("/tasks") ||
            location.pathname.startsWith("/analytics") ||
            location.pathname.startsWith("/employees") ||
            location.pathname.startsWith("/audit") ||
            location.pathname.startsWith("/integrations") ||
            location.pathname.startsWith("/finance")
              ? [
                  "max-lg:overflow-hidden max-lg:flex max-lg:flex-col max-lg:min-h-0 sm:flex sm:flex-col sm:overflow-hidden sm:!py-4 sm:!pb-4 lg:overflow-hidden lg:py-4 lg:pb-4",
                  location.pathname.startsWith("/chat") || location.pathname.startsWith("/messenger")
                    ? "lg:px-6"
                    : location.pathname.startsWith("/crm")
                      ? "sm:!px-5 lg:!px-5 sm:!py-2 sm:!pb-2 lg:!py-2 lg:!pb-2 max-lg:!h-[100dvh] max-lg:!max-h-[100dvh]"
                      : location.pathname.startsWith("/sales")
                        ? "sm:!px-3 lg:!px-4 sm:!py-2 sm:!pb-2 lg:!py-2 lg:!pb-2"
                        : "",
                ]
                  .filter(Boolean)
                  .join(" ")
              : "",
          ].join(" ")}
        >
          <div
            className={[
              "pointer-events-none fixed right-3 top-3 z-40 sm:hidden",
              location.pathname.startsWith("/chat") ? "hidden" : "",
            ].join(" ")}
          >
            <div className="pointer-events-auto">
              <ThemeToggle compact />
            </div>
          </div>
          <AppBanners />
          <div
            className={
              location.pathname.startsWith("/chat") ||
              location.pathname.startsWith("/crm") ||
              location.pathname.startsWith("/sales") ||
              location.pathname.startsWith("/messenger") ||
              location.pathname.startsWith("/tasks") ||
              location.pathname.startsWith("/analytics") ||
              location.pathname.startsWith("/employees") ||
              location.pathname.startsWith("/audit") ||
              location.pathname.startsWith("/integrations") ||
              location.pathname.startsWith("/finance")
                ? [
                    "flex min-h-0 flex-1 flex-col",
                    location.pathname.startsWith("/chat") ? "max-lg:h-full max-lg:min-h-0" : "",
                    location.pathname.startsWith("/crm")
                      ? "min-h-0 flex-1 overflow-hidden [&>*]:min-h-0 [&>*]:flex-1"
                      : "",
                    location.pathname.startsWith("/sales") ? "min-h-0 flex-1 [&>*]:min-h-0 [&>*]:flex-1" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")
                : undefined
            }
          >
            <TariffFeatureOutletGate />
          </div>
        </main>

        <nav
          aria-label="Основная навигация"
          className={[
            "print:hidden no-scrollbar fixed bottom-0 left-0 right-0 z-50 flex items-stretch border-t border-[var(--mo-border)] bg-[var(--mo-surface-elevated)]/95 backdrop-blur-xl sm:hidden",
            deskSalesEnabled || managerChatFirst
              ? "gap-0 px-1 pt-1.5 pb-[max(0.35rem,env(safe-area-inset-bottom))]"
              : "touch-pan-x gap-0.5 overflow-x-auto overscroll-x-contain px-1 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]",
          ].join(" ")}
        >
          {isSuperOwner ? (
            <>
              <NavLink preventScrollReset to="/companies" className={mobileBottomNavLinkClass} title="Компании">
                <GradientIconBox variant="purple" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <Users className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">Компании</span>
              </NavLink>
              <button
                type="button"
                onClick={logout}
                className={mobileBottomLogoutClass}
                title="Выход"
              >
                <GradientIconBox variant="pink" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <LogOut className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">Выход</span>
              </button>
            </>
          ) : isCurator ? (
            <>
              <NavIf show={bookingEnabled && showNavForFeature("booking")}>
                <NavLink preventScrollReset to="/booking" className={mobileBottomNavLinkClass} title="Онлайн-записи">
                  <GradientIconBox variant="online" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <Calendar className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Онлайн</span>
                </NavLink>
              </NavIf>
              {showKpi ? (
                <NavIf show={showNavForFeature("kpi")}>
                  <NavLink preventScrollReset to="/kpi" className={mobileBottomNavLinkClass} title="Дебиторка">
                    <GradientIconBox variant="indigo" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                      <Target className="h-4 w-4" />
                    </GradientIconBox>
                    <span className="text-[9px]">Долги</span>
                  </NavLink>
                </NavIf>
              ) : null}
              <button type="button" onClick={logout} className={mobileBottomLogoutClass} title="Выход">
                <GradientIconBox variant="pink" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <LogOut className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">Выход</span>
              </button>
            </>
          ) : isAdministrator ? (
            <>
              <NavIf show={showNavForFeature("chat")}>
                <NavLink preventScrollReset to="/chat" className={mobileBottomNavLinkClass} title="Чаты">
                  <GradientIconBox variant="chat" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <MessageCircle className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Чаты</span>
                </NavLink>
              </NavIf>
              <NavIf show={showNavForFeature("crm")}>
                <NavLink preventScrollReset to="/crm" className={mobileBottomNavLinkClass} title={navLex.navKanbanTitle}>
                  <GradientIconBox variant="crm" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <Funnel className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">{navLex.navKanban}</span>
                </NavLink>
              </NavIf>
              <NavIf show={bookingEnabled && showNavForFeature("booking")}>
                <NavLink preventScrollReset to="/booking" className={mobileBottomNavLinkClass} title="Онлайн-записи">
                  <GradientIconBox variant="online" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <Calendar className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Онлайн</span>
                </NavLink>
              </NavIf>
              {showKpi ? (
                <NavIf show={showNavForFeature("kpi")}>
                  <NavLink preventScrollReset to="/kpi" className={mobileBottomNavLinkClass} title={navLex.navKpiTitle}>
                    <GradientIconBox variant="indigo" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                      <Target className="h-4 w-4" />
                    </GradientIconBox>
                    <span className="text-[9px]">KPI</span>
                  </NavLink>
                </NavIf>
              ) : null}
              <button type="button" onClick={logout} className={mobileBottomLogoutClass} title="Выход">
                <GradientIconBox variant="pink" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <LogOut className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">Выход</span>
              </button>
            </>
          ) : isAccountant ? (
            <>
              <NavIf show={showFinance && showNavForFeature("finance")}>
                <NavLink preventScrollReset to="/finance" className={mobileBottomNavLinkClass} title="Финансы">
                  <GradientIconBox variant="blue" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <Wallet className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Финансы</span>
                </NavLink>
              </NavIf>
              {showExpenses ? (
                <NavLink preventScrollReset to="/expenses" className={mobileBottomNavLinkClass} title="Расходы">
                  <GradientIconBox variant="indigo" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <ClipboardList className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Расходы</span>
                </NavLink>
              ) : null}
              <button type="button" onClick={logout} className={mobileBottomLogoutClass} title="Выход">
                <GradientIconBox variant="pink" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <LogOut className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">Выход</span>
              </button>
            </>
          ) : deskSalesEnabled && (isManagerLikeNav || !isExpert) ? (
            <>
              <NavIf show={showNavForFeature("chat")}>
                <NavLink
                  preventScrollReset
                  to="/chat"
                  className={salesMobileBottomNavLinkClass}
                  title="Чаты"
                >
                  <GradientIconBox variant="tasks" className="h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5">
                    <MessageCircle className="h-3.5 w-3.5" />
                  </GradientIconBox>
                  <span className="max-w-full truncate text-[9px] leading-tight">Чаты</span>
                </NavLink>
              </NavIf>
              <NavIf show={bookingEnabled && showNavForFeature("booking")}>
                <NavLink
                  preventScrollReset
                  to="/booking"
                  className={salesMobileBottomNavLinkClass}
                  title="Онлайн-запись"
                >
                  <GradientIconBox variant="tasks" className="h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5">
                    <Calendar className="h-3.5 w-3.5" />
                  </GradientIconBox>
                  <span className="max-w-full truncate text-[9px] leading-tight">Запись</span>
                </NavLink>
              </NavIf>
              {!isManagerLikeNav ? (
                <NavIf show={showNavForFeature("crm")}>
                  <NavLink
                    preventScrollReset
                    to="/crm"
                    end={false}
                    className={salesMobileBottomNavLinkClass}
                    title={navLex.navKanbanTitle}
                  >
                    <GradientIconBox variant="crm" className="h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5">
                      <Funnel className="h-3.5 w-3.5" />
                    </GradientIconBox>
                    <span className="max-w-full truncate text-[9px] leading-tight">CRM</span>
                  </NavLink>
                </NavIf>
              ) : null}
              <NavLink
                preventScrollReset
                to="/quote"
                className={salesMobileBottomNavLinkClass}
                title="Смета"
              >
                <GradientIconBox variant="indigo" className="h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5">
                  <ClipboardList className="h-3.5 w-3.5" />
                </GradientIconBox>
                <span className="max-w-full truncate text-[9px] leading-tight">Смета</span>
              </NavLink>
              <NavLink
                preventScrollReset
                to="/tracker"
                className={salesMobileBottomNavLinkClass}
                title="Трекер"
              >
                <GradientIconBox variant="blue" className="h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5">
                  <MapPin className="h-3.5 w-3.5" />
                </GradientIconBox>
                <span className="max-w-full truncate text-[9px] leading-tight">Трекер</span>
              </NavLink>
              <NavLink
                preventScrollReset
                to="/sales"
                className={salesMobileBottomNavLinkClass}
                title="Продажи"
              >
                <GradientIconBox variant="online" className="h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5">
                  <Wallet className="h-3.5 w-3.5" />
                </GradientIconBox>
                <span className="max-w-full truncate text-[9px] leading-tight">Продажи</span>
              </NavLink>
              {showKpi ? (
                <NavIf show={showNavForFeature("kpi")}>
                  <NavLink
                    preventScrollReset
                    to="/kpi"
                    className={salesMobileBottomNavLinkClass}
                    title={navLex.navKpiTitle}
                  >
                    <GradientIconBox variant="indigo" className="h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5">
                      <Target className="h-3.5 w-3.5" />
                    </GradientIconBox>
                    <span className="max-w-full truncate text-[9px] leading-tight">KPI</span>
                  </NavLink>
                </NavIf>
              ) : null}
              <button
                type="button"
                onClick={logout}
                className={salesMobileBottomLogoutClass}
                title="Выход"
              >
                <GradientIconBox variant="pink" className="h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5">
                  <LogOut className="h-3.5 w-3.5" />
                </GradientIconBox>
                <span className="max-w-full truncate text-[9px] leading-tight">Выход</span>
              </button>
            </>
          ) : isManagerLikeNav ? (
            <>
              <NavIf show={showNavForFeature("chat")}>
                <NavLink
                  preventScrollReset
                  to="/chat"
                  className={managerChatFirst ? salesMobileBottomNavLinkClass : mobileBottomNavLinkClass}
                  title="Чаты"
                >
                  <GradientIconBox
                    variant="tasks"
                    className={managerChatFirst ? "h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5" : "h-9 w-9 [&_svg]:h-4 [&_svg]:w-4"}
                  >
                    <MessageCircle className={managerChatFirst ? "h-3.5 w-3.5" : "h-4 w-4"} />
                  </GradientIconBox>
                  <span className={managerChatFirst ? "max-w-full truncate text-[9px] leading-tight" : "text-[9px]"}>
                    Чаты
                  </span>
                </NavLink>
              </NavIf>
              <NavIf show={bookingEnabled && showNavForFeature("booking")}>
                <NavLink
                  preventScrollReset
                  to="/booking"
                  className={managerChatFirst ? salesMobileBottomNavLinkClass : mobileBottomNavLinkClass}
                  title="Онлайн-записи"
                >
                  <GradientIconBox
                    variant="tasks"
                    className={managerChatFirst ? "h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5" : "h-9 w-9 [&_svg]:h-4 [&_svg]:w-4"}
                  >
                    <Calendar className={managerChatFirst ? "h-3.5 w-3.5" : "h-4 w-4"} />
                  </GradientIconBox>
                  <span className={managerChatFirst ? "max-w-full truncate text-[9px] leading-tight" : "text-[9px]"}>
                    Онлайн
                  </span>
                </NavLink>
              </NavIf>
              <NavIf show={showNavForFeature("crm")}>
                <NavLink
                  preventScrollReset
                  to="/crm"
                  className={managerChatFirst ? salesMobileBottomNavLinkClass : mobileBottomNavLinkClass}
                  title={navLex.navKanbanTitle}
                >
                  <GradientIconBox
                    variant="crm"
                    className={managerChatFirst ? "h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5" : "h-9 w-9 [&_svg]:h-4 [&_svg]:w-4"}
                  >
                    <Funnel className={managerChatFirst ? "h-3.5 w-3.5" : "h-4 w-4"} />
                  </GradientIconBox>
                  <span className={managerChatFirst ? "max-w-full truncate text-[9px] leading-tight" : "text-[9px]"}>
                    {navLex.navKanban}
                  </span>
                </NavLink>
              </NavIf>
              <NavIf show={showNavForFeature("crm")}>
                <NavLink
                  preventScrollReset
                  to="/my-leads"
                  className={managerChatFirst ? salesMobileBottomNavLinkClass : mobileBottomNavLinkClass}
                  title={navLex.navGuestsTitle}
                >
                  <GradientIconBox
                    variant="indigo"
                    className={managerChatFirst ? "h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5" : "h-9 w-9 [&_svg]:h-4 [&_svg]:w-4"}
                  >
                    <UserRound className={managerChatFirst ? "h-3.5 w-3.5" : "h-4 w-4"} />
                  </GradientIconBox>
                  <span className={managerChatFirst ? "max-w-full truncate text-[9px] leading-tight" : "text-[9px]"}>
                    {navLex.navGuestsShort}
                  </span>
                </NavLink>
              </NavIf>
              <NavIf show={showNavForFeature("tasks")}>
                <NavLink
                  preventScrollReset
                  to="/tasks"
                  className={managerChatFirst ? salesMobileBottomNavLinkClass : mobileBottomNavLinkClass}
                  title="Задачи"
                >
                  <GradientIconBox
                    variant="purple"
                    className={managerChatFirst ? "h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5" : "h-9 w-9 [&_svg]:h-4 [&_svg]:w-4"}
                  >
                    <CheckSquare className={managerChatFirst ? "h-3.5 w-3.5" : "h-4 w-4"} />
                  </GradientIconBox>
                  <span className={managerChatFirst ? "max-w-full truncate text-[9px] leading-tight" : "text-[9px]"}>
                    Задачи
                  </span>
                </NavLink>
              </NavIf>
              <NavLink
                preventScrollReset
                to="/messenger"
                className={managerChatFirst ? salesMobileBottomNavLinkClass : mobileBottomNavLinkClass}
                title="Мессенджер"
              >
                <GradientIconBox
                  variant="tasks"
                  className={managerChatFirst ? "h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5" : "h-9 w-9 [&_svg]:h-4 [&_svg]:w-4"}
                >
                  <Users className={managerChatFirst ? "h-3.5 w-3.5" : "h-4 w-4"} />
                </GradientIconBox>
                <span className={managerChatFirst ? "max-w-full truncate text-[9px] leading-tight" : "text-[9px]"}>
                  Мессенджер
                </span>
              </NavLink>
              {showKpi ? (
                <NavIf show={showNavForFeature("kpi")}>
                  <NavLink
                    preventScrollReset
                    to="/kpi"
                    className={managerChatFirst ? salesMobileBottomNavLinkClass : mobileBottomNavLinkClass}
                    title={navLex.navKpiTitle}
                  >
                    <GradientIconBox
                      variant="indigo"
                      className={managerChatFirst ? "h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5" : "h-9 w-9 [&_svg]:h-4 [&_svg]:w-4"}
                    >
                      <Target className={managerChatFirst ? "h-3.5 w-3.5" : "h-4 w-4"} />
                    </GradientIconBox>
                    <span className={managerChatFirst ? "max-w-full truncate text-[9px] leading-tight" : "text-[9px]"}>
                      {navLex.navKpi}
                    </span>
                  </NavLink>
                </NavIf>
              ) : null}
              {showFinance ? (
                <NavIf show={showNavForFeature("finance")}>
                  <NavLink
                    preventScrollReset
                    to="/finance"
                    className={managerChatFirst ? salesMobileBottomNavLinkClass : mobileBottomNavLinkClass}
                    title={navLex.navFinanceTitle}
                  >
                    <GradientIconBox
                      variant="blue"
                      className={managerChatFirst ? "h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5" : "h-9 w-9 [&_svg]:h-4 [&_svg]:w-4"}
                    >
                      <Wallet className={managerChatFirst ? "h-3.5 w-3.5" : "h-4 w-4"} />
                    </GradientIconBox>
                    <span className={managerChatFirst ? "max-w-full truncate text-[9px] leading-tight" : "text-[9px]"}>
                      {navLex.navFinance}
                    </span>
                  </NavLink>
                </NavIf>
              ) : null}
              <button
                type="button"
                onClick={logout}
                className={managerChatFirst ? salesMobileBottomLogoutClass : mobileBottomLogoutClass}
                title="Выход"
              >
                <GradientIconBox
                  variant="pink"
                  className={managerChatFirst ? "h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5" : "h-9 w-9 [&_svg]:h-4 [&_svg]:w-4"}
                >
                  <LogOut className={managerChatFirst ? "h-3.5 w-3.5" : "h-4 w-4"} />
                </GradientIconBox>
                <span className={managerChatFirst ? "max-w-full truncate text-[9px] leading-tight" : "text-[9px]"}>
                  Выход
                </span>
              </button>
            </>
          ) : isExpert && !isChiefExpert ? (
            <>
              <NavIf show={bookingEnabled && showNavForFeature("booking")}>
                <NavLink preventScrollReset to="/booking" className={mobileBottomNavLinkClass} title="Онлайн-записи">
                  <GradientIconBox variant="tasks" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <Calendar className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Онлайн</span>
                </NavLink>
              </NavIf>
              <NavIf show={bookingEnabled && showNavForFeature("reports")}>
                <NavLink preventScrollReset to="/reports" className={mobileBottomNavLinkClass} title="Отчёты">
                  <GradientIconBox variant="blue" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <BarChart3 className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Отчёты</span>
                </NavLink>
              </NavIf>
              <NavIf show={showNavForFeature("chat")}>
                <NavLink preventScrollReset to="/chat" className={mobileBottomNavLinkClass} title="Чаты">
                  <GradientIconBox variant="tasks" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <MessageCircle className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Чаты</span>
                </NavLink>
              </NavIf>
              <NavIf show={showNavForFeature("tasks")}>
                <NavLink preventScrollReset to="/tasks" className={mobileBottomNavLinkClass} title="Задачи">
                  <GradientIconBox variant="purple" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <CheckSquare className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Задачи</span>
                </NavLink>
              </NavIf>
                  <NavLink preventScrollReset to="/messenger" className={mobileBottomNavLinkClass} title="Мессенджер">
                    <GradientIconBox variant="tasks" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                      <Users className="h-4 w-4" />
                    </GradientIconBox>
                    <span className="text-[9px]">Мессенджер</span>
                  </NavLink>

<button
                type="button"
                onClick={logout}
                className={mobileBottomLogoutClass}
                title="Выход"
              >
                <GradientIconBox variant="pink" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <LogOut className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">Выход</span>
              </button>
            </>
          ) : (
            <>
              <NavIf show={showNavForFeature("crm")}>
                <NavLink preventScrollReset to="/app" end className={mobileBottomNavLinkClass} title={navLex.navOwnerHomeTitle}>
                  <GradientIconBox variant="crm" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <Funnel className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">{navLex.navOwnerHomeShort}</span>
                </NavLink>
              </NavIf>
              <NavIf show={bookingEnabled && showNavForFeature("booking")}>
                <NavLink preventScrollReset to="/booking" className={mobileBottomNavLinkClass} title="Онлайн-записи">
                  <GradientIconBox variant="tasks" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <Calendar className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Онлайн</span>
                </NavLink>
              </NavIf>
              {showKpi ? (
                <NavIf show={showNavForFeature("kpi")}>
                  <NavLink preventScrollReset to="/kpi" className={mobileBottomNavLinkClass} title={navLex.navKpiTitle}>
                    <GradientIconBox variant="indigo" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                      <Target className="h-4 w-4" />
                    </GradientIconBox>
                    <span className="text-[9px]">{navLex.navKpi}</span>
                  </NavLink>
                </NavIf>
              ) : null}
              {showFinance ? (
                <NavIf show={showNavForFeature("finance")}>
                  <NavLink preventScrollReset to="/finance" className={mobileBottomNavLinkClass} title={navLex.navFinanceTitle}>
                    <GradientIconBox variant="blue" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                      <Wallet className="h-4 w-4" />
                    </GradientIconBox>
                    <span className="text-[9px]">{navLex.navFinance}</span>
                  </NavLink>
                </NavIf>
              ) : null}
              <NavIf show={showNavForFeature("chat")}>
                <NavLink preventScrollReset to="/chat" className={mobileBottomNavLinkClass} title="Чаты">
                  <GradientIconBox variant="tasks" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <MessageCircle className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Чаты</span>
                </NavLink>
              </NavIf>
              <button
                type="button"
                onClick={logout}
                className={mobileBottomLogoutClass}
                title="Выход"
              >
                <GradientIconBox variant="pink" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <LogOut className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">Выход</span>
              </button>
            </>
          )}
        </nav>
      </div>
    </div>
  );
}
