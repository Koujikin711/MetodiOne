import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Circle, MapContainer, TileLayer, useMapEvents } from "react-leaflet";
import toast from "react-hot-toast";

import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import type { AttendanceGeofence, AttendanceMyStatus, AttendanceReport } from "@/lib/types";

type GeoPoint = { latitude: number; longitude: number; accuracy_m: number | null };

function secToHuman(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${h}ч ${m}м`;
}

function isoDate(v: Date): string {
  return v.toISOString().slice(0, 10);
}

function MiniMapPicker({
  lat,
  lon,
  radiusM,
  onPick,
}: {
  lat: number;
  lon: number;
  radiusM: number;
  onPick: (lat: number, lon: number) => void;
}) {
  function ClickHandler() {
    useMapEvents({
      click(e) {
        onPick(e.latlng.lat, e.latlng.lng);
      },
    });
    return null;
  }

  return (
    <MapContainer
      center={[lat, lon]}
      zoom={16}
      scrollWheelZoom
      className="h-48 w-full rounded-xl border border-[var(--mo-border)]"
      key={`${lat.toFixed(6)}:${lon.toFixed(6)}:${radiusM}`}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Circle center={[lat, lon]} radius={Math.max(30, radiusM)} pathOptions={{ color: "#818cf8", fillOpacity: 0.25 }} />
      <Circle center={[lat, lon]} radius={10} pathOptions={{ color: "#22d3ee", fillOpacity: 0.9 }} />
      <ClickHandler />
    </MapContainer>
  );
}

export function AttendanceTrackerPage() {
  const queryClient = useQueryClient();
  const role = decodeRoleFromToken(getStoredToken());
  const canManageGeofences = role === "owner" || role === "admin";
  const canViewReports = role === "owner" || role === "admin" || role === "manager";

  const today = useMemo(() => new Date(), []);
  const [dateFrom, setDateFrom] = useState(isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)));
  const [dateTo, setDateTo] = useState(isoDate(today));
  const [geofenceId, setGeofenceId] = useState<number | "">("");
  const [point, setPoint] = useState<GeoPoint | null>(null);
  const [trackEnabled, setTrackEnabled] = useState(false);
  const [newFence, setNewFence] = useState({
    name: "",
    address: "",
    latitude: "",
    longitude: "",
    radius_m: "120",
  });

  const geofencesQuery = useQuery({
    queryKey: ["attendance", "geofences"],
    queryFn: () => apiFetch<AttendanceGeofence[]>("/api/attendance/geofences"),
  });
  const statusQuery = useQuery({
    queryKey: ["attendance", "my-status"],
    queryFn: () => apiFetch<AttendanceMyStatus>("/api/attendance/my/status"),
    refetchInterval: 15000,
  });
  const reportQuery = useQuery({
    queryKey: ["attendance", "report", dateFrom, dateTo],
    queryFn: () => apiFetch<AttendanceReport>(`/api/attendance/report?date_from=${dateFrom}&date_to=${dateTo}`),
    enabled: canViewReports,
  });
  const selectedFenceLat = Number(newFence.latitude);
  const selectedFenceLon = Number(newFence.longitude);
  const selectedRadius = Number(newFence.radius_m);
  const mapLat = Number.isFinite(selectedFenceLat)
    ? selectedFenceLat
    : point?.latitude ?? geofencesQuery.data?.[0]?.latitude ?? 55.7558;
  const mapLon = Number.isFinite(selectedFenceLon)
    ? selectedFenceLon
    : point?.longitude ?? geofencesQuery.data?.[0]?.longitude ?? 37.6173;

  const startShiftMutation = useMutation({
    mutationFn: (payload: { geofence_id?: number | null } & GeoPoint) =>
      apiFetch("/api/attendance/shifts/start", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "my-status"] });
      toast.success("Смена начата");
    },
  });
  const endShiftMutation = useMutation({
    mutationFn: (payload: { shift_id: number } & GeoPoint) =>
      apiFetch("/api/attendance/shifts/end", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "my-status"] });
      void queryClient.invalidateQueries({ queryKey: ["attendance", "report"] });
      toast.success("Смена завершена");
    },
  });
  const pingMutation = useMutation({
    mutationFn: (payload: { geofence_id?: number | null; shift_id?: number | null } & GeoPoint) =>
      apiFetch("/api/attendance/ping", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
  });
  const createFenceMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/attendance/geofences", {
        method: "POST",
        body: JSON.stringify({
          name: newFence.name.trim(),
          address: newFence.address.trim() || null,
          latitude: Number(newFence.latitude),
          longitude: Number(newFence.longitude),
          radius_m: Number(newFence.radius_m),
          is_active: true,
        }),
      }),
    onSuccess: () => {
      setNewFence({ name: "", address: "", latitude: "", longitude: "", radius_m: "120" });
      void queryClient.invalidateQueries({ queryKey: ["attendance", "geofences"] });
      toast.success("Геозона добавлена");
    },
  });

  useEffect(() => {
    if (!trackEnabled) return;
    if (!statusQuery.data?.active_shift?.id) return;
    const timer = window.setInterval(() => {
      if (!point) return;
      if (pingMutation.isPending) return;
      void pingMutation.mutateAsync({
        shift_id: statusQuery.data?.active_shift?.id ?? null,
        geofence_id: typeof geofenceId === "number" ? geofenceId : null,
        ...point,
      });
    }, 60000);
    return () => window.clearInterval(timer);
  }, [trackEnabled, point, statusQuery.data?.active_shift?.id, geofenceId, pingMutation]);

  function readCurrentLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("Геолокация не поддерживается браузером");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPoint({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy_m: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null,
        });
      },
      () => toast.error("Не удалось получить геолокацию"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  function handleStartShift() {
    if (!point) {
      toast.error("Сначала обновите геолокацию");
      return;
    }
    void startShiftMutation.mutateAsync({
      geofence_id: typeof geofenceId === "number" ? geofenceId : null,
      ...point,
    });
  }

  function handleEndShift() {
    const shiftId = statusQuery.data?.active_shift?.id;
    if (!shiftId) return;
    if (!point) {
      toast.error("Сначала обновите геолокацию");
      return;
    }
    void endShiftMutation.mutateAsync({ shift_id: shiftId, ...point });
  }

  function setFencePoint(lat: number, lon: number) {
    setNewFence((x) => ({
      ...x,
      latitude: lat.toFixed(6),
      longitude: lon.toFixed(6),
    }));
  }

  return (
    <section className="space-y-5 text-[var(--mo-text)]">
      <div className="rounded-2xl mo-section p-5">
        <h1 className="text-2xl font-semibold">Geo-трекер присутствия</h1>
        <p className="mt-1 text-sm mo-muted">
          Контроль прихода/ухода, фиксация GPS-точек, проверка нахождения в геозоне и отчёт по отработанному времени.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl mo-section p-5">
          <h2 className="text-lg font-semibold">Моя смена</h2>
          <p className="mt-2 text-sm mo-muted">
            Сегодня: <span className="font-medium text-[var(--mo-text)]">{secToHuman(statusQuery.data?.today_total_sec ?? 0)}</span>
          </p>
          <div className="mt-3 text-sm mo-muted">
            {point ? (
              <span>
                GPS: {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)} (точность {point.accuracy_m ?? "?"}м)
              </span>
            ) : (
              <span>GPS не получен</span>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={readCurrentLocation}
              className="rounded-lg border border-[var(--mo-border)] bg-[var(--mo-accent-soft)] px-3 py-2 text-sm hover:bg-[var(--mo-accent-soft)]"
            >
              Обновить геолокацию
            </button>
            {!statusQuery.data?.active_shift ? (
              <button
                type="button"
                onClick={handleStartShift}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium hover:bg-emerald-500"
              >
                Чекин (начать смену)
              </button>
            ) : (
              <button
                type="button"
                onClick={handleEndShift}
                className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium hover:bg-rose-500"
              >
                Чекаут (закончить смену)
              </button>
            )}
          </div>
          <div className="mt-4">
            <label className="text-xs lux-caption">Рабочая геозона</label>
            <select
              className="mt-1 w-full rounded-lg mo-input px-3 py-2 text-sm"
              value={geofenceId}
              onChange={(e) => setGeofenceId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">Без привязки</option>
              {(geofencesQuery.data ?? [])
                .filter((g) => g.is_active)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.radius_m}м)
                  </option>
                ))}
            </select>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm mo-muted">
            <input
              type="checkbox"
              checked={trackEnabled}
              onChange={(e) => setTrackEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--mo-border)] bg-white"
            />
            Автопинг каждую минуту (в фоне страницы)
          </label>
        </article>

        <article className="rounded-2xl mo-section p-5">
          <h2 className="text-lg font-semibold">Геозоны компании</h2>
          <div className="mt-3 space-y-2 text-sm">
            {(geofencesQuery.data ?? []).map((g) => (
              <div key={g.id} className="rounded-lg border border-[var(--mo-border)] bg-[var(--mo-surface)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <strong>{g.name}</strong>
                  <span className={g.is_active ? "text-[#0f4c3a]" : "lux-caption"}>
                    {g.is_active ? "Активна" : "Выключена"}
                  </span>
                </div>
                <div className="mo-muted">
                  {g.address || "Без адреса"} - радиус {g.radius_m}м
                </div>
              </div>
            ))}
            {!geofencesQuery.data?.length ? <div className="lux-caption">Геозоны пока не добавлены.</div> : null}
          </div>
          {canManageGeofences ? (
            <div className="mt-4 grid gap-2">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs lux-caption">
                  <span>Кликните по карте, чтобы выбрать точку офиса</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!point) {
                        toast.error("Сначала нажмите «Обновить геолокацию» в блоке смены");
                        return;
                      }
                      setFencePoint(point.latitude, point.longitude);
                    }}
                    className="rounded-md border border-[var(--mo-border)] bg-[var(--mo-accent-soft)] px-2 py-1 text-xs text-[var(--mo-text)] hover:bg-[var(--mo-accent-soft)]"
                  >
                    Взять мою геолокацию
                  </button>
                </div>
                <MiniMapPicker
                  lat={mapLat}
                  lon={mapLon}
                  radiusM={Number.isFinite(selectedRadius) ? selectedRadius : 120}
                  onPick={setFencePoint}
                />
              </div>
              <input
                className="rounded-lg mo-input px-3 py-2 text-sm"
                placeholder="Название геозоны"
                value={newFence.name}
                onChange={(e) => setNewFence((x) => ({ ...x, name: e.target.value }))}
              />
              <input
                className="rounded-lg mo-input px-3 py-2 text-sm"
                placeholder="Адрес"
                value={newFence.address}
                onChange={(e) => setNewFence((x) => ({ ...x, address: e.target.value }))}
              />
              <div className="grid grid-cols-3 gap-2">
                <input
                  className="rounded-lg mo-input px-3 py-2 text-sm"
                  placeholder="Широта"
                  value={newFence.latitude}
                  onChange={(e) => setNewFence((x) => ({ ...x, latitude: e.target.value }))}
                />
                <input
                  className="rounded-lg mo-input px-3 py-2 text-sm"
                  placeholder="Долгота"
                  value={newFence.longitude}
                  onChange={(e) => setNewFence((x) => ({ ...x, longitude: e.target.value }))}
                />
                <input
                  className="rounded-lg mo-input px-3 py-2 text-sm"
                  placeholder="Радиус, м"
                  value={newFence.radius_m}
                  onChange={(e) => setNewFence((x) => ({ ...x, radius_m: e.target.value }))}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!newFence.name.trim() || !newFence.latitude || !newFence.longitude) {
                    toast.error("Заполните название и координаты");
                    return;
                  }
                  void createFenceMutation.mutateAsync();
                }}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium hover:bg-indigo-500"
              >
                Добавить геозону
              </button>
            </div>
          ) : null}
        </article>
      </div>

      {canViewReports ? (
        <article className="rounded-2xl mo-section p-5">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="text-xs lux-caption">С</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="mt-1 block rounded-lg mo-input px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs lux-caption">По</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="mt-1 block rounded-lg mo-input px-3 py-2 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => void reportQuery.refetch()}
              className="rounded-lg border border-[var(--mo-border)] bg-[var(--mo-accent-soft)] px-3 py-2 text-sm hover:bg-[var(--mo-accent-soft)]"
            >
              Обновить отчет
            </button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left lux-caption">
                <tr>
                  <th className="px-3 py-2">Сотрудник</th>
                  <th className="px-3 py-2">Часы</th>
                  <th className="px-3 py-2">Смены</th>
                  <th className="px-3 py-2">Подозрительные</th>
                </tr>
              </thead>
              <tbody>
                {(reportQuery.data?.employees ?? []).map((row) => (
                  <tr key={row.user_id} className="border-t border-[var(--mo-border)]">
                    <td className="px-3 py-2">
                      {row.full_name || row.email}
                      <div className="text-xs lux-caption">{row.email}</div>
                    </td>
                    <td className="px-3 py-2">{secToHuman(row.total_sec)}</td>
                    <td className="px-3 py-2">{row.shifts_count}</td>
                    <td className="px-3 py-2">{row.suspicious_events}</td>
                  </tr>
                ))}
                {!reportQuery.data?.employees?.length ? (
                  <tr>
                    <td className="px-3 py-4 lux-caption" colSpan={4}>
                      Нет данных за период.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}
    </section>
  );
}
