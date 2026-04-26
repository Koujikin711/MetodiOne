import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken, decodeUserIdFromToken } from "@/lib/auth";
import type { UserRole } from "@/lib/types";

interface EmployeeRow {
  id: number;
  email: string;
  full_name: string | null;
  role: UserRole;
}

const roleLabel: Record<UserRole, string> = {
  owner: "Владелец",
  admin: "Админ",
  manager: "Менеджер",
  expert: "Эксперт",
  finance_analyst: "Финансы",
  super_owner: "Супер-владелец",
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export function OwnerTerminateEmployeesModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const token = getStoredToken();
  const role = decodeRoleFromToken(token);
  const myId = decodeUserIdFromToken(token);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: () => apiFetch<EmployeeRow[]>("/api/employees"),
    enabled: open && role === "owner",
  });

  const selectable = useMemo(
    () => (employeesQuery.data ?? []).filter((e) => e.id !== myId),
    [employeesQuery.data, myId],
  );

  const fireMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const errors: string[] = [];
      for (const id of ids) {
        try {
          await apiFetch<undefined>(`/api/employees/${id}`, { method: "DELETE" });
        } catch (e) {
          errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (errors.length === ids.length) {
        throw new Error(`Не удалось уволить:\n${errors.join("\n")}`);
      }
      if (errors.length) {
        throw new Error(`Часть не выполнена:\n${errors.join("\n")}`);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["employees"] });
      void qc.invalidateQueries({ queryKey: ["booking-specialists"] });
    },
    onSuccess: (_, ids) => {
      setSelected(new Set());
      toast.success(ids.length === 1 ? "Сотрудник уволен" : `Уволено сотрудников: ${ids.length}`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!open) return null;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(selectable.map((e) => e.id)));
  }

  function clearAll() {
    setSelected(new Set());
  }

  function submit() {
    const ids = [...selected];
    if (ids.length === 0) {
      toast.error("Выберите хотя бы одного сотрудника");
      return;
    }
    const names = ids
      .map((id) => selectable.find((e) => e.id === id))
      .filter(Boolean)
      .map((e) => e!.full_name?.trim() || e!.email)
      .join(", ");
    if (
      !window.confirm(
        `Уволить выбранных (${ids.length}): ${names}?\n\nВход будет заблокирован, назначения по воронкам сняты. Отменить будет нельзя через эту форму.`,
      )
    ) {
      return;
    }
    fireMutation.mutate(ids);
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal
      aria-labelledby="terminate-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-hidden rounded-2xl border border-slate-600 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-700 px-5 py-4">
          <h2 id="terminate-modal-title" className="text-lg font-semibold text-white">
            Уволить сотрудников
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Отметьте одного или нескольких. Себя уволить нельзя — вы не в списке.
          </p>
        </div>

        <div className="max-h-[min(52vh,420px)] overflow-y-auto px-3 py-3">
          {role !== "owner" ? (
            <p className="px-2 text-sm text-amber-200/90">Доступно только владельцу компании.</p>
          ) : employeesQuery.isLoading ? (
            <p className="px-2 text-sm text-slate-400">Загрузка списка…</p>
          ) : employeesQuery.isError ? (
            <p className="px-2 text-sm text-red-300">{(employeesQuery.error as Error).message}</p>
          ) : selectable.length === 0 ? (
            <p className="px-2 text-sm text-slate-400">Нет других активных сотрудников для увольнения.</p>
          ) : (
            <ul className="space-y-1">
              {selectable.map((e) => (
                <li key={e.id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl px-2 py-2 hover:bg-slate-800/60">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 rounded border-slate-500"
                      checked={selected.has(e.id)}
                      onChange={() => toggle(e.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-100">
                        {e.full_name?.trim() || e.email}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {e.email} · {roleLabel[e.role] ?? e.role}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-700 px-4 py-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={selectAll}
              disabled={selectable.length === 0}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
            >
              Выбрать всех
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={selected.size === 0}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
            >
              Снять выбор
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setSelected(new Set());
                onClose();
              }}
              className="rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800/60"
            >
              Отмена
            </button>
            <button
              type="button"
              disabled={fireMutation.isPending || selected.size === 0 || role !== "owner"}
              onClick={() => submit()}
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
            >
              {fireMutation.isPending ? "Выполняется…" : `Уволить (${selected.size})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
