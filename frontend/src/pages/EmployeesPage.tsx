import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { TerminateWithLeadsWizard } from "@/components/TerminateWithLeadsWizard";
import { Pencil } from "@/components/icons";
import { PageHeader } from "@/components/ui/PageHeader";
import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeUserIdFromToken } from "@/lib/auth";
import type { Pipeline, UserRole } from "@/lib/types";

export interface Employee {
  id: number;
  email: string;
  phone: string | null;
  full_name: string | null;
  role: UserRole;
  pipeline_ids: number[];
  specialization?: string | null;
}

interface InviteResult {
  employee: Employee;
  invite_url: string;
  temp_password_sent_to_email: boolean;
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  from_email: string;
  has_password: boolean;
  public_app_url: string;
  public_api_base_url: string;
}

interface RedistributionSource {
  manager_id: number;
  manager_name: string;
  lead_count: number;
  is_active: boolean;
  role?: string | null;
}

interface RedistributionPreview {
  from_manager_id: number;
  from_manager_name: string;
  lead_count: number;
}

interface RedistributeResult {
  total: number;
  reassigned: number;
  per_manager: Record<string, number>;
}

interface UndoableRedistribution {
  audit_id: number;
  action: string;
  created_at: string;
  from_manager_id: number | null;
  from_manager_name: string;
  total_original: number;
  restorable: number;
  summary: string;
}

interface UndoRedistributionResult {
  restored: number;
  skipped: number;
  from_manager_id: number | null;
  from_manager_name: string;
}

interface PatchEmployeeContactResult {
  employee: Employee;
  email_changed: boolean;
  credentials_email_sent: boolean;
}

function roleLabel(role: UserRole): string {
  if (role === "owner") return "Владелец";
  if (role === "manager") return "Менеджер";
  if (role === "expert") return "Эксперт";
  if (role === "admin") return "Админ воронки";
  return role;
}

