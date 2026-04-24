import {
  BarChart3,
  Calendar,
  Target,
  CheckSquare,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Plug,
  UserRound,
  Users,
  Wallet,
} from "@/components/icons";
import { AppBanners } from "@/components/AppBanners";
import { GradientIconBox } from "@/components/GradientIconBox";
import { useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import metodiMarkUrl from "@/assets/metodione-mark.svg?url";
import { apiFetch, getStoredToken, setStoredToken } from "@/lib/api";
import { decodeRoleFromToken, decodeUserIdFromToken } from "@/lib/auth";
import type { ChatThread, Task, TaskListResponse } from "@/lib/types";

const navLinkBase =
  "group flex flex-col items-center gap-2 rounded-2xl px-1 py-3 text-center transition-all duration-500";

function navLinkClass({ isActive }: { isActive: boolean }) {
  return [
    navLinkBase,
    isActive
      ? "bg-white/[0.06] text-white shadow-[0_0_15px_rgba(168,85,247,0.4)] ring-1 ring-purple-500/30"
      : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200",
  ].join(" ");
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
  const showFinance =
    role === "owner" || role === "admin" || role === "super_owner" || role === "finance_analyst";
  const showIntegrationsHub = role === "owner";
  const showKpi = role === "owner" || role === "super_owner" || role === "manager" || role === "admin";

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

    async function pollNotifications() {
      if (notificationsInFlightRef.current) return;
      if (!isPageVisibleRef.current) return;
      try {
        notificationsInFlightRef.current = true;
        const [threads, myActiveTasks, createdActiveTasks, createdJournalTasks] = await Promise.all([
          canUseChatNotifications ? apiFetch<ChatThread[]>("/api/chat/threads?limit=60&offset=0") : Promise.resolve([]),
          apiFetch<TaskListResponse>("/api/tasks?scope=my&journal=false"),
          canUseTeamTasks
            ? apiFetch<TaskListResponse>("/api/tasks?scope=team&journal=false")
            : Promise.resolve({ items: [] } as TaskListResponse),
          canUseTeamTasks
            ? apiFetch<TaskListResponse>("/api/tasks?scope=team&journal=true")
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
    <div className="relative h-screen overflow-hidden bg-slate-900">
      <div
        className="pointer-events-none fixed inset-0 bg-gradient-to-br from-indigo-600/35 via-purple-600/25 to-pink-500/20"
        aria-hidden
      />
      <div
        className="pointer-events-none fixed -bottom-32 -left-32 h-[28rem] w-[28rem] rounded-full bg-purple-600/25 blur-[100px]"
        style={{ animation: "blob-float 22s ease-in-out infinite" }}
        aria-hidden
      />
      <div
        className="pointer-events-none fixed -right-24 top-0 h-[22rem] w-[22rem] rounded-full bg-indigo-500/20 blur-[90px]"
        style={{ animation: "blob-float 18s ease-in-out infinite reverse" }}
        aria-hidden
      />

      <div className="relative z-10 flex h-screen min-h-0 flex-col sm:flex-row">
        <aside className="print:hidden hidden h-screen min-h-0 w-[5.5rem] shrink-0 border-r border-slate-700/40 bg-slate-950/55 py-6 shadow-2xl backdrop-blur-xl sm:flex sm:flex-col">
          <div className="mr-2 shrink-0 flex flex-col items-center gap-1 px-1 sm:mb-6 sm:mr-0">
            <MetodiBrandMark className="h-10 w-10" />
            <span className="hidden max-w-[4.5rem] text-center text-[9px] font-medium leading-tight text-slate-500 sm:block">
              MetodiOne
            </span>
          </div>
          <nav className="no-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1.5">
            {isSuperOwner ? (
              <>
                <NavLink to="/companies" className={navLinkClass} title="Компании">
                  <GradientIconBox variant="purple" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                    <Users className="h-[18px] w-[18px]" />
                  </GradientIconBox>
                  <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Компании</span>
                </NavLink>
                {showKpi ? (
                  <NavLink to="/kpi" className={navLinkClass} title="KPI продаж">
                    <GradientIconBox variant="indigo" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                      <Target className="h-[18px] w-[18px]" />
                    </GradientIconBox>
                    <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">KPI</span>
                  </NavLink>
                ) : null}
                {showFinance ? (
                  <NavLink to="/finance" className={navLinkClass} title="Финансы">
                    <GradientIconBox variant="blue" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                      <Wallet className="h-[18px] w-[18px]" />
                    </GradientIconBox>
                    <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Финансы</span>
                  </NavLink>
                ) : null}
              </>
            ) : isManagerNav ? (
              <>
                <NavLink to="/chat" className={navLinkClass} title="Чат">
                  <GradientIconBox variant="teal" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                    <MessageCircle className="h-[18px] w-[18px]" />
                  </GradientIconBox>
                  <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Чат</span>
                </NavLink>
                <NavLink to="/booking" className={navLinkClass} title="Онлайн-записи">
                  <GradientIconBox variant="teal" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                    <Calendar className="h-[18px] w-[18px]" />
                  </GradientIconBox>
                  <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Онлайн</span>
                </NavLink>
                <NavLink to="/crm" className={navLinkClass} title="Канбан">
                  <GradientIconBox variant="indigo" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                    <LayoutDashboard className="h-[18px] w-[18px]" />
                  </GradientIconBox>
                  <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Канбан</span>
                </NavLink>
                <NavLink to="/my-leads" className={navLinkClass} title="Мои лиды">
                  <GradientIconBox variant="indigo" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                    <UserRound className="h-[18px] w-[18px]" />
                  </GradientIconBox>
                  <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Мои лиды</span>
                </NavLink>
                <NavLink to="/tasks" className={navLinkClass} title="Задачи">
                  <GradientIconBox variant="purple" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                    <CheckSquare className="h-[18px] w-[18px]" />
                  </GradientIconBox>
                  <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Задачи</span>
                </NavLink>
                {showKpi ? (
                  <NavLink to="/kpi" className={navLinkClass} title="KPI продаж">
                    <GradientIconBox variant="indigo" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                      <Target className="h-[18px] w-[18px]" />
                    </GradientIconBox>
                    <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">KPI</span>
                  </NavLink>
                ) : null}
                {role === "admin" ? (
                  <NavLink to="/finance" className={navLinkClass} title="Финансы">
                    <GradientIconBox variant="blue" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                      <Wallet className="h-[18px] w-[18px]" />
                    </GradientIconBox>
                    <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Финансы</span>
                  </NavLink>
                ) : null}
              </>
            ) : isExpert ? (
              <>
                <NavLink to="/booking" className={navLinkClass} title="Онлайн-записи">
                  <GradientIconBox variant="teal" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                    <Calendar className="h-[18px] w-[18px]" />
                  </GradientIconBox>
                  <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Онлайн</span>
                </NavLink>
                <NavLink to="/reports" className={navLinkClass} title="Отчёты">
                  <GradientIconBox variant="blue" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                    <BarChart3 className="h-[18px] w-[18px]" />
                  </GradientIconBox>
                  <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Отчёты</span>
                </NavLink>
                <NavLink to="/chat" className={navLinkClass} title="Чат">
                  <GradientIconBox variant="teal" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                    <MessageCircle className="h-[18px] w-[18px]" />
                  </GradientIconBox>
                  <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Чат</span>
                </NavLink>
                <NavLink to="/tasks" className={navLinkClass} title="Задачи">
                  <GradientIconBox variant="purple" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                    <CheckSquare className="h-[18px] w-[18px]" />
                  </GradientIconBox>
                  <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Задачи</span>
                </NavLink>
              </>
            ) : (
              <>
                <NavLink to="/app" end className={navLinkClass} title="MetodiOne">
                  <MetodiBrandMark className="h-9 w-9" />
                  <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">MetodiOne</span>
                </NavLink>
                <NavLink to="/booking" className={navLinkClass} title="Онлайн-записи">
                  <GradientIconBox variant="teal" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                    <Calendar className="h-[18px] w-[18px]" />
                  </GradientIconBox>
                  <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Онлайн</span>
                </NavLink>
                <NavLink to="/tasks" className={navLinkClass} title="Задачи">
                  <GradientIconBox variant="purple" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                    <CheckSquare className="h-[18px] w-[18px]" />
                  </GradientIconBox>
                  <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Задачи</span>
                </NavLink>
                <NavLink to="/analytics" className={navLinkClass} title="Аналитика">
                  <GradientIconBox variant="blue" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                    <BarChart3 className="h-[18px] w-[18px]" />
                  </GradientIconBox>
                  <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Аналит.</span>
                </NavLink>
                {showKpi ? (
                  <NavLink to="/kpi" className={navLinkClass} title="KPI продаж">
                    <GradientIconBox variant="indigo" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                      <Target className="h-[18px] w-[18px]" />
                    </GradientIconBox>
                    <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">KPI</span>
                  </NavLink>
                ) : null}
                <NavLink to="/finance" className={navLinkClass} title="Финансы">
                  <GradientIconBox variant="blue" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                    <Wallet className="h-[18px] w-[18px]" />
                  </GradientIconBox>
                  <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Финансы</span>
                </NavLink>
                <NavLink to="/employees" className={navLinkClass} title="Сотрудники">
                  <GradientIconBox variant="purple" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                    <Users className="h-[18px] w-[18px]" />
                  </GradientIconBox>
                  <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Сотр.</span>
                </NavLink>
                <NavLink to="/chat" className={navLinkClass} title="Чат">
                  <GradientIconBox variant="teal" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                    <MessageCircle className="h-[18px] w-[18px]" />
                  </GradientIconBox>
                  <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Чат</span>
                </NavLink>
                <NavLink to="/audit" className={navLinkClass} title="Аудит">
                  <GradientIconBox variant="blue" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                    <BarChart3 className="h-[18px] w-[18px]" />
                  </GradientIconBox>
                  <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Аудит</span>
                </NavLink>
                {showIntegrationsHub ? (
                  <NavLink to="/integrations" className={navLinkClass} title="Интеграции">
                    <GradientIconBox variant="teal" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                      <Plug className="h-[18px] w-[18px]" />
                    </GradientIconBox>
                    <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Интегр.</span>
                  </NavLink>
                ) : null}
              </>
            )}
            <button
              type="button"
              onClick={logout}
              title="Выход"
              className="mt-2 flex w-full flex-col items-center gap-2 rounded-2xl border-t border-slate-700/40 py-3 pt-4 text-slate-500 transition-all duration-500 hover:bg-white/[0.04] hover:text-slate-300"
            >
              <GradientIconBox variant="pink" className="h-9 w-9 opacity-80 [&_svg]:h-4 [&_svg]:w-4">
                <LogOut className="h-4 w-4" />
              </GradientIconBox>
              <span className="text-[10px] font-medium">Выход</span>
            </button>
          </nav>
        </aside>

        <main className="relative min-h-0 flex-1 overflow-y-auto px-3 py-4 pb-24 sm:px-10 sm:py-10 sm:pb-10 lg:px-14">
          <AppBanners />
          <Outlet />
        </main>

        <nav className="print:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-slate-700/50 bg-slate-950/95 px-2 py-2 backdrop-blur-xl sm:hidden">
          {isSuperOwner ? (
            <>
              <NavLink to="/companies" className={navLinkClass} title="Компании">
                <GradientIconBox variant="purple" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <Users className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">Компании</span>
              </NavLink>
              {showKpi ? (
                <NavLink to="/kpi" className={navLinkClass} title="KPI продаж">
                  <GradientIconBox variant="indigo" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <Target className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">KPI</span>
                </NavLink>
              ) : null}
              {showFinance ? (
                <NavLink to="/finance" className={navLinkClass} title="Финансы">
                  <GradientIconBox variant="blue" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <Wallet className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Финансы</span>
                </NavLink>
              ) : null}
              <button
                type="button"
                onClick={logout}
                className="group flex flex-col items-center gap-1 rounded-2xl px-1 py-1.5 text-center text-slate-400 transition-all duration-500 hover:bg-white/[0.04] hover:text-slate-200"
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
              <NavLink to="/crm" className={navLinkClass} title="Канбан">
                <GradientIconBox variant="indigo" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <LayoutDashboard className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">Канбан</span>
              </NavLink>
              <NavLink to="/my-leads" className={navLinkClass} title="Мои лиды">
                <GradientIconBox variant="indigo" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <UserRound className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">Лиды</span>
              </NavLink>
              <NavLink to="/booking" className={navLinkClass} title="Онлайн-записи">
                <GradientIconBox variant="teal" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <Calendar className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">Онлайн</span>
              </NavLink>
              <NavLink to="/chat" className={navLinkClass} title="Чат">
                <GradientIconBox variant="teal" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <MessageCircle className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">Чат</span>
              </NavLink>
              {showKpi ? (
                <NavLink to="/kpi" className={navLinkClass} title="KPI продаж">
                  <GradientIconBox variant="indigo" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <Target className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">KPI</span>
                </NavLink>
              ) : null}
              {role === "admin" ? (
                <NavLink to="/finance" className={navLinkClass} title="Финансы">
                  <GradientIconBox variant="blue" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <Wallet className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">Финансы</span>
                </NavLink>
              ) : null}
              <button
                type="button"
                onClick={logout}
                className="group flex flex-col items-center gap-1 rounded-2xl px-1 py-1.5 text-center text-slate-400 transition-all duration-500 hover:bg-white/[0.04] hover:text-slate-200"
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
              <NavLink to="/booking" className={navLinkClass} title="Онлайн-записи">
                <GradientIconBox variant="teal" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <Calendar className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">Онлайн</span>
              </NavLink>
              <NavLink to="/reports" className={navLinkClass} title="Отчёты">
                <GradientIconBox variant="blue" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <BarChart3 className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">Отчёты</span>
              </NavLink>
              <NavLink to="/chat" className={navLinkClass} title="Чат">
                <GradientIconBox variant="teal" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <MessageCircle className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">Чат</span>
              </NavLink>
              <NavLink to="/tasks" className={navLinkClass} title="Задачи">
                <GradientIconBox variant="purple" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <CheckSquare className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">Задачи</span>
              </NavLink>
              <button
                type="button"
                onClick={logout}
                className="group flex flex-col items-center gap-1 rounded-2xl px-1 py-1.5 text-center text-slate-400 transition-all duration-500 hover:bg-white/[0.04] hover:text-slate-200"
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
              <NavLink to="/app" end className={navLinkClass} title="MetodiOne">
                <MetodiBrandMark className="h-8 w-8" />
                <span className="text-[9px]">MetodiOne</span>
              </NavLink>
              <NavLink to="/booking" className={navLinkClass} title="Онлайн-записи">
                <GradientIconBox variant="teal" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <Calendar className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">Онлайн</span>
              </NavLink>
              {showKpi ? (
                <NavLink to="/kpi" className={navLinkClass} title="KPI продаж">
                  <GradientIconBox variant="indigo" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                    <Target className="h-4 w-4" />
                  </GradientIconBox>
                  <span className="text-[9px]">KPI</span>
                </NavLink>
              ) : null}
              <NavLink to="/finance" className={navLinkClass} title="Финансы">
                <GradientIconBox variant="blue" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <Wallet className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">Финансы</span>
              </NavLink>
              <NavLink to="/chat" className={navLinkClass} title="Чат">
                <GradientIconBox variant="teal" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <MessageCircle className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">Чат</span>
              </NavLink>
              <button
                type="button"
                onClick={logout}
                className="group flex flex-col items-center gap-1 rounded-2xl px-1 py-1.5 text-center text-slate-400 transition-all duration-500 hover:bg-white/[0.04] hover:text-slate-200"
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
