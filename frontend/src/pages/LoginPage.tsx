import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { LayoutDashboard } from "@/components/icons";
import { ThemeToggle } from "@/components/ThemeToggle";
import { apiFetch, setStoredToken } from "@/lib/api";
import { theme } from "@/lib/theme";
import type { LoginCompanyChoice, TokenResponse, User, UserRole } from "@/lib/types";

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [role, setRole] = useState<UserRole>("manager");
  const [error, setError] = useState<string | null>(null);
  const [companyChoices, setCompanyChoices] = useState<LoginCompanyChoice[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);

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
        try {
          const token = await apiFetch<TokenResponse>("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({
              email,
              password,
              company_id: selectedCompanyId,
            }),
          });
          setStoredToken(token.access_token);
          await queryClient.clear();
          setCompanyChoices([]);
          return { mustChangePassword: token.must_change_password === true };
        } catch (e) {
          const err = e as Error & { status?: number; detail?: { companies?: LoginCompanyChoice[]; message?: string } };
          if (err.status === 409 && Array.isArray(err.detail?.companies) && err.detail.companies.length > 0) {
            setCompanyChoices(err.detail.companies);
            setSelectedCompanyId(err.detail.companies[0]?.company_id ?? null);
            throw new Error(err.detail.message || "Выберите пространство CRM");
          }
          throw e;
        }
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
      await queryClient.clear();
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-16 text-[var(--mo-text)]">
      <div className="absolute right-4 top-4 z-20">
        <ThemeToggle compact />
      </div>
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
          {mode === "login" ? (
            <p className="mt-2 max-w-sm text-[11px] leading-relaxed text-[#8a7f6e]">
              Клиника: <span className="font-medium">admin</span> / пароль клиники. Продажи:{" "}
              <span className="font-medium">admin</span> / D711711. Данные пространств не пересекаются.
            </p>
          ) : null}
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
                onChange={(e) => {
                  setEmail(e.target.value);
                  setCompanyChoices([]);
                  setSelectedCompanyId(null);
                }}
                className={`${theme.input} mt-2`}
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[#5c6b7a]" htmlFor="password">
                Пароль
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setCompanyChoices([]);
                  setSelectedCompanyId(null);
                }}
                className={`${theme.input} mt-2`}
              />
            </div>
            {companyChoices.length > 0 ? (
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-[#5c6b7a]" htmlFor="company">
                  Пространство CRM
                </label>
                <select
                  id="company"
                  value={selectedCompanyId ?? ""}
                  onChange={(e) => setSelectedCompanyId(Number(e.target.value))}
                  className={`${theme.input} mt-2`}
                  required
                >
                  {companyChoices.map((c) => (
                    <option key={c.company_id} value={c.company_id}>
                      {c.company_name}
                      {c.crm_mode === "sales" ? " (продажи)" : " (клиника)"}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {mode === "register" ? (
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
            ) : null}
            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            <button
              type="submit"
              disabled={mutation.isPending}
              className="w-full rounded-xl bg-[#2f5f85] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#254d6c] disabled:opacity-60"
            >
              {mutation.isPending ? "…" : mode === "login" ? "Войти" : "Зарегистрироваться"}
            </button>
          </form>
          <button
            type="button"
            className="mt-4 w-full text-center text-sm text-[#5c6b7a] underline-offset-2 hover:underline"
            onClick={() => {
              setMode((m) => (m === "login" ? "register" : "login"));
              setError(null);
              setCompanyChoices([]);
            }}
          >
            {mode === "login" ? "Нет аккаунта? Регистрация" : "Уже есть аккаунт? Войти"}
          </button>
        </div>
      </div>
    </div>
  );
}