export function EmployeesPage() {
  const qc = useQueryClient();
  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: () => apiFetch<Employee[]>("/api/employees"),
  });
  const pipelinesQuery = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => apiFetch<Pipeline[]>("/api/pipelines"),
  });
  const smtpQuery = useQuery({
    queryKey: ["smtp-config"],
    queryFn: () => apiFetch<SmtpConfig>("/api/system/smtp"),
  });
  const [smtpTestEmail, setSmtpTestEmail] = useState("");
  const smtpTestMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true }>("/api/system/smtp/test", {
        method: "POST",
        body: JSON.stringify({ to_email: smtpTestEmail }),
      }),
    onSuccess: () => toast.success("Тестовое письмо отправлено"),
    onError: (e: Error) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<UserRole>("manager");
  const [pipelineIds, setPipelineIds] = useState<number[]>([]);
  const [expertSpecialization, setExpertSpecialization] = useState("");
  const [courseStreamsEnabled, setCourseStreamsEnabled] = useState(false);
  const [courseStreamMaxDays, setCourseStreamMaxDays] = useState(15);
  const [courseStreamMinDay, setCourseStreamMinDay] = useState(10);
  const [courseStreamGapDays, setCourseStreamGapDays] = useState(10);
  const [terminateTarget, setTerminateTarget] = useState<Employee | null>(null);
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editSpecialization, setEditSpecialization] = useState("");
  const [editPipelineIds, setEditPipelineIds] = useState<number[]>([]);

  const pipelines = pipelinesQuery.data ?? [];
  const pipelineById = useMemo(() => new Map(pipelines.map((p) => [p.id, p])), [pipelines]);

  const myUserId = useMemo(() => decodeUserIdFromToken(getStoredToken()), []);

  const activeSalesManagers = useMemo(
    () =>
      (employeesQuery.data ?? []).filter((e) => e.role === "manager" || e.role === "admin"),
    [employeesQuery.data],
  );

  /** Получатели лидов — только менеджеры (не owner/admin). */
  const activeManagersOnly = useMemo(
    () => (employeesQuery.data ?? []).filter((e) => e.role === "manager"),
    [employeesQuery.data],
  );

  const [redistributeFromId, setRedistributeFromId] = useState<number | "">("");
  const [redistributeToIds, setRedistributeToIds] = useState<number[]>([]);

  const redistributionSourcesQuery = useQuery({
    queryKey: ["leads-redistribution-sources"],
    queryFn: () => apiFetch<RedistributionSource[]>("/api/leads/redistribution/sources"),
  });

  const redistributionSources = redistributionSourcesQuery.data ?? [];
  const sourcesWithLeads = useMemo(
    () => redistributionSources.filter((s) => s.lead_count > 0),
    [redistributionSources],
  );
  const ownerAdminLeadCount = useMemo(
    () =>
      redistributionSources
        .filter((s) => s.role === "owner" || s.role === "admin")
        .reduce((acc, s) => acc + s.lead_count, 0),
    [redistributionSources],
  );

  const selectedSource = useMemo(
    () =>
      redistributeFromId === ""
        ? undefined
        : redistributionSources.find((s) => s.manager_id === redistributeFromId),
    [redistributionSources, redistributeFromId],
  );

  const redistributionPreviewQuery = useQuery({
    queryKey: ["leads-redistribution-preview", redistributeFromId],
    queryFn: () =>
      apiFetch<RedistributionPreview>(
        `/api/leads/redistribution/preview?from_manager_id=${redistributeFromId}`,
      ),
    enabled: redistributeFromId !== "",
  });

  const redistributeMutation = useMutation({
    mutationFn: () =>
      apiFetch<RedistributeResult>("/api/leads/redistribute", {
        method: "POST",
        body: JSON.stringify({
          from_manager_id: redistributeFromId,
          to_manager_ids: redistributeToIds,
        }),
      }),
    onSuccess: (r) => {
      const parts = Object.entries(r.per_manager)
        .map(([id, cnt]) => {
          const emp = activeManagersOnly.find((e) => e.id === Number(id));
          const label = emp?.full_name ?? emp?.email ?? `#${id}`;
          return `${label}: ${cnt}`;
        })
        .join(", ");
      toast.success(
        parts
          ? `Перераспределено ${r.reassigned} лид(ов). ${parts}`
          : `Перераспределено ${r.reassigned} лид(ов)`,
      );
      setRedistributeFromId("");
      setRedistributeToIds([]);
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["leads-table"] });
      void qc.invalidateQueries({ queryKey: ["leads-redistribution-sources"] });
      void qc.invalidateQueries({ queryKey: ["leads-redistribution-undoable"] });
      void qc.invalidateQueries({ queryKey: ["chat-threads"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const redistributeFromOwnersMutation = useMutation({
    mutationFn: () =>
      apiFetch<RedistributeResult>("/api/leads/redistribute-from-owners", {
        method: "POST",
        body: "{}",
      }),
    onSuccess: (r) => {
      toast.success(
        r.reassigned > 0
          ? `Снято с владельца/админов и роздано менеджерам: ${r.reassigned} лид(ов)`
          : "У владельца и админов не было закреплённых лидов",
      );
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["leads-table"] });
      void qc.invalidateQueries({ queryKey: ["leads-redistribution-sources"] });
      void qc.invalidateQueries({ queryKey: ["leads-redistribution-undoable"] });
      void qc.invalidateQueries({ queryKey: ["chat-threads"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const undoableQuery = useQuery({
    queryKey: ["leads-redistribution-undoable"],
    queryFn: () =>
      apiFetch<UndoableRedistribution[]>("/api/leads/redistribution/undoable?limit=5", {
        timeoutMs: 45_000,
      }),
    enabled: !!employeesQuery.data,
    staleTime: 30_000,
    retry: 1,
  });

  const undoRedistributionMutation = useMutation({
    mutationFn: (item: UndoableRedistribution) =>
      apiFetch<UndoRedistributionResult>("/api/leads/redistribution/undo", {
        method: "POST",
        timeoutMs: 120_000,
        body: JSON.stringify(
          item.audit_id > 0
            ? { audit_id: item.audit_id }
            : { from_manager_id: item.from_manager_id },
        ),
      }),
    onSuccess: (r) => {
      toast.success(
        r.restored > 0
          ? `Вернули только лиды раздачи: ${r.restored} → ${r.from_manager_name}${
              r.skipped ? ` (уже были не у получателей: ${r.skipped})` : ""
            }`
          : "Нечего возвращать",
      );
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["leads-table"] });
      void qc.invalidateQueries({ queryKey: ["leads-redistribution-sources"] });
      void qc.invalidateQueries({ queryKey: ["leads-redistribution-undoable"] });
      void qc.invalidateQueries({ queryKey: ["chat-threads"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function toggleRedistributeTarget(id: number) {
    setRedistributeToIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function confirmRedistribute() {
    if (redistributeFromId === "" || redistributeToIds.length === 0) {
      toast.error("Выберите менеджера-источник и хотя бы одного получателя");
      return;
    }
    const srcLabel = selectedSource?.manager_name ?? `#${redistributeFromId}`;
    const cnt =
      redistributionPreviewQuery.data?.lead_count ?? selectedSource?.lead_count ?? 0;
    if (cnt <= 0) {
      toast.error("У выбранного менеджера нет лидов для передачи");
      return;
    }
    const targets = redistributeToIds
      .map((id) => {
        const e = activeSalesManagers.find((x) => x.id === id);
        return e?.full_name ?? e?.email ?? `#${id}`;
      })
      .join(", ");
    if (
      !window.confirm(
        `Передать все ${cnt} лид(ов) от «${srcLabel}» менеджерам: ${targets}?\n\nЧат и открытые задачи по этим клиентам перейдут к новым ответственным; им придёт уведомление.`,
      )
    ) {
      return;
    }
    redistributeMutation.mutate();
  }

  function confirmTerminate(e: Employee) {
    setTerminateTarget(e);
  }

  const inviteMutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        full_name: fullName,
        email,
        phone,
        role,
        pipeline_ids: pipelineIds,
      };
      if (role === "expert") {
        payload.specialization = expertSpecialization.trim();
        payload.course_streams_enabled = courseStreamsEnabled;
        payload.course_stream_max_days = courseStreamMaxDays;
        payload.course_stream_min_day_for_next = courseStreamMinDay;
        payload.course_stream_gap_days = courseStreamGapDays;
      }
      return apiFetch<InviteResult>("/api/employees/invite", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (r) => {
      setOpen(false);
      setFullName("");
      setEmail("");
      setPhone("");
      setRole("manager");
      setPipelineIds([]);
      setExpertSpecialization("");
      setCourseStreamsEnabled(false);
      setCourseStreamMaxDays(15);
      setCourseStreamMinDay(10);
      setCourseStreamGapDays(10);
      void qc.invalidateQueries({ queryKey: ["employees"] });
      void qc.invalidateQueries({ queryKey: ["booking-specialists"] });

      toast.success("Сотрудник приглашён");
      window.prompt("Приглашение отправлено сотруднику на email:", `Invite: ${r.invite_url}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function togglePipeline(id: number) {
    setPipelineIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function openEditEmployee(e: Employee) {
    setEditEmployee(e);
    setEditFullName(e.full_name ?? "");
    setEditEmail(e.email);
    setEditPhone(e.phone ?? "");
    setEditSpecialization(e.specialization ?? "");
    setEditPipelineIds([...e.pipeline_ids]);
  }

  function toggleEditPipeline(id: number) {
    setEditPipelineIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const resendCredentialsMutation = useMutation({
    mutationFn: async (employeeId: number) =>
      apiFetch<{
        employee_id: number;
        email_sent: boolean;
        whatsapp_sent: boolean;
        detail: string;
      }>(`/api/employees/${employeeId}/resend-credentials`, { method: "POST" }),
    onSuccess: (r) => {
      toast.success(r.detail || "Логин и пароль отправлены");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveEmployeeMutation = useMutation({
    mutationFn: async () => {
      if (!editEmployee) throw new Error("Сотрудник не выбран");

      const emailChanged = editEmail.trim().toLowerCase() !== (editEmployee.email || "").trim().toLowerCase();
      const phoneChanged = editPhone.trim() !== (editEmployee.phone || "").trim();
      const nameChanged = editFullName.trim() !== (editEmployee.full_name || "").trim();
      const specChanged =
        editEmployee.role === "expert" &&
        editSpecialization.trim() !== (editEmployee.specialization || "").trim();
      const pipelinesChanged =
        canEditPipelines(editEmployee.role) &&
        (editPipelineIds.length !== editEmployee.pipeline_ids.length ||
          editPipelineIds.some((id) => !editEmployee.pipeline_ids.includes(id)));

      const profileChanged =
        emailChanged || phoneChanged || nameChanged || specChanged;

      if (!profileChanged && !pipelinesChanged) {
        throw new Error("Нет изменений");
      }

      let contactResult: PatchEmployeeContactResult | null = null;
      if (profileChanged) {
        const profileBody = JSON.stringify({
          email: editEmail.trim(),
          phone: editPhone.trim(),
          full_name: editFullName.trim(),
          ...(editEmployee.role === "expert"
            ? {
                specialization: editSpecialization.trim(),
              }
            : {}),
        });
        const profilePath = `/api/employees/${editEmployee.id}`;
        try {
          contactResult = await apiFetch<PatchEmployeeContactResult>(`${profilePath}/profile`, {
            method: "POST",
            body: profileBody,
          });
        } catch (postErr) {
          const msg = postErr instanceof Error ? postErr.message : "";
          if (msg.includes("404") || msg.includes("405") || msg.includes("HTML")) {
            contactResult = await apiFetch<PatchEmployeeContactResult>(profilePath, {
              method: "PATCH",
              body: profileBody,
            });
          } else {
            throw postErr;
          }
        }
      }

      if (pipelinesChanged) {
        if (editPipelineIds.length === 0) {
          throw new Error("Нужна хотя бы одна воронка");
        }
        const pipelinesBody = JSON.stringify({ pipeline_ids: editPipelineIds });
        const pipelinesPath = `/api/employees/${editEmployee.id}/pipelines`;
        try {
          await apiFetch<Employee>(`${pipelinesPath}/set`, {
            method: "POST",
            body: pipelinesBody,
          });
        } catch (postErr) {
          const msg = postErr instanceof Error ? postErr.message : "";
          if (msg.includes("404") || msg.includes("405") || msg.includes("HTML")) {
            await apiFetch<Employee>(pipelinesPath, {
              method: "PATCH",
              body: pipelinesBody,
            });
          } else {
            throw postErr;
          }
        }
      }

      return contactResult;
    },
    onSuccess: (contactResult) => {
      if (contactResult?.email_changed && contactResult.credentials_email_sent) {
        toast.success("Сохранено. Новый логин и пароль отправлены на email.");
      } else {
        toast.success("Данные сотрудника обновлены");
      }
      setEditEmployee(null);
      void qc.invalidateQueries({ queryKey: ["employees"] });
      void qc.invalidateQueries({ queryKey: ["booking-specialists"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function canEditPipelines(role: UserRole) {
    return role === "manager" || role === "admin" || role === "expert";
  }

  return (
    <div className="mo-fill-page relative">
      <div className="mo-admin-page-head">
        <PageHeader
          className="mb-0"
          title="Сотрудники"
          description="Приглашение создаёт логин (email/телефон) и временный пароль."
          actions={
            <button type="button" onClick={() => setOpen(true)} className="btn-primary">
              Пригласить сотрудника
            </button>
          }
        />
      </div>

      <div className="mo-fill-page-scroll space-y-5 pt-4">
      {employeesQuery.isLoading && <p className="text-sm lux-caption">Загрузка…</p>}
      {employeesQuery.isError && (
        <p className="text-sm text-[var(--mo-danger)]">{(employeesQuery.error as Error).message}</p>
      )}

      {(sourcesWithLeads.length > 0 || redistributionSourcesQuery.isLoading || activeManagersOnly.length >= 1) &&
        activeManagersOnly.length >= 1 && (
        <section className="employees-redistribute-panel">
          <h2 className="employees-redistribute-title">Перераспределение лидов</h2>
          <p className="employees-redistribute-desc">
            Забрать лиды у менеджера / владельца / админа и раздать менеджерам. Владелец и админ новые лиды
            автоматически не получают.
          </p>

          <div className="employees-redistribute-undo mt-2.5 space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2.5">
            <div>
              <p className="text-xs font-semibold text-[var(--mo-text)]">
                Вернуть только лиды своей раздачи
              </p>
              <p className="mt-0.5 text-[11px] leading-snug mo-muted">
                Откат по истории: чужие лиды других менеджеров не трогаем — возвращаются лишь те, что
                ушли в выбранном перераспределении.
              </p>
            </div>

            {undoableQuery.isLoading ? (
              <p className="text-[11px] mo-muted">Ищем раздачи, которые можно откатить…</p>
            ) : undoableQuery.isError ? (
              <p className="text-[11px] text-red-600 dark:text-red-300">
                {(undoableQuery.error as Error).message || "Не удалось загрузить список откатов"}
              </p>
            ) : (undoableQuery.data?.length ?? 0) === 0 ? (
              <p className="text-[11px] mo-muted">
                Сейчас нечего откатывать: либо раздач не было, либо эти лиды уже переназначены ещё раз.
              </p>
            ) : (
              <div className="space-y-1.5">
                {undoableQuery.data!.map((item) => (
                  <div
                    key={`${item.audit_id}-${item.from_manager_id ?? 0}-${item.created_at}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-500/25 bg-[var(--mo-surface-elevated)]/80 px-2 py-1.5"
                  >
                    <div className="min-w-0 text-xs text-[var(--mo-text)]">
                      <div className="font-medium">{item.summary}</div>
                      <div className="mo-muted">
                        {new Date(item.created_at).toLocaleString("ru-RU")}
                        {item.total_original !== item.restorable
                          ? ` · доступно ${item.restorable} из ${item.total_original}`
                          : ` · ${item.restorable} лид(ов)`}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="employees-redistribute-btn-undo shrink-0"
                      disabled={undoRedistributionMutation.isPending}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `${item.summary}?\n\nВернутся ТОЛЬКО лиды этой раздачи. Лиды, которые были у других менеджеров раньше, не затронем.`,
                          )
                        ) {
                          return;
                        }
                        undoRedistributionMutation.mutate(item);
                      }}
                    >
                      {undoRedistributionMutation.isPending ? "Возвращаем…" : "Вернуть эту раздачу"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="employees-redistribute-strip">
            <p className="min-w-0 flex-1 text-xs text-[var(--mo-text)]">
              На владельце/админах:{" "}
              <span className="font-semibold tabular-nums text-amber-800 dark:text-amber-200">
                {redistributionSourcesQuery.isLoading ? "…" : ownerAdminLeadCount}
              </span>
            </p>
            <button
              type="button"
              className="employees-redistribute-btn shrink-0"
              disabled={
                redistributeFromOwnersMutation.isPending ||
                activeManagersOnly.length < 1 ||
                (!redistributionSourcesQuery.isLoading && ownerAdminLeadCount <= 0)
              }
              onClick={() => {
                if (
                  !window.confirm(
                    `Забрать ВСЕ лиды у владельца и админов воронки и равномерно раздать ${activeManagersOnly.length} менеджерам?`,
                  )
                ) {
                  return;
                }
                redistributeFromOwnersMutation.mutate();
              }}
            >
              {redistributeFromOwnersMutation.isPending ? "Раздаём…" : "Забрать → менеджерам"}
            </button>
          </div>

          {redistributionSourcesQuery.isLoading && (
            <p className="mt-2 text-xs mo-muted">Загрузка…</p>
          )}

          <div className="mt-2.5 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="text-xs mo-muted">
              От кого
              <select
                value={redistributeFromId === "" ? "" : String(redistributeFromId)}
                onChange={(e) => {
                  const v = e.target.value;
                  setRedistributeFromId(v === "" ? "" : Number(v));
                  setRedistributeToIds([]);
                }}
                className="mo-input mt-1 w-full py-1.5 text-sm"
              >
                <option value="">— выберите —</option>
                {sourcesWithLeads.map((m) => (
                  <option key={m.manager_id} value={m.manager_id}>
                    {m.manager_name} — {m.lead_count}
                    {!m.is_active ? " · уволен" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="pb-1 text-xs mo-muted sm:text-right">
              У выбранного:{" "}
              {redistributeFromId === "" ? (
                <span>—</span>
              ) : redistributionPreviewQuery.isLoading ? (
                <span>…</span>
              ) : (
                <span className="font-semibold tabular-nums text-amber-800 dark:text-amber-200">
                  {redistributionPreviewQuery.data?.lead_count ?? selectedSource?.lead_count ?? 0}
                </span>
              )}
              {selectedSource && !selectedSource.is_active ? (
                <span className="mt-0.5 block text-[10px] text-amber-700/90 dark:text-amber-200/80">
                  Уволен — лиды ещё на нём
                </span>
              ) : null}
            </div>
          </div>

          {redistributeFromId !== "" && (
            <div className="mt-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-[var(--mo-text)]">Кому передать</span>
                <span className="text-[10px] mo-muted">поровну между отмеченными</span>
              </div>
              <div className="employees-redistribute-targets mt-1 grid gap-1 sm:grid-cols-2">
                {activeManagersOnly
                  .filter((m) => m.id !== redistributeFromId)
                  .map((m) => (
                    <label
                      key={m.id}
                      className="flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-[var(--mo-text)] hover:bg-[var(--mo-accent-soft)]"
                    >
                      <input
                        type="checkbox"
                        className="scale-90"
                        checked={redistributeToIds.includes(m.id)}
                        onChange={() => toggleRedistributeTarget(m.id)}
                      />
                      <span className="truncate">{m.full_name ?? m.email}</span>
                    </label>
                  ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={confirmRedistribute}
            disabled={
              redistributeMutation.isPending ||
              redistributeFromId === "" ||
              redistributeToIds.length === 0 ||
              (redistributionPreviewQuery.data?.lead_count ?? selectedSource?.lead_count ?? 0) <= 0
            }
            className="employees-redistribute-btn-primary mt-2.5 w-full sm:w-auto"
          >
            {redistributeMutation.isPending ? "Перераспределение…" : "Перераспределить"}
          </button>
        </section>
      )}

      <section className="mo-section space-y-3 p-3 sm:p-4">
        <h2 className="lux-heading px-1">Команда</h2>
      <div className="grid gap-3">
        {(employeesQuery.data ?? []).map((e) => {
          const pipelineNames = e.pipeline_ids.length
            ? e.pipeline_ids.map((id) => pipelineById.get(id)?.name ?? `#${id}`).join(", ")
            : "—";
          return (
          <div key={e.id} className="employee-card">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => openEditEmployee(e)}
                className="employee-edit-handle"
                title="Редактировать сотрудника"
                aria-label={`Редактировать ${e.full_name ?? e.email}`}
              >
                <Pencil className="h-4 w-4" />
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="truncate lux-subheading">{e.full_name ?? "—"}</div>
                  <span className="employee-role-badge">{roleLabel(e.role)}</span>
                </div>
                <div className="mt-1 text-sm lux-caption">
                  {e.email}
                  {e.phone ? ` · ${e.phone}` : ""}
                  {e.role === "expert" && e.specialization ? ` · ${e.specialization}` : ""}
                </div>
                <div className="mt-2 inline-flex max-w-full">
                  <span className="employee-pipelines-tag truncate">Воронки: {pipelineNames}</span>
                </div>
              </div>

              {myUserId !== null && e.id !== myUserId ? (
                <button
                  type="button"
                  onClick={() => confirmTerminate(e)}
                  disabled={terminateTarget?.id === e.id}
                  className="shrink-0 rounded-xl border border-[var(--mo-danger)]/40 bg-[var(--mo-danger)]/10 px-3 py-1.5 text-xs font-medium text-[var(--mo-danger)] transition hover:bg-[var(--mo-danger)]/20 disabled:opacity-50"
                >
                  Уволить
                </button>
              ) : null}
            </div>
          </div>
          );
        })}
        {!employeesQuery.isLoading && (employeesQuery.data ?? []).length === 0 && (
          <p className="text-sm mo-muted">Сотрудников пока нет.</p>
        )}
      </div>
      </section>

      <section className="mo-section p-5">
        <h2 className="lux-heading">SMTP / Почта</h2>
        {smtpQuery.isLoading && <p className="mt-2 text-sm lux-caption">Загрузка SMTP…</p>}
        {smtpQuery.isError && (
          <p className="mt-2 text-sm text-red-300">{(smtpQuery.error as Error).message}</p>
        )}
        {smtpQuery.data && (
          <div className="mt-3 grid gap-2 text-sm mo-muted">
            <div>
              <span className="mo-muted">HOST:</span> {smtpQuery.data.host || "—"}
            </div>
            <div>
              <span className="mo-muted">PORT:</span> {smtpQuery.data.port}
            </div>
            <div>
              <span className="mo-muted">USER:</span> {smtpQuery.data.user || "—"}
            </div>
            <div>
              <span className="mo-muted">FROM:</span> {smtpQuery.data.from_email || "—"}
            </div>
            <div>
              <span className="mo-muted">PASSWORD:</span>{" "}
              {smtpQuery.data.has_password ? "задан" : "не задан"}
            </div>
            <div>
              <span className="mo-muted">PUBLIC_APP_URL:</span>{" "}
              {smtpQuery.data.public_app_url || "—"}
            </div>
            <div>
              <span className="mo-muted">PUBLIC_API_BASE_URL (WhatsApp):</span>{" "}
              {smtpQuery.data.public_api_base_url || "— (берётся из запроса, иначе задайте в .env)"}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={smtpTestEmail}
                onChange={(e) => setSmtpTestEmail(e.target.value)}
                placeholder="email для теста"
                className="min-w-[240px] flex-1 mo-input"
              />
              <button
                type="button"
                onClick={() => smtpTestMutation.mutate()}
                disabled={smtpTestMutation.isPending}
                className="btn-secondary disabled:opacity-60"
              >
                {smtpTestMutation.isPending ? "Отправка…" : "Тестовое письмо"}
              </button>
            </div>
          </div>
        )}
      </section>
      </div>

      {terminateTarget && (
        <TerminateWithLeadsWizard
          employee={terminateTarget}
          activeManagers={activeSalesManagers}
          onClose={() => setTerminateTarget(null)}
          onDone={() => {
            setTerminateTarget(null);
            void qc.invalidateQueries({ queryKey: ["employees"] });
            void qc.invalidateQueries({ queryKey: ["booking-specialists"] });
          }}
        />
      )}

      {editEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="employee-edit-modal w-full max-w-lg rounded-2xl crm-modal-panel border p-0 shadow-2xl">
            <div className="employee-edit-modal__head">
              <div>
                <h2 className="lux-subheading">Редактировать сотрудника</h2>
                <p className="mt-1 text-xs lux-caption">
                  <span className="employee-role-badge">{roleLabel(editEmployee.role)}</span>
                </p>
              </div>
              <button type="button" onClick={() => setEditEmployee(null)} className="mo-modal-close">
                Закрыть
              </button>
            </div>

            <div className="employee-edit-modal__body space-y-4">
              <section className="employee-edit-section">
                <h3 className="employee-edit-section__title">Основное</h3>
                <label className="employee-edit-field">
                  <span>ФИО</span>
                  <input
                    value={editFullName}
                    onChange={(ev) => setEditFullName(ev.target.value)}
                    className="mo-input"
                    placeholder="Фамилия Имя"
                  />
                </label>
              </section>

              <section className="employee-edit-section">
                <h3 className="employee-edit-section__title">Контакты</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="employee-edit-field sm:col-span-2">
                    <span>Email (логин)</span>
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(ev) => setEditEmail(ev.target.value)}
                      className="mo-input"
                    />
                  </label>
                  <label className="employee-edit-field sm:col-span-2">
                    <span>Телефон</span>
                    <input
                      type="tel"
                      value={editPhone}
                      onChange={(ev) => setEditPhone(ev.target.value)}
                      className="mo-input"
                    />
                  </label>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed mo-muted">
                  При смене email на новый адрес уйдёт письмо с новым логином и паролем.
                </p>
                <button
                  type="button"
                  className="btn-secondary mt-3 w-full text-sm disabled:opacity-60"
                  disabled={resendCredentialsMutation.isPending || saveEmployeeMutation.isPending}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Сгенерировать новый пароль и отправить логин с паролем ещё раз на email и в WhatsApp сотрудника?",
                      )
                    ) {
                      return;
                    }
                    resendCredentialsMutation.mutate(editEmployee.id);
                  }}
                >
                  {resendCredentialsMutation.isPending
                    ? "Отправка…"
                    : "Отправить пароль ещё раз"}
                </button>
              </section>

              {editEmployee.role === "expert" ? (
                <section className="employee-edit-section">
                  <h3 className="employee-edit-section__title">Онлайн-запись</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="employee-edit-field sm:col-span-2">
                      <span>Специальность</span>
                      <input
                        value={editSpecialization}
                        onChange={(ev) => setEditSpecialization(ev.target.value)}
                        className="mo-input"
                        placeholder="Например: Невролог"
                      />
                    </label>
                  </div>
                </section>
              ) : null}

              {canEditPipelines(editEmployee.role) ? (
                <section className="employee-edit-section">
                  <h3 className="employee-edit-section__title">Воронки</h3>
                  <p className="mb-2 text-[11px] mo-muted">
                    Воронки, в которых сотрудник видит лиды и записи.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {pipelines.map((p) => (
                      <label key={p.id} className="employee-edit-check">
                        <input
                          type="checkbox"
                          checked={editPipelineIds.includes(p.id)}
                          onChange={() => toggleEditPipeline(p.id)}
                        />
                        <span className="truncate">{p.name}</span>
                      </label>
                    ))}
                    {pipelines.length === 0 && <div className="text-sm mo-muted">Нет воронок</div>}
                  </div>
                </section>
              ) : null}
            </div>

            <div className="employee-edit-modal__foot">
              <button
                type="button"
                onClick={() => saveEmployeeMutation.mutate()}
                disabled={
                  saveEmployeeMutation.isPending ||
                  !editFullName.trim() ||
                  !editEmail.trim() ||
                  !editPhone.trim() ||
                  (canEditPipelines(editEmployee.role) && editPipelineIds.length === 0)
                }
                className="btn-primary w-full disabled:opacity-60"
              >
                {saveEmployeeMutation.isPending ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl crm-modal-panel border p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="lux-subheading">Пригласить сотрудника</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mo-modal-close"
              >
                Закрыть
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="text-sm mo-muted">
                ФИО
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mo-input mt-1 w-full"
                />
              </label>
              <label className="text-sm mo-muted">
                Email
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mo-input mt-1 w-full"
                />
              </label>
              <label className="text-sm mo-muted">
                Телефон
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mo-input mt-1 w-full"
                />
              </label>

              <label className="text-sm mo-muted">
                Роль
                <select
                  value={role}
                  onChange={(e) => {
                    const next = e.target.value as UserRole;
                    setRole(next);
                    if (next !== "expert") {
                      setExpertSpecialization("");
                    }
                  }}
                  className="mo-input mt-1 w-full"
                >
                  <option value="owner">Владелец</option>
                  <option value="manager">Менеджер</option>
                  <option value="expert">Эксперт</option>
                  <option value="admin">Админ воронки</option>
                </select>
              </label>

              {role === "expert" && (
                <>
                  <label className="text-sm mo-muted">
                    Специальность (под ФИО в календаре)
                    <input
                      value={expertSpecialization}
                      onChange={(e) => setExpertSpecialization(e.target.value)}
                      placeholder="Например: Невролог"
                      className="mo-input mt-1 w-full placeholder:mo-muted"
                    />
                  </label>
                  <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3">
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-[var(--mo-text)]">
                      <input
                        type="checkbox"
                        checked={courseStreamsEnabled}
                        onChange={(e) => setCourseStreamsEnabled(e.target.checked)}
                        className="mt-1"
                      />
                      <span>
                        <span className="font-medium">Курсы / потоки (1:1, 1:10, 2:1)</span>
                        <span className="mt-0.5 block text-xs mo-muted">
                          Считать сеансы по потокам для 15‑дневных курсов. Настройки можно изменить в календаре записи.
                        </span>
                      </span>
                    </label>
                    {courseStreamsEnabled && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <label className="text-xs mo-muted">
                          Поток, дн.
                          <input
                            type="number"
                            min={5}
                            max={90}
                            value={courseStreamMaxDays}
                            onChange={(e) => setCourseStreamMaxDays(Number(e.target.value))}
                            className="mo-input mt-1 w-full tabular-nums"
                          />
                        </label>
                        <label className="text-xs mo-muted">
                          Мин. день
                          <input
                            type="number"
                            min={1}
                            max={60}
                            value={courseStreamMinDay}
                            onChange={(e) => setCourseStreamMinDay(Number(e.target.value))}
                            className="mo-input mt-1 w-full tabular-nums"
                          />
                        </label>
                        <label className="text-xs mo-muted">
                          Перерыв
                          <input
                            type="number"
                            min={1}
                            max={60}
                            value={courseStreamGapDays}
                            onChange={(e) => setCourseStreamGapDays(Number(e.target.value))}
                            className="mo-input mt-1 w-full tabular-nums"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-3">
                <div className="lux-subheading text-sm">Направления (воронки)</div>
                <p className="mt-1 text-[11px] mo-muted">
                  Для менеджера, админа и эксперта нужна хотя бы одна воронка. После приглашения воронки можно изменить кнопкой
                  «Воронки» в карточке сотрудника.
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {pipelines.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm text-[var(--mo-text)]">
                      <input
                        type="checkbox"
                        checked={pipelineIds.includes(p.id)}
                        onChange={() => togglePipeline(p.id)}
                      />
                      <span className="truncate">{p.name}</span>
                    </label>
                  ))}
                  {pipelines.length === 0 && <div className="text-sm mo-muted">Нет воронок</div>}
                </div>
              </div>

              <button
                type="button"
                onClick={() => inviteMutation.mutate()}
                disabled={inviteMutation.isPending}
                className="btn-primary mt-2 w-full disabled:opacity-60"
              >
                {inviteMutation.isPending ? "Добавление…" : "Добавить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

