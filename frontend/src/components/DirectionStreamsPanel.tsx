import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import type { BookingDirection } from "@/lib/types";

export function DirectionStreamsPanel() {
  const qc = useQueryClient();
  const [pipelineId, setPipelineId] = useState<number | "">("");

  const pipelinesQ = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => apiFetch<{ id: number; name: string }[]>("/api/pipelines"),
  });

  const directionsQ = useQuery({
    queryKey: ["booking-directions", pipelineId],
    enabled: pipelineId !== "",
    queryFn: () => apiFetch<BookingDirection[]>(`/api/booking/directions?pipeline_id=${pipelineId}`),
  });

  const saveMut = useMutation({
    mutationFn: (body: {
      directionId: number;
      course_streams_enabled: boolean;
      course_stream_max_days: number;
      course_stream_min_day_for_next: number;
      course_stream_gap_days: number;
    }) =>
      apiFetch<BookingDirection>(`/api/booking/directions/${body.directionId}`, {
        method: "PATCH",
        body: JSON.stringify({
          course_streams_enabled: body.course_streams_enabled,
          course_stream_max_days: body.course_stream_max_days,
          course_stream_min_day_for_next: body.course_stream_min_day_for_next,
          course_stream_gap_days: body.course_stream_gap_days,
        }),
      }),
    onSuccess: () => {
      toast.success("Потоки сохранены");
      void qc.invalidateQueries({ queryKey: ["booking-directions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    if (pipelineId === "" && (pipelinesQ.data?.length ?? 0) > 0) {
      setPipelineId(pipelinesQ.data![0].id);
    }
  }, [pipelineId, pipelinesQ.data]);

  const directions = (directionsQ.data ?? []).filter((d) => d.is_active);

  return (
    <section className="mo-section space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--mo-text)] sm:text-base">Потоки курсов</h2>
          <p className="mt-0.5 text-[11px] leading-snug mo-muted">
            Нумерация визитов 1:1, 1:10, 2:1 — для курсов и протоколов.
          </p>
        </div>
        <label className="flex items-center gap-2 text-[11px] mo-muted">
          Воронка
          <select
            className="mo-input py-1.5 text-sm"
            value={pipelineId}
            onChange={(e) => setPipelineId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">—</option>
            {(pipelinesQ.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {directionsQ.isLoading && <p className="text-sm lux-caption">Загрузка…</p>}

      {!directionsQ.isLoading && directions.length === 0 && pipelineId !== "" && (
        <p className="text-sm mo-muted">Нет активных направлений в этой воронке</p>
      )}

      {directions.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-[var(--mo-border)]">
          <div className="hidden grid-cols-[minmax(0,1.4fr)_auto_repeat(3,4.5rem)_auto] gap-2 border-b border-[var(--mo-border)] bg-[var(--mo-surface)] px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide mo-muted sm:grid">
            <span>Направление</span>
            <span>Потоки</span>
            <span title="Длина потока, дней">Длина</span>
            <span title="Мин. день для нового потока">Мин.</span>
            <span title="Перерыв, дней">Пауза</span>
            <span />
          </div>
          <ul className="divide-y divide-[var(--mo-border)]">
            {directions.map((d) => (
              <DirectionRow
                key={d.id}
                direction={d}
                onSave={(payload) => saveMut.mutate({ directionId: d.id, ...payload })}
                saving={saveMut.isPending}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function DirectionRow({
  direction,
  onSave,
  saving,
}: {
  direction: BookingDirection;
  onSave: (body: {
    course_streams_enabled: boolean;
    course_stream_max_days: number;
    course_stream_min_day_for_next: number;
    course_stream_gap_days: number;
  }) => void;
  saving: boolean;
}) {
  const [enabled, setEnabled] = useState(Boolean(direction.course_streams_enabled));
  const [maxDays, setMaxDays] = useState(String(direction.course_stream_max_days ?? 15));
  const [minDay, setMinDay] = useState(String(direction.course_stream_min_day_for_next ?? 10));
  const [gapDays, setGapDays] = useState(String(direction.course_stream_gap_days ?? 10));

  useEffect(() => {
    setEnabled(Boolean(direction.course_streams_enabled));
    setMaxDays(String(direction.course_stream_max_days ?? 15));
    setMinDay(String(direction.course_stream_min_day_for_next ?? 10));
    setGapDays(String(direction.course_stream_gap_days ?? 10));
  }, [direction]);

  const dirty =
    enabled !== Boolean(direction.course_streams_enabled) ||
    Number(maxDays) !== (direction.course_stream_max_days ?? 15) ||
    Number(minDay) !== (direction.course_stream_min_day_for_next ?? 10) ||
    Number(gapDays) !== (direction.course_stream_gap_days ?? 10);

  function handleSave() {
    onSave({
      course_streams_enabled: enabled,
      course_stream_max_days: Number(maxDays) || 15,
      course_stream_min_day_for_next: Number(minDay) || 10,
      course_stream_gap_days: Number(gapDays) || 10,
    });
  }

  return (
    <li
      className={[
        "grid grid-cols-1 items-center gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1.4fr)_auto_repeat(3,4.5rem)_auto] sm:gap-2",
        enabled ? "bg-[var(--mo-accent-soft)]/25" : "bg-[var(--mo-surface-elevated)]",
      ].join(" ")}
    >
      <div className="flex min-w-0 items-center justify-between gap-2 sm:block">
        <p className="truncate text-sm font-medium text-[var(--mo-text)]">{direction.name}</p>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--mo-text)] sm:hidden">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="rounded border-[var(--mo-border-strong)]"
          />
          Потоки
        </label>
      </div>

      <label className="hidden items-center justify-center gap-1.5 text-xs text-[var(--mo-text)] sm:flex">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="rounded border-[var(--mo-border-strong)]"
          aria-label={`Потоки: ${direction.name}`}
        />
      </label>

      <label className="flex items-center gap-1 text-[10px] mo-muted sm:block sm:text-center">
        <span className="sm:hidden">Длина</span>
        <input
          className="mo-input w-full px-1.5 py-1 text-center text-xs tabular-nums disabled:opacity-40"
          type="number"
          min={5}
          max={90}
          value={maxDays}
          disabled={!enabled}
          onChange={(e) => setMaxDays(e.target.value)}
          aria-label="Длина потока, дней"
        />
      </label>
      <label className="flex items-center gap-1 text-[10px] mo-muted sm:block sm:text-center">
        <span className="sm:hidden">Мин.</span>
        <input
          className="mo-input w-full px-1.5 py-1 text-center text-xs tabular-nums disabled:opacity-40"
          type="number"
          min={1}
          max={60}
          value={minDay}
          disabled={!enabled}
          onChange={(e) => setMinDay(e.target.value)}
          aria-label="Мин. день для нового потока"
        />
      </label>
      <label className="flex items-center gap-1 text-[10px] mo-muted sm:block sm:text-center">
        <span className="sm:hidden">Пауза</span>
        <input
          className="mo-input w-full px-1.5 py-1 text-center text-xs tabular-nums disabled:opacity-40"
          type="number"
          min={1}
          max={60}
          value={gapDays}
          disabled={!enabled}
          onChange={(e) => setGapDays(e.target.value)}
          aria-label="Перерыв, дней"
        />
      </label>

      <div className="flex justify-end">
        <button
          type="button"
          className={[
            "rounded-lg px-2.5 py-1 text-xs font-medium transition disabled:opacity-50",
            dirty
              ? "bg-[var(--mo-accent)] text-white hover:opacity-90"
              : "border border-[var(--mo-border)] mo-muted hover:bg-[var(--mo-accent-soft)]",
          ].join(" ")}
          disabled={saving || !dirty}
          onClick={handleSave}
        >
          {dirty ? "Сохранить" : "Ок"}
        </button>
      </div>
    </li>
  );
}
