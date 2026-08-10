import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Pencil, Plus, Trash2 } from "@/components/icons";
import { apiFetch } from "@/lib/api";
import type { BookingDirection, Pipeline } from "@/lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function BookingDirectionsPanel({ open, onClose }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [durationMin, setDurationMin] = useState(30);
  const [pipelineId, setPipelineId] = useState<number | "">("");
  const [editing, setEditing] = useState<BookingDirection | null>(null);
  const [editName, setEditName] = useState("");
  const [editDuration, setEditDuration] = useState(30);
  const [editPipelineId, setEditPipelineId] = useState<number | "">("");

  const pipelinesQ = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => apiFetch<Pipeline[]>("/api/pipelines"),
    enabled: open,
  });

  const directionsQ = useQuery({
    queryKey: ["booking-directions-all"],
    queryFn: () => apiFetch<BookingDirection[]>("/api/booking/directions"),
    enabled: open,
  });

  const pipelines = pipelinesQ.data ?? [];
  const directions = directionsQ.data ?? [];

  useEffect(() => {
    if (!open) return;
    if (pipelineId === "" && pipelines.length > 0) {
      setPipelineId(pipelines[0].id);
    }
  }, [open, pipelineId, pipelines]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ["booking-directions"] });
    void qc.invalidateQueries({ queryKey: ["booking-directions-all"] });
    void qc.invalidateQueries({ queryKey: ["booking-specialists"] });
  }

  const createMut = useMutation({
    mutationFn: () => {
      if (pipelineId === "") throw new Error("Выберите воронку");
      return apiFetch<BookingDirection>("/api/booking/directions", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          duration_min: durationMin,
          pipeline_id: pipelineId,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Направление добавлено");
      setName("");
      setDurationMin(30);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось добавить направление"),
  });

  const patchMut = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error("Не выбрано");
      if (editPipelineId === "") throw new Error("Выберите воронку");
      const editingId = editing.id;
      return apiFetch<BookingDirection>(`/api/booking/directions/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName.trim(),
          duration_min: editDuration,
          pipeline_id: editPipelineId,
          is_active: true,
        }),
      }).then((row) => ({ row, editingId }));
    },
    onSuccess: ({ row, editingId }) => {
      if (row.id !== editingId) {
        toast.success(
          `Объединено с «${row.name}»: специалисты перенесены, дубликат убран в архив`,
        );
      } else {
        toast.success("Направление обновлено");
      }
      setEditing(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось сохранить направление"),
  });

  const archiveMut = useMutation({
    mutationFn: (id: number) =>
      apiFetch<void>(`/api/booking/directions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Направление архивировано. История записей сохранена.");
      setEditing(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось архивировать"),
  });

  const restoreMut = useMutation({
    mutationFn: (d: BookingDirection) =>
      apiFetch<BookingDirection>(`/api/booking/directions/${d.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          is_active: true,
          name: d.name.replace(/\s*\[архив #\d+\]\s*$/i, "").trim() || d.name,
        }),
      }).then((row) => ({ row, editingId: d.id })),
    onSuccess: ({ row, editingId }) => {
      if (row.id !== editingId) {
        toast.success(`Уже есть «${row.name}» — специалисты перенесены туда`);
      } else {
        toast.success("Направление восстановлено");
      }
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось восстановить"),
  });

  function startEdit(d: BookingDirection) {
    setEditing(d);
    setEditName(d.name.replace(/\s*\[архив #\d+\]\s*$/i, "").trim() || d.name);
    setEditDuration(d.duration_min);
    setEditPipelineId(d.pipeline_id ?? (pipelines[0]?.id ?? ""));
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="max-h-[min(92vh,820px)] w-full max-w-xl overflow-y-auto rounded-2xl crm-modal-panel border p-5 shadow-2xl sm:p-6"
        role="dialog"
        aria-labelledby="booking-directions-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="booking-directions-title" className="lux-subheading">
              Направления записи
            </h2>
            <p className="mt-1 text-xs mo-muted">
              Справочник для сетки и фильтров. Имена без учёта регистра уникальны: дубликаты
              («Консультация» / «консультация») объединяются, специалисты переносятся автоматически.
              Архивация скрывает направление из новых записей, историю не удаляет.
            </p>
          </div>
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <form
          className="mt-4 space-y-2 rounded-xl border border-[var(--mo-border)] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) {
              toast.error("Укажите название");
              return;
            }
            createMut.mutate();
          }}
        >
          <p className="text-sm font-medium text-[var(--mo-text)]">Добавить направление</p>
          <label className="block text-xs mo-muted">
            Название
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mo-input mt-1 w-full"
              placeholder="Например: Консультация"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs mo-muted">
              Длительность, мин
              <input
                type="number"
                min={10}
                max={480}
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
                className="mo-input mt-1 w-full"
              />
            </label>
            <label className="block text-xs mo-muted">
              Воронка
              <select
                value={pipelineId === "" ? "" : String(pipelineId)}
                onChange={(e) => setPipelineId(e.target.value ? Number(e.target.value) : "")}
                className="mo-input mt-1 w-full"
              >
                <option value="">— выберите —</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="submit"
            className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"
            disabled={createMut.isPending}
          >
            <Plus className="h-4 w-4" />
            Добавить
          </button>
        </form>

        <div className="mt-4 space-y-2">
          {directionsQ.isLoading && <p className="text-sm mo-muted">Загрузка…</p>}
          {!directionsQ.isLoading && directions.length === 0 && (
            <p className="text-sm mo-muted">Пока нет направлений — добавьте первое выше.</p>
          )}
          {directions.map((d) => (
            <div
              key={d.id}
              className={[
                "rounded-xl border px-3 py-2",
                d.is_active
                  ? "border-[var(--mo-border)] bg-[var(--mo-surface)]"
                  : "border-dashed border-[var(--mo-border)] opacity-70",
              ].join(" ")}
            >
              {editing?.id === d.id ? (
                <div className="space-y-2">
                  <label className="block text-xs mo-muted">
                    Название
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="mo-input mt-1 w-full"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-xs mo-muted">
                      Длительность, мин
                      <input
                        type="number"
                        min={10}
                        max={480}
                        value={editDuration}
                        onChange={(e) => setEditDuration(Number(e.target.value))}
                        className="mo-input mt-1 w-full"
                      />
                    </label>
                    <label className="block text-xs mo-muted">
                      Воронка
                      <select
                        value={editPipelineId === "" ? "" : String(editPipelineId)}
                        onChange={(e) => setEditPipelineId(e.target.value ? Number(e.target.value) : "")}
                        className="mo-input mt-1 w-full"
                      >
                        <option value="">— выберите —</option>
                        {pipelines.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-primary px-3 py-1.5 text-xs"
                      disabled={patchMut.isPending}
                      onClick={() => {
                        if (!editName.trim()) {
                          toast.error("Укажите название");
                          return;
                        }
                        patchMut.mutate();
                      }}
                    >
                      Сохранить
                    </button>
                    <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setEditing(null)}>
                      Отмена
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--mo-text)]">{d.name}</p>
                    <p className="text-[11px] mo-muted">
                      {d.duration_min} мин
                      {d.pipeline_name ? ` · ${d.pipeline_name}` : ""}
                      {!d.is_active ? " · архив" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="rounded-lg p-1.5 mo-muted hover:bg-[var(--mo-accent-soft)]"
                      title="Редактировать"
                      aria-label="Редактировать"
                      onClick={() => startEdit(d)}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {d.is_active ? (
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-red-500 hover:bg-red-500/10"
                        title="Архивировать"
                        aria-label="Архивировать"
                        disabled={archiveMut.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Архивировать «${d.name}»?\nЗаписи в журнале останутся, направление скроется из новых.`,
                            )
                          ) {
                            archiveMut.mutate(d.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary px-2 py-1 text-[10px]"
                        disabled={restoreMut.isPending}
                        onClick={() => restoreMut.mutate(d)}
                      >
                        Восстановить
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
