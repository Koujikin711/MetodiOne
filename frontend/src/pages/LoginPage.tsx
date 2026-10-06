import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { LayoutDashboard } from "@/components/icons";
import { ThemeToggle } from "@/components/ThemeToggle";
import { apiFetch, setStoredToken } from "@/lib/api";
import { theme } from "@/lib/theme";
import type { LoginCompanyChoice, TokenResponse, User, UserRole } from "@/lib/types";

function EyeIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 4.5 20 19.5M9.2 9.4A3 3 0 0 0 12 15a3 3 0 0 0 2.6-1.5M6.2 6.8C4.2 8.2 2.5 12 2.5 12S6 17.5 12 17.5c1.5 0 2.8-.4 4-.9M10.2 6.7C10.8 6.6 11.4 6.5 12 6.5c6 0 9.5 5.5 9.5 5.5s-.7 1.1-2 2.3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [showPassword, setShowPassword] = useState(false);
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
    mutationFn: async (creds: { email: string; password: string }): Promise<{ mustChangePassword: boolean }> => {
      setError(null);
      const loginEmail = creds.email.trim();
      const loginPassword = creds.password;
      if (mode === "login") {
        try {
          const token = await apiFetch<TokenResponse>("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({
              email: loginEmail,
              password: loginPassword,
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
        body: JSON.stringify({ email: loginEmail, password: loginPassword, role }),
      });
      const token = await apiFetch<TokenResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      setStoredToken(token.access_token);
      await queryClient.clear();
      return { mustChangePassword: token.must_change_password === true };
    },
    onSuccess: ({ mustChangePassword }) =>
      navigate(mustChangePassword ? "/force-password" : "/app", { replace: true }),
    onError: (e: Error) => {
      const m = e.message || "";
      if (m === "Incorrect login or password") {
        setError("Неверный логин или пароль");
        return;
      }
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
              <span className="font-medium">admin</span> / D711711 — только продажи и KPI, без онлайн-записи.
            </p>
          ) : null}
        </div>

        <div className="glass-card p-8 shadow-md">
          <form
            className="space-y-5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const loginEmail = String(fd.get("login") ?? emailRef.current?.value ?? "").trim();
              const loginPassword = String(fd.get("password") ?? passwordRef.current?.value ?? "");
              setEmail(loginEmail);
              setPassword(loginPassword);
              mutation.mutate({ email: loginEmail, password: loginPassword });
            }}
          >
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[#5c6b7a]" htmlFor="email">
                {mode === "login" ? "Логин или email" : "Email"}
              </label>
              <input
                ref={emailRef}
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
                onInput={(e) => setEmail(e.currentTarget.value)}
                className={`${theme.input} mt-2`}
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[#5c6b7a]" htmlFor="password">
                Пароль
              </label>
              <div className="relative mt-2">
                <input
                  ref={passwordRef}
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  required
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setCompanyChoices([]);
                    setSelectedCompanyId(null);
                  }}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                  className={`${theme.input} pr-11`}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[#5c6b7a]"
                  aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                  aria-pressed={showPassword}
                  onClick={() => {
                    setPassword(passwordRef.current?.value ?? password);
                    setShowPassword((v) => !v);
                  }}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
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
