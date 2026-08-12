import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
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
  const [showExtra, setShowExtra] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const autoLocateTried = useRef(false);

  useEffect(() => {
    if (me.data?.full_name || me.data?.email) {
      setManagerName((prev) => prev || (me.data?.full_name || me.data?.email || ""));
    }
  }, [me.data?.full_name, me.data?.email]);

  // На телефоне сразу пробуем геолокацию — меньше тапов до метки.
  useEffect(() => {
    if (!enabled || autoLocateTried.current || !navigator.geolocation) return;
    autoLocateTried.current = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPoint({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy ?? null,
        });
      },
      () => {
        /* тихо: пользователь может тапнуть карту или «Гео» */
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  }, [enabled]);
  const visitsQuery = useQuery({
    queryKey: ["sales-visits"],
    queryFn: () => apiFetch<SalesFieldVisit[]>("/api/sales-visits?limit=80"),
    enabled,
  });

  const suggestQuery = useQuery({
    queryKey: ["sales-visit-client-suggest", clientQuery],
    queryFn: () =>
      apiFetch<ClientSuggest[]>(
        `/api/sales-visits/client-suggest?q=${encodeURIComponent(clientQuery.trim())}&limit=8`,
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
      if (!point) throw new Error("Отметьте локацию на карте или нажмите «Гео»");
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
      setShowExtra(false);
      void qc.invalidateQueries({ queryKey: ["sales-visits"] });
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось сохранить"),
  });

  if (me.isLoading) return <p className="text-sm mo-muted">Загрузка…</p>;
  if (!enabled) {
    return (
      <div className="mo-section p-4">
        <h1 className="text-lg font-semibold text-[var(--mo-text)]">Трекер</h1>
        <p className="mt-1 text-sm mo-muted">Доступен только во втором пространстве (продажи).</p>
      </div>
    );
  }

  const mapH = mapExpanded
    ? "h-[min(44vh,340px)] sm:h-[420px]"
    : "h-[min(26vh,200px)] sm:h-[380px]";

  return (
    <div className="sales-tracker-page space-y-2 pb-[5.5rem] sm:space-y-5 sm:pb-0">
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-[var(--mo-text)] sm:text-2xl">
            Трекер
          </h1>
          <p className="hidden text-sm mo-muted sm:mt-1 sm:block">
            Точка на карте + клиент (из базы или вручную).
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMapExpanded((v) => !v)}
            className="rounded-md border border-[var(--mo-border)] px-2 py-1 text-[11px] text-[var(--mo-text)] sm:hidden"
          >
            {mapExpanded ? "− карта" : "+ карта"}
          </button>
          <button
            type="button"
            onClick={locateMe}
            className="rounded-md bg-[var(--mo-accent)] px-2.5 py-1 text-[11px] font-medium text-white sm:rounded-lg sm:px-3 sm:py-1.5 sm:text-xs"
          >
            Гео
          </button>
        </div>
      </header>

      <section className="mo-section overflow-hidden !p-0">
        <div className={mapH}>
          <MapContainer
            // @ts-expect-error react-leaflet typings
            center={mapCenter}
            zoom={14}
            scrollWheelZoom
            className="h-full w-full sales-tracker-map"
            key={`${mapCenter[0].toFixed(4)}:${mapCenter[1].toFixed(4)}:${mapExpanded ? "x" : "c"}`}
          >
            <TileLayer
              // @ts-expect-error react-leaflet typings
              attribution='&copy; OpenStreetMap'
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
        <div className="flex items-center justify-between gap-2 px-2.5 py-1 text-[10px] mo-muted sm:px-3 sm:py-1.5 sm:text-[11px]">
          <span className="truncate">
            {point
              ? `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}${
                  point.accuracy_m != null ? ` · ~${Math.round(point.accuracy_m)} м` : ""
                }`
              : "Тап по карте — метка"}
          </span>
          {point ? (
            <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-200">
              ок
            </span>
          ) : null}
        </div>
      </section>

      <section className="mo-section !p-2.5 sm:!p-4">
        <h2 className="text-sm font-semibold text-[var(--mo-text)]">Данные визита</h2>
        <form
          className="mt-1.5 grid grid-cols-2 gap-1.5 sm:gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
        >
          <label className="col-span-2 text-xs sm:text-sm">
            <span className="mo-muted">Менеджер</span>
            <input
              required
              className="mo-input mt-0.5 !py-1.5 text-sm"
              value={managerName}
              onChange={(e) => setManagerName(e.target.value)}
            />
          </label>

          <label className="col-span-2 text-xs sm:text-sm">
            <span className="mo-muted">Найти в базе</span>
            <input
              className="mo-input mt-0.5 !py-1.5 text-sm"
              placeholder="Имя или телефон"
              value={clientQuery}
              onChange={(e) => {
                setClientQuery(e.target.value);
                if (leadId != null) setLeadId(null);
              }}
            />
          </label>

          {leadId != null ? (
            <div className="col-span-2 flex items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs">
              <span>CRM #{leadId}</span>
              <button type="button" className="underline" onClick={clearClientPick}>
                вручную
              </button>
            </div>
          ) : null}

          {(suggestQuery.data?.length ?? 0) > 0 && leadId == null ? (
            <ul className="col-span-2 max-h-28 overflow-y-auto divide-y divide-[var(--mo-border)] rounded-lg border border-[var(--mo-border)] sm:max-h-36">
              {suggestQuery.data!.map((item) => (
                <li key={`${item.lead_id}-${item.client_phone}`}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start px-2.5 py-1.5 text-left text-xs active:bg-[var(--mo-surface)]/60 sm:text-sm"
                    onClick={() => pickClient(item)}
                  >
                    <span className="font-medium text-[var(--mo-text)]">{item.client_name}</span>
                    <span className="mo-muted">{item.client_phone || "без телефона"}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <label className="text-xs sm:text-sm">
            <span className="mo-muted">Клиент</span>
            <input
              required
              className="mo-input mt-0.5 !py-1.5 text-sm"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </label>
          <label className="text-xs sm:text-sm">
            <span className="mo-muted">Телефон</span>
            <input
              required
              inputMode="tel"
              className="mo-input mt-0.5 !py-1.5 text-sm"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
            />
          </label>
          <label className="col-span-2 text-xs sm:text-sm">
            <span className="mo-muted">Вид предприятия</span>
            <input
              required
              className="mo-input mt-0.5 !py-1.5 text-sm"
              placeholder="Аптека, клиника…"
              value={enterpriseType}
              onChange={(e) => setEnterpriseType(e.target.value)}
            />
          </label>

          <button
            type="button"
            className="col-span-2 text-left text-[11px] font-medium text-[var(--mo-accent)] sm:hidden"
            onClick={() => setShowExtra((v) => !v)}
          >
            {showExtra ? "Скрыть адрес / заметку" : "+ Адрес и заметка"}
          </button>

          <div
            className={`col-span-2 grid grid-cols-2 gap-1.5 sm:gap-3 ${showExtra ? "" : "hidden sm:grid"}`}
          >
            <label className="text-xs sm:text-sm">
              <span className="mo-muted">Адрес</span>
              <input
                className="mo-input mt-0.5 !py-1.5 text-sm"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <label className="text-xs sm:text-sm">
              <span className="mo-muted">Заметка</span>
              <input className="mo-input mt-0.5 !py-1.5 text-sm" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>

          <div className="col-span-2">
            <button
              type="submit"
              disabled={createMutation.isPending || !point}
              className="hidden w-full rounded-xl bg-[var(--mo-accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60 sm:block sm:w-auto"
            >
              {createMutation.isPending ? "Сохранение…" : "Отметить визит"}
            </button>
          </div>
        </form>
      </section>

      {/* Sticky mobile CTA — выше компактного sales-nav */}
      <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-40 border-t border-[var(--mo-border)] bg-[var(--mo-surface-elevated)]/95 px-3 py-1.5 backdrop-blur sm:hidden">
        <button
          type="button"
          disabled={createMutation.isPending || !point}
          onClick={() => createMutation.mutate()}
          className="w-full rounded-lg bg-[var(--mo-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {!point
            ? "Сначала метка на карте"
            : createMutation.isPending
              ? "Сохранение…"
              : "Отметить визит"}
        </button>
      </div>

      <section className="mo-section !p-3 sm:!p-4">
        <h2 className="mb-2 text-sm font-semibold text-[var(--mo-text)]">Последние визиты</h2>
        {visitsQuery.isLoading ? (
          <p className="text-sm mo-muted">Загрузка…</p>
        ) : (visitsQuery.data?.length ?? 0) === 0 ? (
          <p className="text-sm lux-caption">Пока нет отметок.</p>
        ) : (
          <>
            <ul className="space-y-2 sm:hidden">
              {(visitsQuery.data ?? []).slice(0, 20).map((v) => (
                <li
                  key={v.id}
                  className="rounded-xl border border-[var(--mo-border)] px-3 py-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 font-medium text-[var(--mo-text)]">{v.client_name}</div>
                    <div className="shrink-0 mo-muted">
                      {new Date(v.visited_at).toLocaleString("ru-RU", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                  <div className="mt-0.5 mo-muted">
                    {v.client_phone}
                    {v.lead_id ? ` · #${v.lead_id}` : ""}
                  </div>
                  <div className="mt-0.5 text-[var(--mo-text)]">{v.enterprise_type}</div>
                  <div className="mt-0.5 tabular-nums mo-muted">
                    {Number(v.lat).toFixed(4)}, {Number(v.lon).toFixed(4)} · {v.manager_name}
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
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
          </>
        )}
      </section>
    </div>
  );
}
