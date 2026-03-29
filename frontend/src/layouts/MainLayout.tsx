import { BarChart3, CheckSquare, LayoutDashboard, LogOut } from "@/components/icons";
import { GradientIconBox } from "@/components/GradientIconBox";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { setStoredToken } from "@/lib/api";

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

      <div className="relative z-10 flex min-h-screen">
        <aside className="flex w-[4.75rem] shrink-0 flex-col border-r border-slate-700/40 bg-slate-950/55 py-6 shadow-2xl backdrop-blur-xl sm:w-[5.5rem]">
          <div className="mb-8 flex flex-col items-center px-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-xs font-bold tracking-tight text-white shadow-lg shadow-purple-500/30">
              C
            </div>
          </div>
          <nav className="flex flex-1 flex-col gap-2 px-1.5">
            <NavLink to="/" end className={navLinkClass} title="CRM">
              <GradientIconBox variant="indigo" className="h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                <LayoutDashboard className="h-[18px] w-[18px]" />
              </GradientIconBox>
              <span className="max-w-[4rem] text-[10px] font-medium leading-tight tracking-wide">CRM</span>
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

        <main className="relative flex-1 overflow-auto px-6 py-10 sm:px-10 lg:px-14">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
