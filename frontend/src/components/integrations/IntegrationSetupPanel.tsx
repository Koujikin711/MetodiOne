import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ComponentType } from "react";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import type { Integration, Pipeline, PipelineStage } from "@/lib/types";

type IntegrationProvider = "green_api" | "telegram" | "google_sheets";

function IconWhatsApp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function IconTelegram({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

function IconSheets({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        fill="#0F9D58"
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
      />
      <path fill="#87CEAC" d="M14 2v6h6" />
      <path
        fill="#F1F8E9"
        d="M8 12h8v2H8v-2zm0 3h8v2H8v-2zm0 3h5v2H8v-2z"
      />
    </svg>
  );
}

const CHANNELS: Array<{
  id: IntegrationProvider;
  title: string;
  subtitle: string;
  Icon: ComponentType<{ className?: string }>;
  ring: string;
  bg: string;
}> = [
  {
    id: "green_api",
    title: "WhatsApp",
    subtitle: "Green API",
    Icon: IconWhatsApp,
    ring: "ring-emerald-500/50 hover:border-emerald-500/40",
    bg: "bg-emerald-500/15 text-emerald-400",
  },
  {
    id: "telegram",
    title: "Telegram",
    subtitle: "Бот и webhook",
    Icon: IconTelegram,
    ring: "ring-sky-500/50 hover:border-sky-500/40",
    bg: "bg-sky-500/15 text-sky-400",
  },
  {
    id: "google_sheets",
    title: "Google Таблицы",
    subtitle: "Импорт лидов",
    Icon: IconSheets,
    ring: "ring-green-500/50 hover:border-green-500/40",
    bg: "bg-green-600/15 text-green-300",
  },
];

function IntegrationCard({
  it,
  onEdit,
  onSync,
}: {
  it: Integration;
  onEdit: () => void;
  onSync: () => void;
}) {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
  const base = apiBase && apiBase.endsWith("/") ? apiBase.slice(0, apiBase.length - 1) : apiBase;
  const hookPath = base ? `${base}/api/integrations/webhook/${it.id}` : `/api/integrations/webhook/${it.id}`;

  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 [&>svg]:h-4 [&>svg]:w-4">
            {it.provider === "green_api" && <IconWhatsApp className="text-emerald-400" />}
            {it.provider === "telegram" && <IconTelegram className="text-sky-400" />}
            {it.provider === "google_sheets" && <IconSheets className="h-6 w-6" />}
          </span>
          <div className="min-w-0 text-sm font-semibold text-slate-100">{it.name}</div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 rounded-lg border border-slate-600 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-800/50"
        >
          Изменить
        </button>
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        {it.is_active ? <span className="text-emerald-400/90">Активна</span> : <span className="text-slate-500">Выключена</span>}
        {it.has_api_token ? " · токен сохранён" : ""}
      </div>
      {it.setup_note ? <p className="mt-2 text-[11px] text-violet-200/90">{it.setup_note}</p> : null}
      {it.provider === "green_api" && (
        <div className="mt-2 text-[11px] leading-relaxed text-emerald-400/90">
          WhatsApp через Green API: лиды и чат. При сбое webhook — «Изменить» и снова «Сохранить».
        </div>
      )}
      <div className="mt-2 text-[11px] text-slate-400">
        Воронка {it.pipeline_id}, стадия {it.stage_id}
      </div>
      {it.provider === "telegram" && (
        <div className="mt-2 text-[11px] text-slate-300">
          Webhook URL:
          <div className="mt-1 break-all rounded-lg border border-slate-700 bg-slate-950/40 px-2 py-1 font-mono text-[11px] text-slate-200">
            {hookPath}?token=
            <span className="text-amber-200/90">&lt;секрет_из_формы&gt;</span>
          </div>
          {!apiBase && (
            <div className="mt-1 text-[11px] text-amber-300/90">Задайте VITE_API_BASE_URL для полного URL.</div>
          )}
        </div>
      )}
      {it.provider === "google_sheets" && (
        <div className="mt-2 space-y-2">
          <div className="text-[11px] text-slate-300">
            Таблица: {String((it.config as Record<string, unknown> | null)?.sheet_url ?? "—")}
          </div>
          <button
            type="button"
            onClick={onSync}
            className="rounded-lg border border-slate-600 px-2 py-1 text-[11px] text-slate-100 transition hover:bg-slate-800/50"
          >
            Синхронизировать сейчас
          </button>
        </div>
      )}
    </div>
  );
}

export function IntegrationSetupPanel() {
  const queryClient = useQueryClient();

  const integrationsQuery = useQuery({
    queryKey: ["integrations"],
    queryFn: () => apiFetch<Integration[]>("/api/integrations"),
  });

  const pipelinesQuery = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => apiFetch<Pipeline[]>("/api/pipelines"),
  });

  const [integrationFormOpen, setIntegrationFormOpen] = useState(false);
  const [editingIntegrationId, setEditingIntegrationId] = useState<number | null>(null);
  const [integrationName, setIntegrationName] = useState("");
  const [integrationProvider, setIntegrationProvider] = useState<IntegrationProvider>("green_api");
  const [integrationSecret, setIntegrationSecret] = useState("");
  const [integrationConfigText, setIntegrationConfigText] = useState("{}");
  const [greenInstanceId, setGreenInstanceId] = useState("");
  const [greenApiToken, setGreenApiToken] = useState("");
  const [greenApiBaseUrl, setGreenApiBaseUrl] = useState("");
  const [sheetsUrl, setSheetsUrl] = useState("");
  const [sheetsTabName, setSheetsTabName] = useState("");
  const [sheetsNameColumn, setSheetsNameColumn] = useState("full_name");
  const [sheetsPhoneColumn, setSheetsPhoneColumn] = useState("phone_number");
  const [sheetsEmailColumn, setSheetsEmailColumn] = useState("email");
  const [sheetsHeaderRow, setSheetsHeaderRow] = useState("1");
  const [sheetsStartRow, setSheetsStartRow] = useState("2");
  const [integrationPipelineId, setIntegrationPipelineId] = useState<number | null>(null);
  const [integrationStageId, setIntegrationStageId] = useState<number | null>(null);
  const [integrationCloseDealEnabled, setIntegrationCloseDealEnabled] = useState(false);
  const [tplGreeting, setTplGreeting] = useState("");
  const [tplConfirm, setTplConfirm] = useState("");
  const [tplReminder24h, setTplReminder24h] = useState("");
  const [tplReminder2h, setTplReminder2h] = useState("");
  const [tplReactivation, setTplReactivation] = useState("");

  function resetIntegrationForm(provider: IntegrationProvider = "green_api") {
    setEditingIntegrationId(null);
    setIntegrationName("");
    setIntegrationProvider(provider);
    setIntegrationSecret("");
    setIntegrationConfigText("{}");
    setGreenInstanceId("");
    setGreenApiToken("");
    setGreenApiBaseUrl("");
    setSheetsUrl("");
    setSheetsTabName("");
    setSheetsNameColumn("full_name");
    setSheetsPhoneColumn("phone_number");
    setSheetsEmailColumn("email");
    setSheetsHeaderRow("1");
    setSheetsStartRow("2");
    setIntegrationPipelineId(null);
    setIntegrationStageId(null);
    setTplGreeting("");
    setTplConfirm("");
    setTplReminder24h("");
    setTplReminder2h("");
    setTplReactivation("");
    setIntegrationCloseDealEnabled(false);
  }

  function beginEditIntegration(it: Integration) {
    setIntegrationFormOpen(true);
    setEditingIntegrationId(it.id);
    setIntegrationName(it.name);
    setIntegrationProvider(
      it.provider === "telegram" ? "telegram" : it.provider === "google_sheets" ? "google_sheets" : "green_api",
    );
    setIntegrationPipelineId(it.pipeline_id);
    setIntegrationStageId(it.stage_id);
    setIntegrationCloseDealEnabled(Boolean(it.manager_close_deal_enabled));
    setIntegrationSecret("");
    if (it.provider === "telegram") {
      setIntegrationConfigText(JSON.stringify(it.config ?? {}, null, 2));
      setGreenInstanceId("");
      setGreenApiToken("");
      setGreenApiBaseUrl("");
      setSheetsUrl("");
      setSheetsTabName("");
      setSheetsNameColumn("full_name");
      setSheetsPhoneColumn("phone_number");
      setSheetsEmailColumn("email");
      setSheetsHeaderRow("1");
      setSheetsStartRow("2");
    } else if (it.provider === "google_sheets") {
      const c = it.config as Record<string, unknown> | null;
      setSheetsUrl(String(c?.sheet_url ?? c?.spreadsheet_id ?? ""));
      setSheetsTabName(typeof c?.sheet_name === "string" ? c.sheet_name : "");
      setSheetsNameColumn(typeof c?.full_name_column === "string" ? c.full_name_column : "full_name");
      setSheetsPhoneColumn(typeof c?.phone_column === "string" ? c.phone_column : "phone_number");
      setSheetsEmailColumn(typeof c?.email_column === "string" ? c.email_column : "email");
      setSheetsHeaderRow(String(c?.header_row ?? 1));
      setSheetsStartRow(String(c?.start_row ?? 2));
      setIntegrationConfigText("{}");
      setGreenInstanceId("");
      setGreenApiToken("");
      setGreenApiBaseUrl("");
    } else {
      const c = it.config as Record<string, unknown> | null;
      const rawId = c?.instance_id ?? c?.instanceId;
      const iid = rawId != null && rawId !== "" ? String(rawId) : "";
      setGreenInstanceId(iid);
      setGreenApiToken("");
      const ab =
        typeof c?.api_base_url === "string"
          ? c.api_base_url
          : typeof c?.apiUrl === "string"
            ? c.apiUrl
            : "";
      setGreenApiBaseUrl(ab);
      setSheetsUrl("");
      setSheetsTabName("");
      setSheetsNameColumn("full_name");
      setSheetsPhoneColumn("phone_number");
      setSheetsEmailColumn("email");
      setSheetsHeaderRow("1");
      setSheetsStartRow("2");
    }
    const c = (it.config ?? {}) as Record<string, unknown>;
    const templates =
      c.templates && typeof c.templates === "object" ? (c.templates as Record<string, unknown>) : {};
    const pick = (k: string) => (typeof templates[k] === "string" ? String(templates[k]) : "");
    setTplGreeting(pick("greeting"));
    setTplConfirm(pick("confirm"));
    setTplReminder24h(pick("reminder_24h"));
    setTplReminder2h(pick("reminder_2h"));
    setTplReactivation(pick("reactivation"));
  }

  const integrationStagesQuery = useQuery({
    queryKey: ["stages", "integrations-hub", integrationPipelineId],
    queryFn: () =>
      integrationPipelineId
        ? apiFetch<PipelineStage[]>(`/api/stages?pipeline_id=${integrationPipelineId}`)
        : apiFetch<PipelineStage[]>("/api/stages"),
    enabled: integrationFormOpen,
  });

  useEffect(() => {
    if (!integrationFormOpen) return;
    if (integrationPipelineId != null) return;
    const first = pipelinesQuery.data?.[0];
    if (first) setIntegrationPipelineId(first.id);
  }, [integrationFormOpen, integrationPipelineId, pipelinesQuery.data]);

  useEffect(() => {
    if (!integrationFormOpen) return;
    const st = integrationStagesQuery.data;
    if (!st || st.length === 0) return;
    if (integrationStageId != null && st.some((x) => x.id === integrationStageId)) return;
    setIntegrationStageId(st[0].id);
  }, [integrationFormOpen, integrationStagesQuery.data, integrationStageId]);

  async function generateIntegrationSecret() {
    try {
      const r = await apiFetch<{ secret: string }>("/api/integrations/generate-secret", { method: "POST" });
      setIntegrationSecret(r.secret);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сгенерировать секрет");
    }
  }

  async function syncSheetsNow(integrationId: number) {
    try {
      const stats = await apiFetch<{ created: number; processed: number; skipped: number }>(
        `/api/integrations/${integrationId}/sync`,
        { method: "POST" },
      );
      toast.success(`Синхронизация: обработано ${stats.processed}, пропущено ${stats.skipped}`);
      void queryClient.invalidateQueries({ queryKey: ["integrations"] });
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["leads-table"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось синхронизировать таблицу");
    }
  }

  async function submitCreateIntegration() {
    if (!integrationName.trim()) return toast.error("Название обязательно");
    if (!integrationPipelineId || !integrationStageId) return toast.error("Выберите воронку и стадию");

    const templates = {
      greeting: tplGreeting.trim(),
      confirm: tplConfirm.trim(),
      reminder_24h: tplReminder24h.trim(),
      reminder_2h: tplReminder2h.trim(),
      reactivation: tplReactivation.trim(),
    };

    if (editingIntegrationId != null) {
      const body: Record<string, unknown> = {
        name: integrationName.trim(),
        pipeline_id: integrationPipelineId,
        stage_id: integrationStageId,
        manager_close_deal_enabled: integrationCloseDealEnabled,
      };
      if (integrationProvider === "telegram" && integrationSecret.trim()) {
        body.secret = integrationSecret.trim();
      }
      if (integrationProvider === "green_api") {
        if (!greenInstanceId.trim()) {
          toast.error("Укажите idInstance из кабинета Green API");
          return;
        }
        body.config = {
          instance_id: greenInstanceId.trim(),
          ...(greenApiToken.trim() ? { api_token: greenApiToken.trim() } : {}),
          ...(greenApiBaseUrl.trim() ? { api_base_url: greenApiBaseUrl.trim() } : {}),
          templates,
        };
      } else {
        if (integrationProvider === "google_sheets") {
          if (!sheetsUrl.trim()) {
            toast.error("Укажите URL Google таблицы");
            return;
          }
          body.config = {
            sheet_url: sheetsUrl.trim(),
            ...(sheetsTabName.trim() ? { sheet_name: sheetsTabName.trim() } : {}),
            full_name_column: sheetsNameColumn.trim() || "full_name",
            phone_column: sheetsPhoneColumn.trim() || "phone_number",
            ...(sheetsEmailColumn.trim() ? { email_column: sheetsEmailColumn.trim() } : {}),
            header_row: Number(sheetsHeaderRow) || 1,
            start_row: Number(sheetsStartRow) || 2,
            templates,
          };
        } else {
          try {
            const parsed = integrationConfigText.trim()
              ? (JSON.parse(integrationConfigText) as Record<string, unknown>)
              : {};
            body.config = { ...parsed, templates };
          } catch {
            toast.error("Config должен быть валидным JSON");
            return;
          }
        }
      }
      try {
        const saved = await apiFetch<Integration>(`/api/integrations/${editingIntegrationId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        toast.success(saved.setup_note ?? "Интеграция обновлена");
        resetIntegrationForm();
        setIntegrationFormOpen(false);
        void queryClient.invalidateQueries({ queryKey: ["integrations"] });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
      }
      return;
    }

    let cfg: Record<string, unknown> | null = null;
    if (integrationProvider === "green_api") {
      if (!greenInstanceId.trim() || !greenApiToken.trim()) {
        toast.error("Скопируйте из кабинета Green API: idInstance и apiTokenInstance");
        return;
      }
      cfg = {
        instance_id: greenInstanceId.trim(),
        api_token: greenApiToken.trim(),
        ...(greenApiBaseUrl.trim() ? { api_base_url: greenApiBaseUrl.trim() } : {}),
        templates,
      };
    } else if (integrationProvider === "google_sheets") {
      if (!sheetsUrl.trim()) return toast.error("Укажите URL Google таблицы");
      cfg = {
        sheet_url: sheetsUrl.trim(),
        ...(sheetsTabName.trim() ? { sheet_name: sheetsTabName.trim() } : {}),
        full_name_column: sheetsNameColumn.trim() || "full_name",
        phone_column: sheetsPhoneColumn.trim() || "phone_number",
        ...(sheetsEmailColumn.trim() ? { email_column: sheetsEmailColumn.trim() } : {}),
        header_row: Number(sheetsHeaderRow) || 1,
        start_row: Number(sheetsStartRow) || 2,
        templates,
      };
    } else {
      if (!integrationSecret.trim())
        return toast.error("Для Telegram укажите webhook-секрет (или нажмите «Сгенерировать»)");
      try {
        const parsed = integrationConfigText.trim()
          ? (JSON.parse(integrationConfigText) as Record<string, unknown>)
          : {};
        cfg = { ...parsed, templates };
      } catch {
        toast.error("Config должен быть валидным JSON");
        return;
      }
    }

    const createPayload: Record<string, unknown> = {
      name: integrationName.trim(),
      provider: integrationProvider,
      pipeline_id: integrationPipelineId,
      stage_id: integrationStageId,
      manager_close_deal_enabled: integrationCloseDealEnabled,
      config: cfg,
    };
    if (integrationProvider === "telegram") {
      createPayload.secret = integrationSecret.trim();
    }

    try {
      const created = await apiFetch<Integration>("/api/integrations", {
        method: "POST",
        body: JSON.stringify(createPayload),
      });
      toast.success(created.setup_note ?? "Интеграция создана");
      resetIntegrationForm();
      setIntegrationFormOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["integrations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось создать интеграцию");
    }
  }

  function pickChannel(id: IntegrationProvider) {
    resetIntegrationForm(id);
    setIntegrationFormOpen(true);
  }

  function closeForm() {
    setIntegrationFormOpen(false);
    resetIntegrationForm();
  }

  return (
    <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5">
      <h2 className="text-lg font-medium text-white">Каналы и подключение</h2>
      <p className="mt-1 text-sm text-slate-400">
        Выберите сервис по иконке — откроется форма с полями. Уже настроенные каналы — в списке справа (на широком
        экране) или ниже.
      </p>

      {!integrationFormOpen ? (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {CHANNELS.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => pickChannel(ch.id)}
                className={[
                  "flex flex-col items-center gap-3 rounded-2xl border border-slate-600/50 bg-slate-900/40 p-6 text-center transition",
                  "hover:bg-slate-900/70 focus:outline-none focus-visible:ring-2",
                  ch.ring,
                ].join(" ")}
              >
                <div
                  className={[
                    "flex h-16 w-16 items-center justify-center rounded-2xl [&>svg]:h-9 [&>svg]:w-9",
                    ch.bg,
                  ].join(" ")}
                >
                  <ch.Icon className={ch.id === "google_sheets" ? "h-10 w-10" : ""} />
                </div>
                <div>
                  <div className="text-base font-semibold text-white">{ch.title}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{ch.subtitle}</div>
                </div>
              </button>
            ))}
          </div>
          <div className="mt-8">
            <h3 className="text-sm font-semibold text-white">Текущие подключения</h3>
            <p className="mt-1 text-xs text-slate-500">Изменить настройки или синхронизировать таблицу</p>
            <div className="mt-4 space-y-3">
              {integrationsQuery.isLoading && <p className="text-sm text-slate-400">Загрузка…</p>}
              {(integrationsQuery.data ?? []).length === 0 && !integrationsQuery.isLoading && (
                <p className="text-sm text-slate-500">Пока нет интеграций — выберите канал выше</p>
              )}
              {(integrationsQuery.data ?? []).map((it) => (
                <IntegrationCard
                  key={it.id}
                  it={it}
                  onEdit={() => beginEditIntegration(it)}
                  onSync={() => void syncSheetsNow(it.id)}
                />
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={closeForm}
              className="rounded-xl border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800/50"
            >
              ← Другой канал
            </button>
            {editingIntegrationId != null && (
              <span className="text-sm text-amber-200/90">Редактирование интеграции №{editingIntegrationId}</span>
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
            <div className="rounded-2xl border border-slate-700/50 bg-slate-950/30 p-4">
              <div className="text-sm font-semibold text-white">
                {editingIntegrationId != null ? "Параметры интеграции" : "Новая интеграция"}
              </div>
              {editingIntegrationId == null && (
                <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-900/40 px-3 py-2">
                  <div
                    className={[
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl [&>svg]:h-6 [&>svg]:w-6",
                      CHANNELS.find((c) => c.id === integrationProvider)?.bg ?? "bg-slate-600/30",
                    ].join(" ")}
                  >
                    {integrationProvider === "green_api" && <IconWhatsApp />}
                    {integrationProvider === "telegram" && <IconTelegram />}
                    {integrationProvider === "google_sheets" && <IconSheets className="h-8 w-8" />}
                  </div>
                  <div className="text-xs text-slate-400">
                    Тип канала выбран по иконке. Чтобы сменить — нажмите «Другой канал».
                  </div>
                </div>
              )}
              {editingIntegrationId != null && (
                <label className="mt-3 block text-sm text-slate-300">
                  Провайдер
                  <select
                    value={integrationProvider}
                    disabled
                    className="mt-1 w-full cursor-not-allowed rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white opacity-60"
                  >
                    <option value="green_api">GREEN API (WhatsApp)</option>
                    <option value="telegram">Telegram Bot</option>
                    <option value="google_sheets">Google Sheets</option>
                  </select>
                </label>
              )}

              <div className="mt-3 grid gap-3">
                <label className="text-sm text-slate-300">
                  Название
                  <input
                    value={integrationName}
                    onChange={(e) => setIntegrationName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                  />
                </label>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="text-sm text-slate-300">
                    Воронка
                    <select
                      value={integrationPipelineId ?? ""}
                      onChange={(e) => {
                        const id = Number(e.target.value);
                        setIntegrationPipelineId(Number.isFinite(id) ? id : null);
                        setIntegrationStageId(null);
                      }}
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                    >
                      {(pipelinesQuery.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-slate-300">
                    Стадия
                    <select
                      value={integrationStageId ?? ""}
                      onChange={(e) => setIntegrationStageId(Number(e.target.value))}
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                    >
                      {(integrationStagesQuery.data ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-700/60 bg-slate-950/30 p-3 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={integrationCloseDealEnabled}
                    onChange={(e) => setIntegrationCloseDealEnabled(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-600"
                  />
                  <span>
                    <span className="font-medium text-white">Кнопка «Закрыть сделку» для менеджеров</span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">
                      Менеджер закроет сделку с суммами на карточке лида. Лид уйдёт на стадию успеха из настроек
                      сервера.
                    </span>
                  </span>
                </label>

                {integrationProvider === "telegram" && (
                  <label className="text-sm text-slate-300">
                    Webhook секрет (token)
                    {editingIntegrationId != null && (
                      <span className="ml-1 text-[11px] font-normal text-slate-500">— оставьте пустым, чтобы не менять</span>
                    )}
                    <div className="mt-1 flex gap-2">
                      <input
                        value={integrationSecret}
                        onChange={(e) => setIntegrationSecret(e.target.value)}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                      />
                      <button
                        type="button"
                        onClick={() => void generateIntegrationSecret()}
                        className="shrink-0 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800/40"
                      >
                        Сгенерировать
                      </button>
                    </div>
                  </label>
                )}

                {integrationProvider === "green_api" ? (
                  <div className="grid gap-3">
                    <p className="text-[11px] leading-relaxed text-slate-400">
                      Скопируйте из кабинета Green API: <span className="text-slate-300">idInstance</span>,{" "}
                      <span className="text-slate-300">apiTokenInstance</span>. Webhook настроится автоматически.
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="text-sm text-slate-300">
                        idInstance
                        <input
                          value={greenInstanceId}
                          onChange={(e) => setGreenInstanceId(e.target.value)}
                          placeholder="Напр. 7103507365"
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                        />
                      </label>
                      <label className="text-sm text-slate-300">
                        apiTokenInstance
                        <input
                          type="password"
                          autoComplete="off"
                          value={greenApiToken}
                          onChange={(e) => setGreenApiToken(e.target.value)}
                          placeholder={
                            editingIntegrationId != null ? "Оставьте пустым, чтобы не менять" : "Токен из кабинета"
                          }
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                        />
                      </label>
                    </div>
                    <label className="text-sm text-slate-300">
                      Адрес API (по желанию)
                      <input
                        value={greenApiBaseUrl}
                        onChange={(e) => setGreenApiBaseUrl(e.target.value)}
                        placeholder="https://7103.api.greenapi.com"
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-white"
                      />
                    </label>
                  </div>
                ) : integrationProvider === "google_sheets" ? (
                  <div className="grid gap-3">
                    <p className="text-[11px] leading-relaxed text-slate-400">
                      Ссылка на Google Sheets, доступная сервисному аккаунту CRM. Колонки по умолчанию:{" "}
                      <span className="text-slate-300">full_name</span>, <span className="text-slate-300">phone_number</span>.
                    </p>
                    <label className="text-sm text-slate-300">
                      URL таблицы
                      <input
                        value={sheetsUrl}
                        onChange={(e) => setSheetsUrl(e.target.value)}
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-white"
                      />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="text-sm text-slate-300">
                        Лист (необязательно)
                        <input
                          value={sheetsTabName}
                          onChange={(e) => setSheetsTabName(e.target.value)}
                          placeholder="Sheet1"
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                        />
                      </label>
                      <label className="text-sm text-slate-300">
                        Строка заголовков
                        <input
                          value={sheetsHeaderRow}
                          onChange={(e) => setSheetsHeaderRow(e.target.value)}
                          placeholder="1"
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                        />
                      </label>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label className="text-sm text-slate-300">
                        Колонка имени
                        <input
                          value={sheetsNameColumn}
                          onChange={(e) => setSheetsNameColumn(e.target.value)}
                          placeholder="full_name"
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                        />
                      </label>
                      <label className="text-sm text-slate-300">
                        Колонка телефона
                        <input
                          value={sheetsPhoneColumn}
                          onChange={(e) => setSheetsPhoneColumn(e.target.value)}
                          placeholder="phone_number"
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                        />
                      </label>
                      <label className="text-sm text-slate-300">
                        Колонка email
                        <input
                          value={sheetsEmailColumn}
                          onChange={(e) => setSheetsEmailColumn(e.target.value)}
                          placeholder="email"
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                        />
                      </label>
                    </div>
                    <label className="text-sm text-slate-300">
                      Стартовая строка данных
                      <input
                        value={sheetsStartRow}
                        onChange={(e) => setSheetsStartRow(e.target.value)}
                        placeholder="2"
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                      />
                    </label>
                  </div>
                ) : (
                  <label className="text-sm text-slate-300">
                    Config (JSON)
                    <textarea
                      value={integrationConfigText}
                      onChange={(e) => setIntegrationConfigText(e.target.value)}
                      rows={5}
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 font-mono text-xs text-white"
                    />
                  </label>
                )}

                <div className="rounded-xl border border-slate-700/60 bg-slate-950/20 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Шаблоны сообщений</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Переменные: {"{name}"}, {"{date}"}, {"{time}"}, {"{manager}"}
                  </p>
                  <div className="mt-2 grid gap-2">
                    <label className="text-sm text-slate-300">
                      Приветствие
                      <textarea
                        value={tplGreeting}
                        onChange={(e) => setTplGreeting(e.target.value)}
                        rows={2}
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-white"
                      />
                    </label>
                    <label className="text-sm text-slate-300">
                      Подтверждение записи
                      <textarea
                        value={tplConfirm}
                        onChange={(e) => setTplConfirm(e.target.value)}
                        rows={2}
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-white"
                      />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="text-sm text-slate-300">
                        Напоминание за 24ч
                        <textarea
                          value={tplReminder24h}
                          onChange={(e) => setTplReminder24h(e.target.value)}
                          rows={2}
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-white"
                        />
                      </label>
                      <label className="text-sm text-slate-300">
                        Напоминание за 2ч
                        <textarea
                          value={tplReminder2h}
                          onChange={(e) => setTplReminder2h(e.target.value)}
                          rows={2}
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-white"
                        />
                      </label>
                    </div>
                    <label className="text-sm text-slate-300">
                      Реактивация
                      <textarea
                        value={tplReactivation}
                        onChange={(e) => setTplReactivation(e.target.value)}
                        rows={2}
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-white"
                      />
                    </label>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => void submitCreateIntegration()}
                    className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:opacity-95"
                  >
                    {editingIntegrationId != null ? "Сохранить" : "Создать"}
                  </button>
                  {editingIntegrationId != null && (
                    <button
                      type="button"
                      onClick={() => {
                        resetIntegrationForm();
                        setIntegrationFormOpen(false);
                      }}
                      className="w-full rounded-xl border border-slate-700 py-2 text-sm text-slate-300 transition hover:bg-slate-800/40"
                    >
                      Отменить редактирование
                    </button>
                  )}
                </div>
                {integrationProvider === "green_api" ? (
                  <p className="text-[11px] text-slate-500">
                    Ошибка про адрес API: задайте <span className="font-mono text-slate-400">public_api_base_url</span> на
                    сервере или сохраняйте интеграцию с того же сайта, где открыт API.
                  </p>
                ) : integrationProvider === "google_sheets" ? (
                  <p className="text-[11px] text-slate-500">
                    После сохранения нажмите «Синхронизировать» в списке для первой загрузки строк.
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500">
                    Скопируйте webhook URL из списка справа и укажите секрет в @BotFather.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-700/50 bg-slate-950/40 p-4 lg:sticky lg:top-4 lg:self-start">
              <div className="text-sm font-semibold text-white">Подключённые интеграции</div>
              <p className="mt-1 text-[11px] text-slate-500">Webhook, синхронизация, изменение</p>
              <div className="mt-3 max-h-[min(520px,70vh)] space-y-2 overflow-y-auto">
                {integrationsQuery.isLoading && <p className="text-sm text-slate-400">Загрузка…</p>}
                {(integrationsQuery.data ?? []).length === 0 && !integrationsQuery.isLoading && (
                  <p className="text-sm text-slate-500">Пока нет — выберите канал выше</p>
                )}
                {(integrationsQuery.data ?? []).map((it) => (
                  <IntegrationCard
                    key={it.id}
                    it={it}
                    onEdit={() => beginEditIntegration(it)}
                    onSync={() => void syncSheetsNow(it.id)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
