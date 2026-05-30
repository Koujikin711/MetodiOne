import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { theme } from "@/lib/theme";
import type { Employee } from "@/pages/EmployeesPage";

type Props = {
  employee: Employee;
  activeManagers: Employee[];
  onClose: () => void;
  onDone: () => void;
};

export function TerminateWithLeadsWizard({ employee, activeManagers, onClose, onDone }: Props) {
  const qc = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [toIds, setToIds] = useState<number[]>([]);

  const previewQuery = useQuery({
    queryKey: ["terminate-lead-preview", employee.id],
    queryFn: () =>
      apiFetch<{ lead_count: number }>(`/api/leads/redistribution/preview?from_manager_id=${employee.id}`),
  });

  const leadCount = previewQuery.data?.lead_count ?? 0;
  const targets = useMemo(
    () => activeManagers.filter((m) => m.id !== employee.id && (m.role === "manager" || m.role === "admin")),
    [activeManagers, employee.id],
  );

  const redistributeMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/leads/redistribute", {
        method: "POST",
        body: JSON.stringify({ from_manager_id: employee.id, to_manager_ids: toIds }),
      }),
  });

  const terminateMutation = useMutation({
    mutationFn: () => apiFetch(`/api/employees/${employee.id}`, { method: "DELETE" }),
  });

  async function finish() {
    try {
      if (leadCount > 0 && toIds.length > 0) {
        await redistributeMutation.mutateAsync();
      }
      await terminateMutation.mutateAsync();
      void qc.invalidateQueries({ queryKey: ["employees"] });
      void qc.invalidateQueries({ queryKey: ["leads-redistribution-sources"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["chat-threads"] });
      toast.success("Сотрудник уволен" + (leadCount > 0 && toIds.length ? ", лиды переданы" : ""));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  }

  const label = employee.full_name ?? employee.email;
  const busy = redistributeMutation.isPending || terminateMutation.isPending;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 p-4">
      <div className={`w-full max-w-lg ${theme.surfaceCard} p-6 shadow-2xl`}>
        <h2 className="text-lg font-semibold text-white">Увольнение: {label}</h2>

        {step === 1 && (
          <>
            <p className="mt-2 text-sm text-slate-400">
              {previewQuery.isLoading
                ? "Проверяем лиды…"
                : leadCount > 0
                  ? `У сотрудника ${leadCount} лид(ов). Рекомендуем передать их другим менеджерам до блокировки доступа.`
                  : "Активных лидов на этом сотруднике нет — можно сразу уволить."}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Отмена
              </Button>
              {leadCount > 0 ? (
                <Button onClick={() => setStep(2)} disabled={previewQuery.isLoading}>
                  Передать лиды →
                </Button>
              ) : null}
              <Button variant="danger" onClick={() => void finish()} disabled={busy || previewQuery.isLoading}>
                {busy ? "…" : "Уволить"}
              </Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p className="mt-2 text-sm text-slate-400">Выберите получателей (round-robin).</p>
            <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
              {targets.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={toIds.includes(m.id)}
                    onChange={() =>
                      setToIds((prev) =>
                        prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id],
                      )
                    }
                  />
                  {m.full_name ?? m.email}
                </label>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setStep(1)} disabled={busy}>
                Назад
              </Button>
              <Button
                variant="danger"
                onClick={() => void finish()}
                disabled={busy || toIds.length === 0}
              >
                {busy ? "…" : "Передать и уволить"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
