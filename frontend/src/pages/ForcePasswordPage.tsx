import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { GradientIconBox } from "@/components/GradientIconBox";
import { LayoutDashboard } from "@/components/icons";
import { apiFetch, setStoredToken } from "@/lib/api";
import type { TokenResponse } from "@/lib/types";

const inputClass =
  "mt-2 w-full rounded-xl border border-slate-600/60 bg-slate-900/80 px-4 py-3 text-sm text-slate-100 shadow-inner outline-none transition-all duration-300 placeholder:text-slate-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/50 focus:ring-offset-0";

const btnPrimary =
  "w-full rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 py-3.5 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition-all duration-300 hover:scale-[1.02] hover:shadow-xl disabled:pointer-events-none disabled:opacity-50";

export function ForcePasswordPage() {
  const navigate = useNavigate();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      setError(null);
      if (newPassword.length < 8) {
        throw new Error("Новый пароль — не менее 8 символов");
      }
      if (newPassword !== confirm) {
        throw new Error("Повтор нового пароля не совпадает");
      }
      const token = await apiFetch<TokenResponse>("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
      });
      setStoredToken(token.access_token);
    },
    onSuccess: () => {
      navigate("/app", { replace: true });
    },
    onError: (e: Error) => setError(e.message || "Не удалось сменить пароль"),
  });

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-16">
      <div className="auth-gradient-bg absolute inset-0" aria-hidden />
      <div className="pointer-events-none absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" aria-hidden />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <GradientIconBox variant="indigo" className="h-16 w-16 shadow-2xl [&_svg]:h-8 [&_svg]:w-8">
            <LayoutDashboard className="h-8 w-8" />
          </GradientIconBox>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-white drop-shadow-sm">Смена пароля</h1>
          <p className="mt-2 max-w-sm text-sm text-white/75">
            По политике безопасности нужно задать новый пароль, прежде чем открывать остальные разделы.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/45 p-8 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <form
            className="space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400" htmlFor="old-pw">
                Текущий пароль
              </label>
              <input
                id="old-pw"
                type="password"
                autoComplete="current-password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400" htmlFor="new-pw">
                Новый пароль
              </label>
              <input
                id="new-pw"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400" htmlFor="new-pw2">
                Повтор нового пароля
              </label>
              <input
                id="new-pw2"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={inputClass}
              />
            </div>

            {error ? <p className="text-sm text-red-300">{error}</p> : null}

            <button
              type="submit"
              disabled={mutation.isPending || !oldPassword || !newPassword || !confirm}
              className={btnPrimary}
            >
              {mutation.isPending ? "Сохранение…" : "Сохранить и продолжить"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
