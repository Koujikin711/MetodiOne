import {
  BarChart3,
  Calendar,
  LayoutDashboard,
  Target,
  CheckSquare,
  Funnel,
  LogOut,
  Menu,
  MessageCircle,
  Plug,
  UserRound,
  Users,
  Wallet,
} from "@/components/icons";
import { AppBanners } from "@/components/AppBanners";
import { ShellNavLink } from "@/components/ShellNavLink";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TariffFeatureOutletGate } from "@/components/TariffFeatureOutletGate";
import { GradientIconBox } from "@/components/GradientIconBox";
import { useEffect, useRef, type ReactNode } from "react";
import toast from "react-hot-toast";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import metodiMarkUrl from "@/assets/metodione-mark.svg?url";
import { apiFetch, getStoredToken, setStoredToken } from "@/lib/api";
import { decodeRoleFromToken, decodeUserIdFromToken } from "@/lib/auth";
import { useTariffNavAccess } from "@/hooks/useTariffNavAccess";
import { useShellSidebarExpanded } from "@/hooks/useShellSidebarExpanded";
import { appLexicon } from "@/lib/appLexicon";
import type { ChatThread, Task, TaskListResponse } from "@/lib/types";

function mobileBottomNavLinkClass({ isActive }: { isActive: boolean }) {
  return [
    "shell-nav-link group flex shrink-0 min-w-[4.25rem] flex-col items-center gap-1 rounded-2xl px-2 py-1.5 text-center",
    isActive ? "is-active" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const mobileBottomLogoutClass =
  "group flex shrink-0 min-w-[4.25rem] flex-col items-center gap-1 rounded-2xl px-2 py-1.5 text-center lux-caption transition-all duration-500 hover:bg-white/[0.04] hover:text-[var(--mo-text)]";

function NavIf({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null;
  return <>{children}</>;
}

function MetodiBrandMark({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <img
      src={metodiMarkUrl}
      alt=""
      className={["shrink-0 select-none drop-shadow-lg", className].filter(Boolean).join(" ")}
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
  const isExpert = role === "expert";
  const showServices = role === "owner" || role === "admin";
  const showFinance =
    role === "owner" ||
    role === "admin" ||
    role === "super_owner" ||
    role === "finance_analyst" ||
    role === "accountant";
  const showIntegrationsHub = role === "owner";
  const showKpi = role === "owner" || role === "super_owner" || role === "manager" || role === "admin";
  const { showNavForFeature } = useTariffNavAccess();
  const { expanded: sidebarExpanded, toggle: toggleSidebar } = useShellSidebarExpanded();
  const navLex = appLexicon;

  function logout() {
    setStoredToken(null);
    navigate("/login", { replace: true });
  }

  const prevUnreadRef = useRef<Record<number, number>>({});
  const prevMyTaskIdsRef = useRef<Set<number>>(new Set());
  const prevCreatedStatusesRef = useRef<Record<number, string>>({});
  const notificationsInitializedRef = useRef(false);
  const notificationsInFlightRef = useRef(false);
  const isPageVisibleRef = useRef(typeof document !== "undefined" ? document.visibilityState === "visible" : true);

  useEffect(() => {
    function pushBrowserNotification(title: string, body: string) {
      if (typeof window === "undefined" || typeof Notification === "undefined") return;
      if (Notification.permission === "granted") {
        try {
          const n = new Notification(title, { body });
          window.setTimeout(() => n.close(), 7000);
        } catch {
          /* ignore browser notification errors */
        }
      } else if (Notification.permission === "default") {
        void Notification.requestPermission();
      }
    }

    const canUseTeamTasks = role === "owner" || role === "admin" || role === "manager";
    const canUseChatNotifications = role === "owner" || role === "admin" || role === "manager" || role === "expert";
    const isChatPage = location.pathname.startsWith("/chat");
    const isTasksPage = location.pathname.startsWith("/tasks");
    const isCrmPage = location.pathname.startsWith("/crm");

    async function pollNotifications() {
      if (notificationsInFlightRef.current) return;
      if (!isPageVisibleRef.current) return;
      try {
        notificationsInFlightRef.current = true;
        const [threads, myActiveTasks, createdActiveTasks, createdJournalTasks] = await Promise.all([
          canUseChatNotifications && !isChatPage
            ? apiFetch<ChatThread[]>("/api/chat/threads?limit=60&offset=0")
            : Promise.resolve([]),
          !isTasksPage && !isCrmPage
            ? apiFetch<TaskListResponse>("/api/tasks?scope=my&journal=false&limit=80&offset=0&include_total=false")
            : Promise.resolve({ items: [] } as TaskListResponse),
          canUseTeamTasks && !isTasksPage && !isCrmPage
            ? apiFetch<TaskListResponse>("/api/tasks?scope=team&journal=false&limit=120&offset=0&include_total=false")
            : Promise.resolve({ items: [] } as TaskListResponse),
          canUseTeamTasks && !isTasksPage && !isCrmPage
            ? apiFetch<TaskListResponse>("/api/tasks?scope=team&journal=true&limit=120&offset=0&include_total=false")
            : Promise.resolve({ items: [] } as TaskListResponse),
        ]);

        const nextUnread: Record<number, number> = {};
        for (const th of threads) {
          nextUnread[th.id] = Number(th.unread_count ?? 0);
        }
        if (notificationsInitializedRef.current) {
          for (const th of threads) {
            const prev = prevUnreadRef.current[th.id] ?? 0;
            const curr = Number(th.unread_count ?? 0);
            if (curr > prev) {
              const label = th.lead_name || th.title || `Диалог #${th.id}`;
              toast(`Новое сообщение в чате: ${label}`);
              pushBrowserNotification("Новое сообщение", label);
            }
          }
        }
        prevUnreadRef.current = nextUnread;

        const myTasks = myActiveTasks.items ?? [];
        const nextMyIds = new Set(myTasks.map((t) => t.id));
        if (notificationsInitializedRef.current) {
          for (const t of myTasks) {
            if (!prevMyTaskIdsRef.current.has(t.id)) {
              toast(`Вам назначена новая задача: ${t.title}`);
              pushBrowserNotification("Новая задача", t.title);
            }
          }
        }
        prevMyTaskIdsRef.current = nextMyIds;

        if (userId != null) {
          const createdTasks = [...(createdActiveTasks.items ?? []), ...(createdJournalTasks.items ?? [])].filter(
            (t) => t.created_by_user_id === userId,
          );
          const nextStatuses: Record<number, string> = {};
          for (const t of createdTasks) nextStatuses[t.id] = t.status;
          if (notificationsInitializedRef.current) {
            for (const t of createdTasks) {
              const prevStatus = prevCreatedStatusesRef.current[t.id];
              if (prevStatus && prevStatus !== t.status) {
                const msg = `Статус задачи "${t.title}" изменён: ${t.status}`;
                toast(msg);
                pushBrowserNotification("Обновление задачи", msg);
              }
            }
          }
          prevCreatedStatusesRef.current = nextStatuses;
        }

        notificationsInitializedRef.current = true;
      } catch {
        // silent: notifications should not break UI
      } finally {
        notificationsInFlightRef.current = false;
      }
    }

    const onVisibilityChange = () => {
      isPageVisibleRef.current = document.visibilityState === "visible";
      if (isPageVisibleRef.current && location.pathname !== "/login") {
        void pollNotifications();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void pollNotifications();
    const timer = window.setInterval(() => {
      if (location.pathname === "/login") return;
      void pollNotifications();
    }, 15000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(timer);
    };
  }, [location.pathname, role, userId]);

  return (
    <div className="relative h-screen overflow-hidden app-shell-bg">

      <div className="relative z-10 flex h-screen min-h-0 flex-col sm:flex-row">
        <aside
          className={[
            "shell-sidebar print:hidden hidden h-screen min-h-0 shrink-0 py-4 sm:flex sm:flex-col",
            sidebarExpanded ? "is-expanded" : "is-collapsed",
          ].join(" ")}
        >
          <div className="shell-sidebar-header">
            <button
              type="button"
              onClick={toggleSidebar}
              className="shell-sidebar-toggle h-10 w-10"
              title={sidebarExpanded ? "Свернуть меню" : "Развернуть меню"}
              aria-label={sidebarExpanded ? "Свернуть меню" : "Развернуть меню"}
            >
              <Menu className="h-5 w-5" />
            </button>
            {sidebarExpanded ? (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <MetodiBrandMark className="h-8 w-8" />
                <span className="truncate text-sm font-semibold text-white/90">MetodiOne</span>
              </div>
            ) : null}
          </div>
          <nav className="no-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto py-1">
            {isSuperOwner ? (
              <ShellNavLink
                to="/companies"
                title="Компании"
                labelShort="Компании"
                labelFull="Компании"
                variant="purple"
                icon={<Users className="h-[18px] w-[18px]" />}
                expanded={sidebarExpanded}
              />
            ) : isManagerNav ? (
              <>
                <ShellNavLink
                  to="/desk"
                  title="Рабочий стол"
                  labelShort="Стол"
                  labelFull="Рабочий стол"
                  variant="crm"
                  icon={<LayoutDashboard className="h-[18px] w-[18px]" />}
                  expanded={sidebarExpanded}
                />
                <NavIf show={showNavForFeature("chat")}>
                  <ShellNavLink
                    to="/chat"
                    title="Чат"
                    labelShort="Чат"
                    labelFull="Чат"
                    variant="chat"
                    icon={<MessageCircle className="h-[18px] w-[18px]" />}
                    expanded={sidebarExpanded}
                  />
                </NavIf>
                <NavIf show={showNavForFeature("booking")}>
                  <ShellNavLink
                    to="/booking"
                    title="Онлайн-записи"
                    labelShort="Онлайн"
                    labelFull="Онлайн-запись"
                    variant="online"
                    icon={<Calendar className="h-[18px] w-[18px]" />}
                    expanded={sidebarExpanded}
                  />
                </NavIf>
                <NavIf show={showNavForFeature("crm")}>
                  <ShellNavLink
                    to="/crm"
                    title={navLex.navKanbanTitle}
                    labelShort={navLex.navKanban}
                    labelFull={navLex.navKanbanTitle}
                    variant="crm"
                    icon={<Funnel className="h-[18px] w-[18px]" />}
                    expanded={sidebarExpanded}
                  />
                </NavIf>
                <NavIf show={showNavForFeature("crm")}>
                  <ShellNavLink
                    to="/my-leads"
                    title={navLex.navGuestsTitle}
                    labelShort={navLex.navGuests}
                    labelFull={navLex.navGuestsTitle}
                    variant="indigo"
                    icon={<UserRound className="h-[18px] w-[18px]" />}
                    expanded={sidebarExpanded}
                  />
                </NavIf>
                <NavIf show={showNavForFeature("tasks")}>
                  <ShellNavLink
                    to="/tasks"
                    title="Задачи"
                    labelShort="Задачи"
                    labelFull="Задачи и проекты"
                    variant="tasks"
                    icon={<CheckSquare className="h-[18px] w-[18px]" />}
                    expanded={sidebarExpanded}
                  />
                </NavIf>
                <ShellNavLink
                  to="/messenger"
                  title="Мессенджер"
                  labelShort="Команда"
                  labelFull="Совместная работа"
                  variant="tasks"
                  icon={<Users className="h-[18px] w-[18px]" />}
                  expanded={sidebarExpanded}
                />
                {showKpi ? (
                  <NavIf show={showNavForFeature("kpi")}>
                    <ShellNavLink
                      to="/kpi"
                      title={navLex.navKpiTitle}
                      labelShort={navLex.navKpi}
                      labelFull={navLex.navKpiTitle}
                      variant="indigo"
                      icon={<Target className="h-[18px] w-[18px]" />}
                      expanded={sidebarExpanded}
                    />
                  </NavIf>
                ) : null}
                {showFinance ? (
                  <NavIf show={showNavForFeature("finance")}>
                    <ShellNavLink
                      to="/finance"
                      title={navLex.navFinanceTitle}
                      labelShort={navLex.navFinance}
                      labelFull={navLex.navFinanceTitle}
                      variant="blue"
                      icon={<Wallet className="h-[18px] w-[18px]" />}
                      expanded={sidebarExpanded}
                    />
                  </NavIf>
                ) : null}
                {showServices ? (
                  <ShellNavLink
                    to="/services"
                    title="Каталог услуг"
                    labelShort="Услуги"
                    labelFull="Каталог услуг"
                    variant="purple"
                    icon={<Funnel className="h-[18px] w-[18px]" />}
                    expanded={sidebarExpanded}
                  />
                ) : null}
              </>
            ) : isExpert ? (
              <>
                <NavIf show={showNavForFeature("booking")}>
                  <ShellNavLink
                    to="/booking"
                    title="Онлайн-записи"
                    labelShort="Онлайн"
                    labelFull="Онлайн-запись"
                    variant="tasks"
                    icon={<Calendar className="h-[18px] w-[18px]" />}
                    expanded={sidebarExpanded}
                  />
                </NavIf>
                <NavIf show={showNavForFeature("reports")}>
                  <ShellNavLink
                    to="/reports"
                    title="Отчёты"
                    labelShort="Отчёты"
                    labelFull="Отчёты"
                    variant="blue"
                    icon={<BarChart3 className="h-[18px] w-[18px]" />}
                    expanded={sidebarExpanded}
                  />
                </NavIf>
                <NavIf show={showNavForFeature("chat")}>
                  <ShellNavLink
                    to="/chat"
                    title="Чат"
                    labelShort="Чат"
                    labelFull="Чат"
                    variant="tasks"
                    icon={<MessageCircle className="h-[18px] w-[18px]" />}
                    expanded={sidebarExpanded}
                  />
                </NavIf>
                <NavIf show={showNavForFeature("tasks")}>
                  <ShellNavLink
                    to="/tasks"
                    title="Задачи"
                    labelShort="Задачи"
                    labelFull="Задачи и проекты"
                    variant="purple"
                    icon={<CheckSquare className="h-[18px] w-[18px]" />}
                    expanded={sidebarExpanded}
                  />
                </NavIf>
                <ShellNavLink
                  to="/messenger"
                  title="Мессенджер"
                  labelShort="Команда"
                  labelFull="Совместная работа"
                  variant="tasks"
                  icon={<Users className="h-[18px] w-[18px]" />}
                  expanded={sidebarExpanded}
                />
              </>
            ) : (
              <>
                <NavIf show={showNavForFeature("crm")}>
                  <ShellNavLink
                    to="/app"
                    end
                    title={navLex.navOwnerHomeTitle}
                    labelShort={navLex.navOwnerHomeShort}
                    labelFull={navLex.navOwnerHomeTitle}
                    variant="indigo"
                    icon={<Funnel className="h-[18px] w-[18px]" />}
                    expanded={sidebarExpanded}
                  />
                </NavIf>
                <NavIf show={showNavForFeature("booking")}>
                  <ShellNavLink
                    to="/booking"
                    title="Онлайн-записи"
                    labelShort="Онлайн"
                    labelFull="Онлайн-запись"
                    variant="tasks"
                    icon={<Calendar className="h-[18px] w-[18px]" />}
                    expanded={sidebarExpanded}
                  />
                </NavIf>
                <NavIf show={showNavForFeature("tasks")}>
                  <ShellNavLink
                    to="/tasks"
                    title="Задачи"
                    labelShort="Задачи"
                    labelFull="Задачи и проекты"
                    variant="purple"
                    icon={<CheckSquare className="h-[18px] w-[18px]" />}
                    expanded={sidebarExpanded}
                  />
                </NavIf>
                <ShellNavLink
                  to="/messenger"
                  title="Мессенджер"
                  labelShort="Команда"
                  labelFull="Совместная работа"
                  variant="tasks"
                  icon={<Users className="h-[18px] w-[18px]" />}
                  expanded={sidebarExpanded}
                />
                <NavIf show={showNavForFeature("analytics")}>
                  <ShellNavLink
                    to="/analytics"
                    title={navLex.navAnalyticsTitle}
                    labelShort={navLex.navAnalytics}
                    labelFull={navLex.navAnalyticsTitle}
                    variant="blue"
                    icon={<BarChart3 className="h-[18px] w-[18px]" />}
                    expanded={sidebarExpanded}
                  />
                </NavIf>
                {showKpi ? (
                  <NavIf show={showNavForFeature("kpi")}>
                    <ShellNavLink
                      to="/kpi"
                      title={navLex.navKpiTitle}
                      labelShort={navLex.navKpi}
                      labelFull={navLex.navKpiTitle}
                      variant="indigo"
                      icon={<Target className="h-[18px] w-[18px]" />}
                      expanded={sidebarExpanded}
                    />
                  </NavIf>
                ) : null}
                {showFinance ? (
                  <NavIf show={showNavForFeature("finance")}>
                    <ShellNavLink
                      to="/finance"
                      title={navLex.navFinanceTitle}
                      labelShort={navLex.navFinance}
                      labelFull={navLex.navFinanceTitle}
                      variant="blue"
                      icon={<Wallet className="h-[18px] w-[18px]" />}
                      expanded={sidebarExpanded}
                    />
                  </NavIf>
                ) : null}
                {showServices ? (
                  <ShellNavLink
                    to="/services"
                    title="Каталог услуг"
                    labelShort="Услуги"
                    labelFull="Каталог услуг"
                    variant="purple"
                    icon={<Funnel className="h-[18px] w-[18px]" />}
                    expanded={sidebarExpanded}
                  />
                ) : null}
                <NavIf show={showNavForFeature("employees")}>
                  <ShellNavLink
                    to="/employees"
                    title="Сотрудники"
                    labelShort="Сотр."
                    labelFull="Сотрудники"
                    variant="purple"
                    icon={<Users className="h-[18px] w-[18px]" />}
                    expanded={sidebarExpanded}
                  />
                </NavIf>
                <NavIf show={showNavForFeature("chat")}>
                  <ShellNavLink
                    to="/chat"
                    title="Чат"
                    labelShort="Чат"
                    labelFull="Чат"
                    variant="tasks"
                    icon={<MessageCircle className="h-[18px] w-[18px]" />}
                    expanded={sidebarExpanded}
                  />
                </NavIf>
                <NavIf show={showNavForFeature("audit")}>
                  <ShellNavLink
                    to="/audit"
                    title="Аудит"
                    labelShort="Аудит"
                    labelFull="Аудит"
                    variant="blue"
                    icon={<BarChart3 className="h-[18px] w-[18px]" />}
                    expanded={sidebarExpanded}
                  />
                </NavIf>
                {showIntegrationsHub ? (
                  <NavIf show={showNavForFeature("integrations")}>
                    <ShellNavLink
                      to="/integrations"
                      title="Интеграции"
                      labelShort="Интегр."
                      labelFull="Интеграции"
                      variant="integrations"
                      icon={<Plug className="h-[18px] w-[18px]" />}
                      expanded={sidebarExpanded}
                    />
                  </NavIf>
                ) : null}
              </>
            )}
          </nav>
          <div className="shell-sidebar-footer shrink-0 px-1 pt-3">
            <ThemeToggle sidebar expanded={sidebarExpanded} />
            <button
              type="button"
              onClick={logout}
              title="Выход"
              className="shell-sidebar-logout"
            >
              <GradientIconBox variant="pink" className="shell-nav-icon-box h-10 w-10 opacity-90 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                <LogOut className="h-[18px] w-[18px]" />
              </GradientIconBox>
              <span className="shell-nav-text">Выход</span>
              <span className="shell-nav-label">Выход</span>
            </button>
          </div>
        </aside>

        <main className="relative min-h-0 flex-1 overflow-y-auto px-3 py-4 pb-[calc(5.75rem+env(safe-area-inset-bottom))] sm:px-10 sm:py-10 sm:pb-10 lg:px-14 text-[var(--mo-text)]">
          <div className="pointer-events-none fixed right-3 top-3 z-40 sm:hidden">
            <div className="pointer-events-auto">
              <ThemeToggle compact />
            </div>
          </div>
          <AppBanners />
          <TariffFeatureOutletGate />
        </main>

        <nav
          aria-label="Основная навигация"
          className="print:hidden no-scrollbar fixed bottom-0 left-0 right-0 z-50 flex touch-pan-x items-stretch gap-0.5 overflow-x-auto overscroll-x-contain border-t border-[var(--mo-border)] bg-[var(--mo-surface-elevated)]/95 px-1 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:hidden"
        >
          {isSuperOwner ? (
            <>
              <NavLink to="/companies" className={mobileBottomNavLinkClass} title="Компании">
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
          ) : isManagerNav ? (
            <>
              <NavIf show={showNavForFeature("crm")}>
                <NavLink to="/crm" className={mobileBottomNavLinkClass} title={navLex.navKanbanTitle}>
                  <GradientIconBox variant="crm" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <Funnel className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">{navLex.navKanban}</span>
                </NavLink>
              </NavIf>
              <NavIf show={showNavForFeature("crm")}>
                <NavLink to="/my-leads" className={mobileBottomNavLinkClass} title={navLex.navGuestsTitle}>
                  <GradientIconBox variant="indigo" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <UserRound className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">{navLex.navGuestsShort}</span>
                </NavLink>
              </NavIf>
<NavIf show={showNavForFeature("booking")}>
                <NavLink to="/booking" className={mobileBottomNavLinkClass} title="Онлайн-записи">
                  <GradientIconBox variant="tasks" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <Calendar className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Онлайн</span>
                </NavLink>
              </NavIf>
              <NavIf show={showNavForFeature("chat")}>
                <NavLink to="/chat" className={mobileBottomNavLinkClass} title="Чат">
                  <GradientIconBox variant="tasks" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <MessageCircle className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Чат</span>
                </NavLink>
              </NavIf>
              <NavIf show={showNavForFeature("tasks")}>
                <NavLink to="/tasks" className={mobileBottomNavLinkClass} title="Задачи">
                  <GradientIconBox variant="purple" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <CheckSquare className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Задачи</span>
                </NavLink>
              </NavIf>
              <NavLink to="/messenger" className={mobileBottomNavLinkClass} title="Мессенджер">
                <GradientIconBox variant="tasks" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <Users className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">Команда</span>
              </NavLink>
              {showKpi ? (
                <NavIf show={showNavForFeature("kpi")}>
                  <NavLink to="/kpi" className={mobileBottomNavLinkClass} title={navLex.navKpiTitle}>
                    <GradientIconBox variant="indigo" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                      <Target className="h-4 w-4" />
                    </GradientIconBox>
                    <span className="text-[9px]">{navLex.navKpi}</span>
                  </NavLink>
                </NavIf>
              ) : null}
              {showFinance ? (
                <NavIf show={showNavForFeature("finance")}>
                  <NavLink to="/finance" className={mobileBottomNavLinkClass} title={navLex.navFinanceTitle}>
                    <GradientIconBox variant="blue" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                      <Wallet className="h-4 w-4" />
                    </GradientIconBox>
                    <span className="text-[9px]">{navLex.navFinance}</span>
                  </NavLink>
                </NavIf>
              ) : null}
              {showServices ? (
                <NavLink to="/services" className={mobileBottomNavLinkClass} title="Каталог услуг">
                  <GradientIconBox variant="purple" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <Funnel className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Услуги</span>
                </NavLink>
              ) : null}
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
          ) : isExpert ? (
            <>
              <NavIf show={showNavForFeature("booking")}>
                <NavLink to="/booking" className={mobileBottomNavLinkClass} title="Онлайн-записи">
                  <GradientIconBox variant="tasks" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <Calendar className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Онлайн</span>
                </NavLink>
              </NavIf>
              <NavIf show={showNavForFeature("reports")}>
                <NavLink to="/reports" className={mobileBottomNavLinkClass} title="Отчёты">
                  <GradientIconBox variant="blue" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <BarChart3 className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Отчёты</span>
                </NavLink>
              </NavIf>
              <NavIf show={showNavForFeature("chat")}>
                <NavLink to="/chat" className={mobileBottomNavLinkClass} title="Чат">
                  <GradientIconBox variant="tasks" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <MessageCircle className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Чат</span>
                </NavLink>
              </NavIf>
              <NavIf show={showNavForFeature("tasks")}>
                <NavLink to="/tasks" className={mobileBottomNavLinkClass} title="Задачи">
                  <GradientIconBox variant="purple" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <CheckSquare className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Задачи</span>
                </NavLink>
              </NavIf>
                  <NavLink to="/messenger" className={mobileBottomNavLinkClass} title="Мессенджер">
                    <GradientIconBox variant="tasks" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                      <Users className="h-4 w-4" />
                    </GradientIconBox>
                    <span className="text-[9px]">Команда</span>
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
                <NavLink to="/app" end className={mobileBottomNavLinkClass} title={navLex.navOwnerHomeTitle}>
                  <GradientIconBox variant="crm" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <Funnel className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">{navLex.navOwnerHomeShort}</span>
                </NavLink>
              </NavIf>
<NavIf show={showNavForFeature("booking")}>
                <NavLink to="/booking" className={mobileBottomNavLinkClass} title="Онлайн-записи">
                  <GradientIconBox variant="tasks" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <Calendar className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Онлайн</span>
                </NavLink>
              </NavIf>
              {showKpi ? (
                <NavIf show={showNavForFeature("kpi")}>
                  <NavLink to="/kpi" className={mobileBottomNavLinkClass} title={navLex.navKpiTitle}>
                    <GradientIconBox variant="indigo" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                      <Target className="h-4 w-4" />
                    </GradientIconBox>
                    <span className="text-[9px]">{navLex.navKpi}</span>
                  </NavLink>
                </NavIf>
              ) : null}
              {showFinance ? (
                <NavIf show={showNavForFeature("finance")}>
                  <NavLink to="/finance" className={mobileBottomNavLinkClass} title={navLex.navFinanceTitle}>
                    <GradientIconBox variant="blue" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                      <Wallet className="h-4 w-4" />
                    </GradientIconBox>
                    <span className="text-[9px]">{navLex.navFinance}</span>
                  </NavLink>
                </NavIf>
              ) : null}
              {showServices ? (
                <NavLink to="/services" className={mobileBottomNavLinkClass} title="Каталог услуг">
                  <GradientIconBox variant="purple" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <Funnel className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Услуги</span>
                </NavLink>
              ) : null}
              <NavIf show={showNavForFeature("chat")}>
                <NavLink to="/chat" className={mobileBottomNavLinkClass} title="Чат">
                  <GradientIconBox variant="tasks" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <MessageCircle className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Чат</span>
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
