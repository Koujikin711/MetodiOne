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
        <div className="direction-streams-table overflow-x-auto rounded-xl border border-[var(--mo-border)]">
          <div className="direction-streams-grid direction-streams-head">
            <span>Направление</span>
            <span title="Включить потоки">Поток</span>
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
        "direction-streams-grid direction-streams-row",
        enabled ? "is-enabled" : "",
      ].join(" ")}
    >
      <p className="direction-streams-name truncate">{direction.name}</p>

      <label className="direction-streams-check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="rounded border-[var(--mo-border-strong)]"
          aria-label={`Потоки: ${direction.name}`}
        />
      </label>

      <input
        className="mo-input direction-streams-num"
        type="number"
        min={5}
        max={90}
        value={maxDays}
        disabled={!enabled}
        onChange={(e) => setMaxDays(e.target.value)}
        aria-label="Длина потока, дней"
      />
      <input
        className="mo-input direction-streams-num"
        type="number"
        min={1}
        max={60}
        value={minDay}
        disabled={!enabled}
        onChange={(e) => setMinDay(e.target.value)}
        aria-label="Мин. день для нового потока"
      />
      <input
        className="mo-input direction-streams-num"
        type="number"
        min={1}
        max={60}
        value={gapDays}
        disabled={!enabled}
        onChange={(e) => setGapDays(e.target.value)}
        aria-label="Перерыв, дней"
      />

      <button
        type="button"
        className={[
          "direction-streams-save",
          dirty ? "is-dirty" : "",
        ].join(" ")}
        disabled={saving || !dirty}
        onClick={handleSave}
      >
        {dirty ? "Сохр." : "Ок"}
      </button>
    </li>
  );
}
