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
      toast.success("Настройки потоков сохранены");
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
    <section className="mo-section space-y-4 p-4">
      <div>
        <h2 className="lux-subheading">Потоки курсов по направлениям</h2>
        <p className="mt-1 text-sm lux-caption">
          Нумерация визитов в формате поток:день (1:1, 1:10, 2:1) для эндокринологии, неврологии и др.
        </p>
      </div>
      <label className="block text-sm lux-caption">
        Воронка
        <select
          className="mo-input mt-1 max-w-xs"
          value={pipelineId}
          onChange={(e) => setPipelineId(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">— выберите —</option>
          {(pipelinesQ.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {directionsQ.isLoading && <p className="text-sm lux-caption">Загрузка направлений…</p>}
      <div className="space-y-3">
        {directions.map((d) => (
          <DirectionRow key={d.id} direction={d} onSave={(payload) => saveMut.mutate({ directionId: d.id, ...payload })} saving={saveMut.isPending} />
        ))}
      </div>
      {!directionsQ.isLoading && directions.length === 0 && pipelineId !== "" && (
        <p className="text-sm mo-muted">Нет активных направлений в этой воронке</p>
      )}
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

  return (
    <div className="rounded-xl border border-[var(--mo-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-[var(--mo-text)]">{direction.name}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Потоки включены
        </label>
      </div>
      {enabled ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <label className="text-xs lux-caption">
            Длина потока (дней)
            <input className="mo-input mt-1" type="number" min={5} max={90} value={maxDays} onChange={(e) => setMaxDays(e.target.value)} />
          </label>
          <label className="text-xs lux-caption">
            Мин. день для нового потока
            <input className="mo-input mt-1" type="number" min={1} max={60} value={minDay} onChange={(e) => setMinDay(e.target.value)} />
          </label>
          <label className="text-xs lux-caption">
            Перерыв (дней)
            <input className="mo-input mt-1" type="number" min={1} max={60} value={gapDays} onChange={(e) => setGapDays(e.target.value)} />
          </label>
        </div>
      ) : null}
      <button
        type="button"
        className="btn-secondary mt-3 text-sm"
        disabled={saving}
        onClick={() =>
          onSave({
            course_streams_enabled: enabled,
            course_stream_max_days: Number(maxDays) || 15,
            course_stream_min_day_for_next: Number(minDay) || 10,
            course_stream_gap_days: Number(gapDays) || 10,
          })
        }
      >
        Сохранить
      </button>
    </div>
  );
}
