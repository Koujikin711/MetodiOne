import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { GradientIconBox } from "@/components/GradientIconBox";
import { LayoutDashboard } from "@/components/icons";
import { apiFetch, setStoredToken } from "@/lib/api";
import type { TokenResponse, User, UserRole } from "@/lib/types";

const inputClass =
  "mt-2 w-full rounded-xl border border-slate-600/60 bg-slate-900/80 px-4 py-3 text-sm text-slate-100 shadow-inner outline-none transition-all duration-300 placeholder:text-slate-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/50 focus:ring-offset-0";

const btnPrimary =
  "w-full rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 py-3.5 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-purple-500/30 active:scale-95 disabled:pointer-events-none disabled:opacity-50";

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [role, setRole] = useState<UserRole>("manager");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const session = searchParams.get("session");
    if (!session) return;
    setSearchParams({}, { replace: true });
    if (session === "expired") {
      setError("Сессия истекла — войдите снова.");
    } else {
      setError(
        "Токен не подходит этому серверу (часто после смены SECRET_KEY на хостинге или смены адреса API). Войдите заново.",
      );
    }
  }, [searchParams, setSearchParams]);

  const mutation = useMutation({
    mutationFn: async () => {
      setError(null);
      if (mode === "login") {
        const token = await apiFetch<TokenResponse>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        setStoredToken(token.access_token);
        return;
      }
      await apiFetch<User>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, role }),
      });
      const token = await apiFetch<TokenResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setStoredToken(token.access_token);
    },
    onSuccess: () => navigate("/", { replace: true }),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-16">
      <div className="auth-gradient-bg absolute inset-0" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -left-20 top-1/4 h-72 w-72 rounded-full bg-white/10 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-16 bottom-0 h-80 w-80 rounded-full bg-fuchsia-500/20 blur-[100px]"
        style={{ animation: "blob-float 20s ease-in-out infinite" }}
        aria-hidden
      />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-10 flex flex-col items-center text-center">
          <GradientIconBox variant="indigo" className="h-16 w-16 shadow-2xl [&_svg]:h-8 [&_svg]:w-8">
            <LayoutDashboard className="h-8 w-8" />
          </GradientIconBox>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-white drop-shadow-sm">
            MetodiOne
          </h1>
          <p className="mt-2 max-w-xs text-sm text-white/75">
            {mode === "login" ? "Войдите в рабочую панель" : "Создайте аккаунт для доступа"}
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/45 p-8 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <form
            className="space-y-5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400" htmlFor="email">
                {mode === "login" ? "Логин или email" : "Email"}
              </label>
              <input
                id="email"
                name="login"
                type={mode === "login" ? "text" : "email"}
                autoComplete={mode === "login" ? "username" : "email"}
                required
                placeholder={mode === "login" ? "Логин или email" : "name@company.com"}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400" htmlFor="password">
                Пароль
              </label>
              <input
                id="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                minLength={mode === "register" ? 8 : undefined}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </div>
            {mode === "register" && (
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400" htmlFor="role">
                  Роль
                </label>
                <select
                  id="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className={inputClass}
                >
                  <option value="manager" className="bg-slate-900">
                    Менеджер
                  </option>
                  <option value="expert" className="bg-slate-900">
                    Эксперт
                  </option>
                </select>
              </div>
            )}
            {error && (
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">
                {error}
              </p>
            )}
            <button type="submit" disabled={mutation.isPending} className={btnPrimary}>
              {mutation.isPending ? "…" : mode === "login" ? "Войти" : "Зарегистрироваться"}
            </button>
          </form>

          <button
            type="button"
            className="mt-6 w-full text-center text-sm text-white/80 transition-all duration-300 hover:scale-105 active:scale-95 hover:text-white"
            onClick={() => {
              const next = mode === "login" ? "register" : "login";
              setMode(next);
              setError(null);
              setEmail("");
              setPassword("");
            }}
          >
            {mode === "login" ? "Нет аккаунта? Регистрация" : "Уже есть аккаунт? Вход"}
          </button>
        </div>

        <p className="mt-8 text-center text-xs text-white/45">Защищённый вход · JWT</p>
      </div>
    </div>
  );
}
