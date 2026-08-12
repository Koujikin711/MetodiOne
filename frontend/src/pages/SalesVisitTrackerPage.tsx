import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Circle, MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import toast from "react-hot-toast";
import L from "leaflet";

import { apiFetch } from "@/lib/api";
import { useCurrentUserMe } from "@/hooks/useCurrentUserMe";

type GeoPoint = { lat: number; lon: number; accuracy_m: number | null };

type ClientSuggest = {
  lead_id: number | null;
  client_name: string;
  client_phone: string;
  enterprise_type?: string | null;
  source: string;
};

type SalesFieldVisit = {
  id: number;
  manager_name: string;
  lead_id: number | null;
  client_name: string;
  client_phone: string;
  enterprise_type: string;
  lat: string | number;
  lon: string | number;
  accuracy_m?: string | number | null;
  address?: string | null;
  note?: string | null;
  visited_at: string;
};

const DUSHANBE: [number, number] = [38.5598, 68.7738];

const markerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

function MapClickPicker({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export function SalesVisitTrackerPage() {
  const me = useCurrentUserMe();
  const qc = useQueryClient();
  const enabled = Boolean(me.data?.desk_sales_enabled);

  const [point, setPoint] = useState<GeoPoint | null>(null);
  const [managerName, setManagerName] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [leadId, setLeadId] = useState<number | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [enterpriseType, setEnterpriseType] = useState("");
  const [note, setNote] = useState("");
  const [address, setAddress] = useState("");

  useEffect(() => {
    if (me.data?.full_name || me.data?.email) {
      setManagerName((prev) => prev || (me.data?.full_name || me.data?.email || ""));
    }
  }, [me.data?.full_name, me.data?.email]);

  const visitsQuery = useQuery({
    queryKey: ["sales-visits"],
    queryFn: () => apiFetch<SalesFieldVisit[]>("/api/sales-visits?limit=80"),
    enabled,
  });

  const suggestQuery = useQuery({
    queryKey: ["sales-visit-client-suggest", clientQuery],
    queryFn: () =>
      apiFetch<ClientSuggest[]>(
        `/api/sales-visits/client-suggest?q=${encodeURIComponent(clientQuery.trim())}&limit=12`,
      ),
    enabled: enabled && clientQuery.trim().length >= 2 && leadId == null,
  });

  const mapCenter = useMemo<[number, number]>(() => {
    if (point) return [point.lat, point.lon];
    const last = visitsQuery.data?.[0];
    if (last) return [Number(last.lat), Number(last.lon)];
    return DUSHANBE;
  }, [point, visitsQuery.data]);

  function locateMe() {
    if (!navigator.geolocation) {
      toast.error("Геолокация недоступна в этом браузере");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPoint({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy ?? null,
        });
        toast.success("Локация получена");
      },
      () => toast.error("Не удалось получить геолокацию — отметьте точку на карте"),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  function pickClient(item: ClientSuggest) {
    setLeadId(item.lead_id);
    setClientName(item.client_name);
    setClientPhone(item.client_phone);
    if (item.enterprise_type) setEnterpriseType(item.enterprise_type);
    setClientQuery(item.client_name);
  }

  function clearClientPick() {
    setLeadId(null);
    setClientQuery("");
  }

  const createMutation = useMutation({
    mutationFn: () => {
      if (!point) throw new Error("Отметьте локацию на карте или нажмите «Моя геолокация»");
      return apiFetch<SalesFieldVisit>("/api/sales-visits", {
        method: "POST",
        body: JSON.stringify({
          manager_name: managerName.trim(),
          lead_id: leadId,
          client_name: clientName.trim(),
          client_phone: clientPhone.trim(),
          enterprise_type: enterpriseType.trim(),
          lat: point.lat,
          lon: point.lon,
          accuracy_m: point.accuracy_m,
          address: address.trim() || null,
          note: note.trim() || null,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Визит отмечен");
      setLeadId(null);
      setClientQuery("");
      setClientName("");
      setClientPhone("");
      setEnterpriseType("");
      setNote("");
      setAddress("");
      void qc.invalidateQueries({ queryKey: ["sales-visits"] });
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось сохранить"),
  });

  if (me.isLoading) return <p className="text-sm mo-muted">Загрузка…</p>;
  if (!enabled) {
    return (
      <div className="mo-section p-6">
        <h1 className="text-xl font-semibold text-[var(--mo-text)]">Трекер</h1>
        <p className="mt-2 text-sm mo-muted">Доступен только во втором пространстве (продажи).</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--mo-text)]">Трекер визитов</h1>
        <p className="mt-1 text-sm mo-muted">
          Отметьте точку на карте (или геолокацию), укажите ФИО менеджера и клиента — из базы или вручную
          (телефон и вид предприятия).
        </p>
      </header>

      <section className="mo-section overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--mo-border)] px-4 py-3">
          <div className="text-sm font-medium text-[var(--mo-text)]">Карта</div>
          <button
            type="button"
            onClick={locateMe}
            className="rounded-lg border border-[var(--mo-border)] px-3 py-1.5 text-xs text-[var(--mo-text)]"
          >
            Моя геолокация
          </button>
        </div>
        <div className="h-[320px] w-full sm:h-[420px]">
          <MapContainer
            // @ts-expect-error react-leaflet typings
            center={mapCenter}
            zoom={14}
            scrollWheelZoom
            className="h-full w-full"
            key={`${mapCenter[0].toFixed(4)}:${mapCenter[1].toFixed(4)}`}
          >
            <TileLayer
              // @ts-expect-error react-leaflet typings
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapClickPicker
              onPick={(lat, lon) => setPoint({ lat, lon, accuracy_m: point?.accuracy_m ?? null })}
            />
            {point ? (
              <>
                <Marker position={[point.lat, point.lon]} icon={markerIcon} />
                {point.accuracy_m ? (
                  <Circle
                    center={[point.lat, point.lon]}
                    // @ts-expect-error react-leaflet typings
                    radius={Math.min(Math.max(point.accuracy_m, 20), 400)}
                    pathOptions={{ color: "#38bdf8", fillOpacity: 0.15 }}
                  />
                ) : null}
              </>
            ) : null}
          </MapContainer>
        </div>
        <div className="px-4 py-2 text-xs mo-muted">
          {point
            ? `Точка: ${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}${
                point.accuracy_m != null ? ` · точность ~${Math.round(point.accuracy_m)} м` : ""
              }`
            : "Кликните по карте, чтобы поставить метку визита"}
        </div>
      </section>

      <section className="mo-section p-4">
        <h2 className="text-sm font-semibold text-[var(--mo-text)]">Данные визита</h2>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
        >
          <label className="text-sm sm:col-span-2">
            <span className="mo-muted">ФИО менеджера</span>
            <input
              required
              className="mo-input mt-1 w-full"
              value={managerName}
              onChange={(e) => setManagerName(e.target.value)}
            />
          </label>

          <label className="text-sm sm:col-span-2">
            <span className="mo-muted">Найти клиента в базе</span>
            <input
              className="mo-input mt-1 w-full"
              placeholder="Имя или телефон (от 2 символов)"
              value={clientQuery}
              onChange={(e) => {
                setClientQuery(e.target.value);
                if (leadId != null) {
                  setLeadId(null);
                }
              }}
            />
          </label>
          {leadId != null ? (
            <div className="sm:col-span-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
              Клиент из CRM #{leadId}
              <button type="button" className="ml-3 text-xs underline" onClick={clearClientPick}>
                сбросить и ввести вручную
              </button>
            </div>
          ) : null}
          {(suggestQuery.data?.length ?? 0) > 0 && leadId == null ? (
            <ul className="sm:col-span-2 divide-y divide-[var(--mo-border)] rounded-xl border border-[var(--mo-border)]">
              {suggestQuery.data!.map((item) => (
                <li key={`${item.lead_id}-${item.client_phone}`}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-[var(--mo-surface)]/60"
                    onClick={() => pickClient(item)}
                  >
                    <span className="font-medium text-[var(--mo-text)]">{item.client_name}</span>
                    <span className="text-xs mo-muted">{item.client_phone || "без телефона"}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <label className="text-sm">
            <span className="mo-muted">ФИО клиента</span>
            <input
              required
              className="mo-input mt-1 w-full"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mo-muted">Телефон</span>
            <input
              required
              className="mo-input mt-1 w-full"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mo-muted">Вид предприятия</span>
            <input
              required
              className="mo-input mt-1 w-full"
              placeholder="Например: аптека, клиника, магазин…"
              value={enterpriseType}
              onChange={(e) => setEnterpriseType(e.target.value)}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mo-muted">Адрес (необязательно)</span>
            <input className="mo-input mt-1 w-full" value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mo-muted">Заметка</span>
            <input className="mo-input mt-1 w-full" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={createMutation.isPending || !point}
              className="rounded-xl bg-[var(--mo-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {createMutation.isPending ? "Сохранение…" : "Отметить визит"}
            </button>
          </div>
        </form>
      </section>

      <section className="mo-section p-4">
        <h2 className="mb-3 text-sm font-semibold text-[var(--mo-text)]">Последние визиты</h2>
        {visitsQuery.isLoading ? (
          <p className="text-sm mo-muted">Загрузка…</p>
        ) : (visitsQuery.data?.length ?? 0) === 0 ? (
          <p className="text-sm lux-caption">Пока нет отметок.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs mo-muted">
                <tr>
                  <th className="px-2 py-2">Когда</th>
                  <th className="px-2 py-2">Менеджер</th>
                  <th className="px-2 py-2">Клиент</th>
                  <th className="px-2 py-2">Предприятие</th>
                  <th className="px-2 py-2">Координаты</th>
                </tr>
              </thead>
              <tbody>
                {(visitsQuery.data ?? []).map((v) => (
                  <tr key={v.id} className="border-t border-[var(--mo-border)]">
                    <td className="px-2 py-2 whitespace-nowrap">
                      {new Date(v.visited_at).toLocaleString("ru-RU")}
                    </td>
                    <td className="px-2 py-2">{v.manager_name}</td>
                    <td className="px-2 py-2">
                      <div>{v.client_name}</div>
                      <div className="text-xs mo-muted">
                        {v.client_phone}
                        {v.lead_id ? ` · CRM #${v.lead_id}` : " · вручную"}
                      </div>
                    </td>
                    <td className="px-2 py-2">{v.enterprise_type}</td>
                    <td className="px-2 py-2 tabular-nums text-xs">
                      {Number(v.lat).toFixed(5)}, {Number(v.lon).toFixed(5)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
