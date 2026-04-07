import { BarChart3, Calendar, CheckSquare, LayoutDashboard, LogOut, MessageCircle, UserRound, Users } from "@/components/icons";
import { GradientIconBox } from "@/components/GradientIconBox";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { getStoredToken, setStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";

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

export function MainLayout() {
  const navigate = useNavigate();
  const role = decodeRoleFromToken(getStoredToken());
  const isManagerNav = role === "manager" || role === "admin";
  const isExpert = role === "expert";

  function logout() {
    setStoredToken(null);
    navigate("/login", { replace: true });
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-900">
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

      <div className="relative z-10 flex min-h-screen flex-col sm:flex-row">
        <aside className="hidden w-[5.5rem] shrink-0 border-r border-slate-700/40 bg-slate-950/55 py-6 shadow-2xl backdrop-blur-xl sm:flex sm:flex-col">
          <div className="mr-2 flex flex-col items-center px-1 sm:mb-8 sm:mr-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-xs font-bold tracking-tight text-white shadow-lg shadow-purple-500/30">
              M
            </div>
          </div>
          <nav className="flex flex-1 flex-col gap-2 px-1.5">
            {isManagerNav ? (
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
                <NavLink to="/my-leads" className={navLinkClass} title="Мои лиды">
                  <GradientIconBox variant="indigo" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                    <UserRound className="h-[18px] w-[18px]" />
                  </GradientIconBox>
                  <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">Мои лиды</span>
                </NavLink>
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
              </>
            ) : (
              <>
                <NavLink to="/" end className={navLinkClass} title="MetodiOne">
                  <GradientIconBox variant="indigo" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                    <LayoutDashboard className="h-[18px] w-[18px]" />
                  </GradientIconBox>
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
              </>
            )}
          </nav>
          <div className="mt-auto border-t border-slate-700/40 px-1.5 pt-4">
            <button
              type="button"
              onClick={logout}
              title="Выход"
              className="flex w-full flex-col items-center gap-2 rounded-2xl py-3 text-slate-500 transition-all duration-500 hover:bg-white/[0.04] hover:text-slate-300"
            >
              <GradientIconBox variant="pink" className="h-9 w-9 opacity-80 [&_svg]:h-4 [&_svg]:w-4">
                <LogOut className="h-4 w-4" />
              </GradientIconBox>
              <span className="text-[10px] font-medium">Выход</span>
            </button>
          </div>
        </aside>

        <main className="relative flex-1 overflow-auto px-3 py-4 pb-24 sm:px-10 sm:py-10 sm:pb-10 lg:px-14">
          <Outlet />
        </main>

        <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-slate-700/50 bg-slate-950/95 px-2 py-2 backdrop-blur-xl sm:hidden">
          {isManagerNav ? (
            <>
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
              <NavLink to="/" end className={navLinkClass} title="MetodiOne">
                <GradientIconBox variant="indigo" className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4">
                  <LayoutDashboard className="h-4 w-4" />
                </GradientIconBox>
                <span className="text-[9px]">MetodiOne</span>
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
