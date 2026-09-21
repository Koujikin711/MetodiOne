import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import { useRopContext } from "@/pages/rop/RopLayout";

type Manager = {
  user_id: number;
  full_name: string;
  email: string;
  accepts_new_leads: boolean;
  lead_count: number;
  is_online: boolean;
};

type ManagersList = { managers: Manager[] };

export function RopDistributePage() {
  const { pipelineId } = useRopContext();
  const qc = useQueryClient();
  const [fromId, setFromId] = useState<number | "">("");
  const [toId, setToId] = useState<number | "">("");
  const [leadId, setLeadId] = useState("");

  const listQuery = useQuery({
    queryKey: ["rop-managers", pipelineId],
    enabled: pipelineId != null,
    queryFn: () =>
      apiFetch<ManagersList>(`/api/rop/managers?pipeline_id=${pipelineId}`),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, accepts }: { id: number; accepts: boolean }) =>
      apiFetch(`/api/rop/managers/${id}/accepts-leads?pipeline_id=${pipelineId}`, {
        method: "PATCH",
        body: JSON.stringify({ accepts_new_leads: accepts }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rop-managers", pipelineId] });
      toast.success("Обновлено");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ reassigned?: number; total?: number }>(`/api/rop/leads/transfer-bulk`, {
        method: "POST",
        body: JSON.stringify({
          from_manager_id: Number(fromId),
          to_manager_ids: [Number(toId)],
        }),
      }),
    onSuccess: (r) => {
      toast.success(`Передано лидов: ${r.reassigned ?? 0}`);
      qc.invalidateQueries({ queryKey: ["rop-managers", pipelineId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const oneMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/rop/leads/transfer`, {
        method: "POST",
        body: JSON.stringify({
          lead_id: Number(leadId),
          to_manager_id: Number(toId),
        }),
      }),
    onSuccess: () => {
      toast.success("Лид передан");
      setLeadId("");
      qc.invalidateQueries({ queryKey: ["rop-managers", pipelineId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const managers = listQuery.data?.managers ?? [];

  if (pipelineId == null) return <p className="text-sm mo-muted">Выберите воронку</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="overflow-x-auto rounded-xl border border-[var(--mo-border)]">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="bg-[var(--mo-surface)] text-xs mo-muted">
            <tr>
              <th className="px-3 py-2">Менеджер</th>
              <th className="px-3 py-2">Лиды</th>
              <th className="px-3 py-2">Автораздача</th>
            </tr>
          </thead>
          <tbody>
            {managers.map((m) => (
              <tr key={m.user_id} className="border-t border-[var(--mo-border)]">
                <td className="px-3 py-2">
                  <div className="font-medium">{m.full_name}</div>
                  <div className="text-xs mo-muted">{m.email}</div>
                </td>
                <td className="px-3 py-2 tabular-nums">{m.lead_count}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className={[
                      "rounded-lg px-3 py-1 text-xs font-medium",
                      m.accepts_new_leads
                        ? "bg-emerald-500/15 text-emerald-700"
                        : "bg-rose-500/10 text-rose-700",
                    ].join(" ")}
                    disabled={toggleMutation.isPending}
                    onClick={() =>
                      toggleMutation.mutate({
                        id: m.user_id,
                        accepts: !m.accepts_new_leads,
                      })
                    }
                  >
                    {m.accepts_new_leads ? "Вкл" : "Выкл"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 rounded-xl border border-[var(--mo-border)] p-4 sm:grid-cols-2">
        <div>
          <h3 className="font-medium">Передать все лиды</h3>
          <p className="mt-1 text-xs mo-muted">От одного менеджера другому</p>
          <div className="mt-3 flex flex-col gap-2">
            <select
              className="mo-input"
              value={fromId}
              onChange={(e) => setFromId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">От кого</option>
              {managers.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name} ({m.lead_count})
                </option>
              ))}
            </select>
            <select
              className="mo-input"
              value={toId}
              onChange={(e) => setToId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">Кому</option>
              {managers.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="mo-btn-primary text-sm"
              disabled={!fromId || !toId || fromId === toId || bulkMutation.isPending}
              onClick={() => bulkMutation.mutate()}
            >
              Передать все
            </button>
          </div>
        </div>

        <div>
          <h3 className="font-medium">Передать один лид</h3>
          <p className="mt-1 text-xs mo-muted">ID лида → менеджер</p>
          <div className="mt-3 flex flex-col gap-2">
            <input
              className="mo-input"
              placeholder="ID лида"
              value={leadId}
              onChange={(e) => setLeadId(e.target.value.replace(/\D/g, ""))}
            />
            <select
              className="mo-input"
              value={toId}
              onChange={(e) => setToId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">Кому</option>
              {managers.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="mo-btn-primary text-sm"
              disabled={!leadId || !toId || oneMutation.isPending}
              onClick={() => oneMutation.mutate()}
            >
              Передать лид
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
