import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { LayoutDashboard } from "@/components/icons";
import { apiFetch, setStoredToken } from "@/lib/api";
import { theme } from "@/lib/theme";
import type { TokenResponse } from "@/lib/types";

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

      <div className="relative z-10 w-full max-w-md">
        <div className="glass-card mb-8 flex flex-col items-center p-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#e8f0f7] text-[#2f5f85] shadow-sm">
            <LayoutDashboard className="h-8 w-8" />
          </div>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-[#1e3348]">Смена пароля</h1>
          <p className="mt-2 max-w-sm text-sm text-[#5c6b7a]">
            По политике безопасности нужно задать новый пароль, прежде чем открывать остальные разделы.
          </p>
        </div>

        <div className="glass-card p-8 shadow-md">
          <form
            className="space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[#5c6b7a]" htmlFor="old-pw">
                Текущий пароль
              </label>
              <input
                id="old-pw"
                type="password"
                autoComplete="current-password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className={`${theme.input} mt-2`}
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[#5c6b7a]" htmlFor="new-pw">
                Новый пароль
              </label>
              <input
                id="new-pw"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={`${theme.input} mt-2`}
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[#5c6b7a]" htmlFor="new-pw2">
                Повтор нового пароля
              </label>
              <input
                id="new-pw2"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={`${theme.input} mt-2`}
              />
            </div>

            {error ? (
              <p className="rounded-xl border border-[#d4a5a5] bg-[#fdf5f5] px-3 py-2 text-sm text-[#7a2e2e]">{error}</p>
            ) : null}

            <button
              type="submit"
              disabled={mutation.isPending || !oldPassword || !newPassword || !confirm}
              className={`${theme.btnPrimary} w-full py-3.5`}
            >
              {mutation.isPending ? "Сохранение…" : "Сохранить и продолжить"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
