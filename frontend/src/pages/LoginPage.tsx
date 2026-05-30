import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { LayoutDashboard } from "@/components/icons";
import { apiFetch, setStoredToken } from "@/lib/api";
import { theme } from "@/lib/theme";
import type { TokenResponse, User, UserRole } from "@/lib/types";

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
    } else if (session === "company_suspended") {
      setError(
        "Доступ к вашей организации временно приостановлен администратором. Вход в CRM недоступен до возобновления работы компании.",
      );
    } else {
      setError(
        "Токен не подходит этому серверу (часто после смены SECRET_KEY на хостинге или смены адреса API). Войдите заново.",
      );
    }
  }, [searchParams, setSearchParams]);

  const mutation = useMutation({
    mutationFn: async (): Promise<{ mustChangePassword: boolean }> => {
      setError(null);
      if (mode === "login") {
        const token = await apiFetch<TokenResponse>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        setStoredToken(token.access_token);
        return { mustChangePassword: token.must_change_password === true };
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
      return { mustChangePassword: token.must_change_password === true };
    },
    onSuccess: ({ mustChangePassword }) =>
      navigate(mustChangePassword ? "/force-password" : "/app", { replace: true }),
    onError: (e: Error) => {
      const m = e.message || "";
      if (mode === "login" && (m.includes("приостановлен") || m.includes("Компания временно"))) {
        setError(
          "Доступ к вашей организации временно приостановлен администратором. Вход в CRM недоступен до возобновления работы компании.",
        );
        return;
      }
      setError(m || "Не удалось выполнить вход");
    },
  });

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-16">
      <div className="auth-gradient-bg absolute inset-0" aria-hidden />
      <div
        className="pointer-events-none absolute -right-16 bottom-0 h-80 w-80 rounded-full bg-[#2f5f85]/10 blur-[100px]"
        aria-hidden
      />

      <div className="relative z-10 w-full max-w-md">
        <div className="glass-card mb-8 flex flex-col items-center p-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#e8f0f7] text-[#2f5f85] shadow-sm">
            <LayoutDashboard className="h-8 w-8" />
          </div>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-[#1e3348]">MetodiOne</h1>
          <p className="mt-2 max-w-xs text-sm text-[#5c6b7a]">
            {mode === "login" ? "Войдите в рабочую панель" : "Создайте аккаунт для доступа"}
          </p>
        </div>

        <div className="glass-card p-8 shadow-md">
          <form
            className="space-y-5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[#5c6b7a]" htmlFor="email">
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
                className={`${theme.input} mt-2`}
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[#5c6b7a]" htmlFor="password">
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
                className={`${theme.input} mt-2`}
              />
            </div>
            {mode === "register" && (
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-[#5c6b7a]" htmlFor="role">
                  Роль
                </label>
                <select
                  id="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className={`${theme.input} mt-2`}
                >
                  <option value="manager">Менеджер</option>
                  <option value="expert">Эксперт</option>
                </select>
              </div>
            )}
            {error && (
              <p className="rounded-xl border border-[#d4a5a5] bg-[#fdf5f5] px-4 py-2 text-sm text-[#7a2e2e]">
                {error}
              </p>
            )}
            <button type="submit" disabled={mutation.isPending} className={`${theme.btnPrimary} w-full py-3.5`}>
              {mutation.isPending ? "…" : mode === "login" ? "Войти" : "Зарегистрироваться"}
            </button>
          </form>

          <button
            type="button"
            className="mt-6 w-full text-center text-sm text-[#5c6b7a] transition hover:text-[#2f5f85]"
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

        <p className="mt-8 text-center text-xs text-[#8a96a3]">Защищённый вход · JWT</p>
      </div>
    </div>
  );
}
