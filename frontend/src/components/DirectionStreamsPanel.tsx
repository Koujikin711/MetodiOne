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
      duration_min: number;
    }) =>
      apiFetch<BookingDirection>(`/api/booking/directions/${body.directionId}`, {
        method: "PATCH",
        body: JSON.stringify({
          course_streams_enabled: body.course_streams_enabled,
          course_stream_max_days: body.course_stream_max_days,
          course_stream_min_day_for_next: body.course_stream_min_day_for_next,
          course_stream_gap_days: body.course_stream_gap_days,
          duration_min: body.duration_min,
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
        <div className="min-w-0 max-w-2xl">
          <h2 className="text-sm font-semibold text-[var(--mo-text)] sm:text-base">Потоки курсов</h2>
          <p className="mt-0.5 text-[11px] leading-snug mo-muted">
            Нумерация визитов: <b className="text-[var(--mo-text)]">1:1</b> …{" "}
            <b className="text-[var(--mo-text)]">1:15</b>. После паузы без визитов — снова{" "}
            <b className="text-[var(--mo-text)]">2:1</b>.
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

      <div className="direction-streams-legend rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)] px-3 py-2 text-[11px] leading-relaxed mo-muted">
        <p>
          <b className="text-[var(--mo-text)]">День</b> — сколько приёмов в одном потоке (15 → после 1:15 будет 2:1).{" "}
          <b className="text-[var(--mo-text)]">Мин</b> — длительность сеанса у услуги (10, 15, 21, 30, 60…).{" "}
          <b className="text-[var(--mo-text)]">Пауза</b> — через сколько дней без визита снова начинать процедуру (
          <b className="text-[var(--mo-text)]">2:1</b>).
        </p>
      </div>

      {directionsQ.isLoading && <p className="text-sm lux-caption">Загрузка…</p>}

      {!directionsQ.isLoading && directions.length === 0 && pipelineId !== "" && (
        <p className="text-sm mo-muted">Нет активных направлений в этой воронке</p>
      )}

      {directions.length > 0 ? (
        <div className="direction-streams-table overflow-x-auto rounded-xl border border-[var(--mo-border)]">
          <table className="direction-streams-sheet">
            <thead>
              <tr className="direction-streams-head">
                <th scope="col">Услуга</th>
                <th scope="col" title="Включить нумерацию потоков">
                  Вкл
                </th>
                <th scope="col" title="Количество приёмов в одном потоке">
                  День
                </th>
                <th scope="col" title="Длительность сеанса, минут">
                  Мин
                </th>
                <th scope="col" title="Через сколько дней без визита снова начинать процедуру">
                  Пауза
                </th>
                <th scope="col" aria-label="Сохранить" />
              </tr>
            </thead>
            <tbody>
              {directions.map((d) => (
                <DirectionRow
                  key={d.id}
                  direction={d}
                  onSave={(payload) => saveMut.mutate({ directionId: d.id, ...payload })}
                  saving={saveMut.isPending}
                />
              ))}
            </tbody>
          </table>
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
    duration_min: number;
  }) => void;
  saving: boolean;
}) {
  const [enabled, setEnabled] = useState(Boolean(direction.course_streams_enabled));
  const [maxDays, setMaxDays] = useState(String(direction.course_stream_max_days ?? 15));
  const [durationMin, setDurationMin] = useState(String(direction.duration_min || 30));
  const [gapDays, setGapDays] = useState(String(direction.course_stream_gap_days ?? 10));

  useEffect(() => {
    setEnabled(Boolean(direction.course_streams_enabled));
    setMaxDays(String(direction.course_stream_max_days ?? 15));
    setDurationMin(String(direction.duration_min || 30));
    setGapDays(String(direction.course_stream_gap_days ?? 10));
  }, [direction]);

  const dirty =
    enabled !== Boolean(direction.course_streams_enabled) ||
    Number(maxDays) !== (direction.course_stream_max_days ?? 15) ||
    Number(durationMin) !== (direction.duration_min || 30) ||
    Number(gapDays) !== (direction.course_stream_gap_days ?? 10);

  function handleSave() {
    const days = Number(maxDays) || 15;
    onSave({
      course_streams_enabled: enabled,
      course_stream_max_days: days,
      // Порог «с какого дня» не показываем — оставляем текущий / не выше длины потока
      course_stream_min_day_for_next: Math.min(
        days,
        Math.max(1, direction.course_stream_min_day_for_next ?? 10),
      ),
      course_stream_gap_days: Number(gapDays) || 10,
      duration_min: Math.max(10, Number(durationMin) || 30),
    });
  }

  return (
    <tr className={["direction-streams-row", enabled ? "is-enabled" : ""].join(" ")}>
      <td className="direction-streams-name min-w-0">
        <p className="truncate">{direction.name}</p>
      </td>
      <td className="direction-streams-check">
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="rounded border-[var(--mo-border-strong)]"
            aria-label={`Включить потоки: ${direction.name}`}
          />
        </label>
      </td>
      <td>
        <input
          className="mo-input direction-streams-num"
          type="number"
          min={5}
          max={90}
          value={maxDays}
          disabled={!enabled}
          onChange={(e) => setMaxDays(e.target.value)}
          aria-label="День — количество приёмов в потоке"
          title="День — количество приёмов в потоке"
        />
      </td>
      <td>
        <input
          className="mo-input direction-streams-num"
          type="number"
          min={10}
          max={480}
          step={1}
          value={durationMin}
          onChange={(e) => setDurationMin(e.target.value)}
          aria-label="Мин — длительность сеанса"
          title="Мин — длительность сеанса"
        />
      </td>
      <td>
        <input
          className="mo-input direction-streams-num"
          type="number"
          min={1}
          max={60}
          value={gapDays}
          disabled={!enabled}
          onChange={(e) => setGapDays(e.target.value)}
          aria-label="Пауза — через сколько дней снова начинать"
          title="Пауза — через сколько дней без визита снова начинать процедуру"
        />
      </td>
      <td>
        <button
          type="button"
          className={["direction-streams-save", dirty ? "is-dirty" : ""].join(" ")}
          disabled={saving || !dirty}
          onClick={handleSave}
        >
          {dirty ? "Сохранить" : "Ок"}
        </button>
      </td>
    </tr>
  );
}
