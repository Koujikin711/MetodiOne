import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ComponentType } from "react";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import type { GreenBroadcastPreviewRead, GreenBroadcastResult, Integration, Pipeline, PipelineStage } from "@/lib/types";

type IntegrationProvider = "green_api" | "telegram" | "google_sheets" | "instagram" | "gmail";

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

function IconInstagram({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        d="M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2m-.2 2A3.6 3.6 0 0 0 4 7.6v8.8A3.6 3.6 0 0 0 7.6 20h8.8A3.6 3.6 0 0 0 20 16.4V7.6A3.6 3.6 0 0 0 16.4 4H7.6m8.65 1.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10m0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
      />
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

function IconGmail({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#EA4335" d="M2 6.5 12 14l10-7.5V18a2 2 0 0 1-2 2h-3V10.7L12 14.3 7 10.7V20H4a2 2 0 0 1-2-2V6.5z" />
      <path fill="#FBBC05" d="M2 6.5V7l10 7.3L22 7v-.5A2.5 2.5 0 0 0 19.5 4h-15A2.5 2.5 0 0 0 2 6.5z" />
      <path fill="#34A853" d="M7 10.7V20h10v-9.3L12 14.3 7 10.7z" />
      <path fill="#4285F4" d="M2 7v11a2 2 0 0 0 2 2h1v-9.3L2 7zm20 0-3 3.7V20h1a2 2 0 0 0 2-2V7z" />
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
    ring: "",
    bg: "bg-[#EDF7F1] text-[#0F4C3A]",
  },
  {
    id: "telegram",
    title: "Telegram",
    subtitle: "Бот и уведомления",
    Icon: IconTelegram,
    ring: "",
    bg: "bg-[#E8F0FA] text-[#1E3A8A]",
  },
  {
    id: "google_sheets",
    title: "Google Таблицы",
    subtitle: "Импорт лидов",
    Icon: IconSheets,
    ring: "",
    bg: "bg-[#EDF7F1] text-[#0F4C3A]",
  },
  {
    id: "instagram",
    title: "Instagram",
    subtitle: "Лиды и Direct",
    Icon: IconInstagram,
    ring: "",
    bg: "bg-[#FDF2F8] text-[#6B1D2F]",
  },
  {
    id: "gmail",
    title: "Gmail",
    subtitle: "Входящая почта",
    Icon: IconGmail,
    ring: "",
    bg: "bg-[#FDF5F5] text-[#7A2E2E]",
  },
];

type GreenWebhookStatus = {
  integration_id: number;
  expected_webhook_url: string;
  public_api_base_url: string;
  green_webhook_url?: string | null;
  green_incoming_webhook?: string | null;
  green_state_instance?: string | null;
  webhook_url_matches: boolean;
  incoming_enabled: boolean;
  instance_authorized?: boolean | null;
  sync_error?: string | null;
  hint?: string | null;
};

function GreenApiWebhookPanel({ integrationId }: { integrationId: number }) {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ["green-webhook-status", integrationId],
    queryFn: () => apiFetch<GreenWebhookStatus>(`/api/integrations/${integrationId}/green-webhook-status`),
    refetchInterval: 30_000,
  });
  const syncMutation = useMutation({
    mutationFn: () =>
      apiFetch<Integration>(`/api/integrations/${integrationId}/green-webhook-sync`, { method: "POST" }),
    onSuccess: (saved) => {
      toast.success(saved.setup_note ?? "Webhook переподключён");
      void queryClient.invalidateQueries({ queryKey: ["green-webhook-status", integrationId] });
      void queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const st = statusQuery.data;
  const ok = st?.webhook_url_matches && st?.incoming_enabled && st?.instance_authorized !== false;

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-[#E1D9C6] bg-[#FAF8F4] p-2 text-[11px] text-[#7A7265]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-[#2C2520]">Входящие WhatsApp → «Чаты»</span>
        {statusQuery.isLoading ? (
          <span className="text-[#A89880]">Проверка…</span>
        ) : ok ? (
          <span className="font-medium text-[#0F4C3A]">Подключено</span>
        ) : (
          <span className="font-medium text-[#9A3412]">Требует настройки</span>
        )}
      </div>
      {st?.expected_webhook_url ? (
        <div>
          <span className="font-medium text-[#2C2520]">Webhook CRM (Amvera):</span>
          <div className="mt-1 break-all rounded border border-[#E1D9C6] bg-white px-2 py-1 font-mono text-[10px]">
            {st.expected_webhook_url}
          </div>
        </div>
      ) : null}
      {st?.green_webhook_url ? (
        <div>
          <span className="font-medium text-[#2C2520]">Сейчас в Green API:</span>
          <div className="mt-1 break-all font-mono text-[10px]">{st.green_webhook_url}</div>
        </div>
      ) : null}
      {st?.green_state_instance ? <div>Статус инстанса: {st.green_state_instance}</div> : null}
      {st?.sync_error ? <p className="text-[#9A3412]">{st.sync_error}</p> : null}
      {st?.hint ? <p className="leading-relaxed text-[#9A3412]">{st.hint}</p> : null}
      {!st?.public_api_base_url ? (
        <p className="leading-relaxed text-[#9A3412]">
          На Amvera задайте переменную <span className="font-mono">PUBLIC_API_BASE_URL</span> ={" "}
          <span className="font-mono">https://metodi-one-koujikin.amvera.io</span>
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => syncMutation.mutate()}
        disabled={syncMutation.isPending}
        className="crm-pill-btn px-2 py-1 text-[11px]"
      >
        {syncMutation.isPending ? "Отправка…" : "Переподключить webhook"}
      </button>
    </div>
  );
}

function IntegrationCard({
  it,
  onEdit,
  onSync,
  onBroadcast,
  onBackfill,
  backfillLoading,
}: {
  it: Integration;
  onEdit: () => void;
  onSync: () => void;
  onBroadcast: () => void;
  onBackfill: () => void;
  backfillLoading: boolean;
}) {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
  const base = apiBase && apiBase.endsWith("/") ? apiBase.slice(0, apiBase.length - 1) : apiBase;
  const hookPath = base ? `${base}/api/integrations/webhook/${it.id}` : `/api/integrations/webhook/${it.id}`;

  return (
    <div className="integ-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F7F4EB] [&>svg]:h-4 [&>svg]:w-4">
            {it.provider === "green_api" && <IconWhatsApp className="text-[#0F4C3A]" />}
            {it.provider === "telegram" && <IconTelegram className="text-[#1E3A8A]" />}
            {it.provider === "google_sheets" && <IconSheets className="h-6 w-6" />}
            {it.provider === "instagram" && <IconInstagram className="h-7 w-7" />}
            {it.provider === "gmail" && <IconGmail className="h-7 w-7" />}
          </span>
          <div className="min-w-0 text-sm font-semibold text-[#2C2520]">{it.name}</div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 rounded-lg border border-[#DCD1B4] px-2 py-0.5 text-[11px] text-[#2C2520] hover:bg-[#F7F4EB]/50"
        >
          Изменить
        </button>
      </div>
      <div className="mt-1 text-[11px] text-[#A89880]">
        {it.is_active ? <span className="font-medium text-[#0F4C3A]">Активна</span> : <span className="text-[#A89880]">Выключена</span>}
        {it.has_api_token ? " · токен сохранён" : ""}
      </div>
      {it.setup_note ? (
        <p className="mt-2 rounded-lg border border-[#DCD1B4] bg-[#F7F2E8] px-2 py-1.5 text-[11px] text-[#7A7265]">{it.setup_note}</p>
      ) : null}
      {it.provider === "green_api" && (
        <div className="mt-2 space-y-2">
          <div className="lux-caption leading-relaxed">
            WhatsApp через Green API: входящие попадают в раздел «Чаты» и в выбранную воронку.
          </div>
          <GreenApiWebhookPanel integrationId={it.id} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onBackfill}
              disabled={backfillLoading}
              className="rounded-lg border border-[#DCD1B4] px-2 py-1 text-[11px] text-[#2C2520] transition hover:bg-[#F7F4EB]/50 disabled:opacity-50"
            >
              {backfillLoading ? "Догрузка…" : "Догрузить лиды за 7 дней"}
            </button>
            <button
              type="button"
              onClick={onBroadcast}
              className="crm-pill-btn px-2 py-1 text-[11px]"
            >
              Массовая рассылка
            </button>
          </div>
        </div>
      )}
      <div className="mt-2 text-[11px] text-[#7A7265]">
        Воронка {it.pipeline_id}, стадия {it.stage_id}
      </div>
      {it.provider === "telegram" && (
        <div className="mt-2 text-[11px] text-[#7A7265]">
          Webhook URL:
          <div className="mt-1 break-all rounded-lg border border-[#E1D9C6] bg-white px-2 py-1 font-mono text-[11px] text-[#2C2520]">
            {hookPath}?token=
            <span className="text-[#8C6D31]">секрет из формы</span>
          </div>
          {!apiBase && (
            <div className="lux-caption mt-1">Укажите публичный адрес API в настройках сервера для полного URL.</div>
          )}
        </div>
      )}
      {it.provider === "instagram" && (
        <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-[#7A7265]">
          <p>
            Лиды из рекламы Meta и сообщения Instagram Direct. Новые заявки и диалоги попадают в выбранную воронку CRM.
          </p>
          <div>
            <span className="font-medium text-[#2C2520]">Адрес webhook для Meta (GET и POST):</span>
            <div className="mt-1 break-all rounded-lg border border-[#DCD1B4] bg-[#FAF8F4] px-2 py-1 font-mono text-[10px] text-[#2C2520]">
              {hookPath}
            </div>
            <p className="lux-caption mt-1">
              Код подтверждения в Meta — тот же секрет, что в форме ниже. Подписки: leadgen, instagram, при необходимости
              messages.
            </p>
            {!apiBase && (
              <div className="mt-1 text-[10px] text-amber-300/90">Задайте VITE_API_BASE_URL для полного URL.</div>
            )}
          </div>
        </div>
      )}
      {it.provider === "google_sheets" && (
        <div className="mt-2 space-y-2">
          <div className="text-[11px] text-[#7A7265]">
            Таблица: {String((it.config as Record<string, unknown> | null)?.sheet_url ?? "—")}
          </div>
          <button
            type="button"
            onClick={onSync}
            className="rounded-lg border border-[#DCD1B4] px-2 py-1 text-[11px] text-[#2C2520] transition hover:bg-[#F7F4EB]/50"
          >
            Синхронизировать сейчас
          </button>
        </div>
      )}
      {it.provider === "gmail" && (
        <div className="lux-caption mt-2 leading-relaxed">
          Почта Gmail через IMAP. Используйте пароль приложения Google (App Password), не основной пароль аккаунта.
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
  const [igPageToken, setIgPageToken] = useState("");
  const [igAppSecret, setIgAppSecret] = useState("");
  const [igGraphHost, setIgGraphHost] = useState<"page" | "instagram">("instagram");
  const [gmailEmail, setGmailEmail] = useState("");
  const [gmailAppPassword, setGmailAppPassword] = useState("");
  const [gmailImapHost, setGmailImapHost] = useState("imap.gmail.com");
  const [broadcastIntegrationId, setBroadcastIntegrationId] = useState<number | null>(null);
  const [backfillLoadingIntegrationId, setBackfillLoadingIntegrationId] = useState<number | null>(null);
  const [broadcastSource, setBroadcastSource] = useState<"database" | "excel">("database");
  const [broadcastText, setBroadcastText] = useState("");
  const [broadcastExcelColumn, setBroadcastExcelColumn] = useState("phone");
  const [broadcastFile, setBroadcastFile] = useState<File | null>(null);
  const [broadcastPreview, setBroadcastPreview] = useState<GreenBroadcastPreviewRead | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [broadcastLastResult, setBroadcastLastResult] = useState<GreenBroadcastResult | null>(null);

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
    setIgPageToken("");
    setIgAppSecret("");
    setIgGraphHost("instagram");
    setGmailEmail("");
    setGmailAppPassword("");
    setGmailImapHost("imap.gmail.com");
  }

  function beginEditIntegration(it: Integration) {
    setIntegrationFormOpen(true);
    setEditingIntegrationId(it.id);
    setIntegrationName(it.name);
    setIntegrationProvider(
      it.provider === "telegram"
        ? "telegram"
        : it.provider === "google_sheets"
          ? "google_sheets"
          : it.provider === "instagram"
            ? "instagram"
            : it.provider === "gmail"
              ? "gmail"
            : "green_api",
    );
    setIntegrationPipelineId(it.pipeline_id);
    setIntegrationStageId(it.stage_id);
    setIntegrationCloseDealEnabled(Boolean(it.manager_close_deal_enabled));
    setIntegrationSecret("");
    setIgPageToken("");
    setIgAppSecret("");
    setIgGraphHost("instagram");
    setGmailEmail("");
    setGmailAppPassword("");
    setGmailImapHost("imap.gmail.com");
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
    } else if (it.provider === "instagram") {
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
      const c = (it.config || {}) as Record<string, unknown>;
      const host = String(c.graph_host || "").toLowerCase();
      if (host === "page" || host === "facebook" || host === "fb" || c.use_instagram_graph === false) {
        setIgGraphHost("page");
      } else {
        setIgGraphHost("instagram");
      }
    } else if (it.provider === "gmail") {
      const c = it.config as Record<string, unknown> | null;
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
      setGmailEmail(String(c?.email ?? c?.gmail_email ?? ""));
      setGmailAppPassword("");
      setGmailImapHost(String(c?.imap_host ?? "imap.gmail.com"));
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

  async function greenBackfillNow(integrationId: number) {
    setBackfillLoadingIntegrationId(integrationId);
    try {
      const stats = await apiFetch<{
        chats_scanned: number;
        chats_imported: number;
        leads_created: number;
        leads_updated: number;
        messages_added: number;
        skipped_answered: number;
        skipped_no_match: number;
        errors: string[];
      }>(`/api/integrations/${integrationId}/green-backfill?days=7`, { method: "POST" });
      const errNote = stats.errors.length ? ` Ошибок: ${stats.errors.length}.` : "";
      toast.success(
        `Догрузка: чатов ${stats.chats_imported} из ${stats.chats_scanned}, новых лидов ${stats.leads_created}, сообщений ${stats.messages_added}.${errNote}`,
      );
      void queryClient.invalidateQueries({ queryKey: ["integrations"] });
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["leads-table"] });
      void queryClient.invalidateQueries({ queryKey: ["chat-threads"] });
      void queryClient.invalidateQueries({ queryKey: ["desk-awaiting-threads"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось догрузить диалоги из Green API");
    } finally {
      setBackfillLoadingIntegrationId(null);
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
      if (integrationProvider === "instagram" && integrationSecret.trim()) {
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
      } else if (integrationProvider === "google_sheets") {
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
      } else if (integrationProvider === "instagram") {
        body.config = {
          ...(igPageToken.trim() ? { page_access_token: igPageToken.trim() } : {}),
          ...(igAppSecret.trim() ? { app_secret: igAppSecret.trim() } : {}),
          graph_host: igGraphHost,
          use_instagram_graph: igGraphHost === "instagram",
          templates,
        };
      } else if (integrationProvider === "gmail") {
        body.config = {
          ...(gmailEmail.trim() ? { email: gmailEmail.trim() } : {}),
          ...(gmailAppPassword.trim() ? { app_password: gmailAppPassword.trim() } : {}),
          ...(gmailImapHost.trim() ? { imap_host: gmailImapHost.trim() } : {}),
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
    } else if (integrationProvider === "instagram") {
      if (!integrationSecret.trim() || integrationSecret.trim().length < 8) {
        return toast.error("Verify token не короче 8 символов — нажмите «Сгенерировать» или введите свой");
      }
      if (!igPageToken.trim()) return toast.error("Укажите Access Token");
      cfg = {
        page_access_token: igPageToken.trim(),
        ...(igAppSecret.trim() ? { app_secret: igAppSecret.trim() } : {}),
        graph_host: igGraphHost,
        use_instagram_graph: igGraphHost === "instagram",
        templates,
      };
    } else if (integrationProvider === "gmail") {
      if (!gmailEmail.trim()) return toast.error("Укажите Gmail адрес");
      if (!gmailAppPassword.trim()) return toast.error("Укажите App Password для Gmail");
      cfg = {
        email: gmailEmail.trim(),
        app_password: gmailAppPassword.trim(),
        ...(gmailImapHost.trim() ? { imap_host: gmailImapHost.trim() } : {}),
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
    if (integrationProvider === "telegram" || integrationProvider === "instagram") {
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

  async function sendGreenBroadcast() {
    if (!broadcastIntegrationId) return;
    if (broadcastSending) return;
    if (!broadcastText.trim()) {
      toast.error("Введите текст рассылки");
      return;
    }
    if (broadcastSource === "excel" && !broadcastFile) {
      toast.error("Прикрепите Excel/CSV файл");
      return;
    }
    const fd = new FormData();
    fd.append("message", broadcastText.trim());
    fd.append("source", broadcastSource);
    fd.append("excel_phone_column", broadcastExcelColumn.trim() || "phone");
    if (broadcastFile) fd.append("file", broadcastFile);
    try {
      setBroadcastSending(true);
      setBroadcastLastResult(null);
      const r = await apiFetch<GreenBroadcastResult>(`/api/integrations/${broadcastIntegrationId}/green-broadcast`, {
        method: "POST",
        body: fd,
      });
      setBroadcastLastResult(r);
      toast.success(`Отправлено ${r.sent_count} из ${r.requested_count}`);
      if (r.failed_count > 0) {
        toast.error(`Ошибок: ${r.failed_count}`);
      }
      setBroadcastIntegrationId(null);
      setBroadcastText("");
      setBroadcastFile(null);
      setBroadcastPreview(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка рассылки");
    } finally {
      setBroadcastSending(false);
    }
  }

  async function previewGreenBroadcast() {
    if (!broadcastIntegrationId) return;
    if (broadcastSource === "excel" && !broadcastFile) {
      toast.error("Прикрепите Excel/CSV файл для предпросмотра");
      return;
    }
    const fd = new FormData();
    fd.append("source", broadcastSource);
    fd.append("excel_phone_column", broadcastExcelColumn.trim() || "phone");
    if (broadcastFile) fd.append("file", broadcastFile);
    try {
      setPreviewLoading(true);
      const r = await apiFetch<GreenBroadcastPreviewRead>(
        `/api/integrations/${broadcastIntegrationId}/green-broadcast/preview`,
        { method: "POST", body: fd },
      );
      setBroadcastPreview(r);
      toast.success(`Найдено ${r.found_count} номеров`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка предпросмотра");
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <section className="mo-section">
      <h2 className="lux-heading">Каналы и подключение</h2>
      <p className="lux-body mt-2">
        Выберите сервис — откроется пошаговая форма с подсказками. Уже подключённые каналы отображаются в списке ниже:
        их можно изменить, синхронизировать или отключить.
      </p>

      {!integrationFormOpen ? (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {CHANNELS.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => pickChannel(ch.id)}
                className="integ-channel-tile"
              >
                <div
                  className={[
                    "integ-channel-icon [&>svg]:h-9 [&>svg]:w-9",
                    ch.bg,
                  ].join(" ")}
                >
                  <ch.Icon className={ch.id === "google_sheets" ? "h-10 w-10" : ""} />
                </div>
                <div>
                  <div className="text-base font-semibold text-[#2C2520]">{ch.title}</div>
                  <div className="lux-caption mt-0.5">{ch.subtitle}</div>
                </div>
              </button>
            ))}
          </div>
          <div className="mt-8">
            <h3 className="lux-subheading">Текущие подключения</h3>
            <p className="lux-caption mt-1">Редактирование параметров, синхронизация таблиц и рассылки WhatsApp</p>
            <div className="mt-4 space-y-3">
              {integrationsQuery.isLoading && <p className="lux-body">Загрузка…</p>}
              {(integrationsQuery.data ?? []).length === 0 && !integrationsQuery.isLoading && (
                <p className="lux-body rounded-xl border border-dashed border-[#DCD1B4] bg-[#FAF8F4] px-4 py-6 text-center">
                  Подключённых каналов пока нет. Выберите сервис выше, чтобы начать настройку.
                </p>
              )}
              {(integrationsQuery.data ?? []).map((it) => (
                <IntegrationCard
                  key={it.id}
                  it={it}
                  onEdit={() => beginEditIntegration(it)}
                  onSync={() => void syncSheetsNow(it.id)}
                  onBackfill={() => void greenBackfillNow(it.id)}
                  backfillLoading={backfillLoadingIntegrationId === it.id}
                  onBroadcast={() => {
                    setBroadcastIntegrationId(it.id);
                    setBroadcastSource("database");
                    setBroadcastText("");
                    setBroadcastExcelColumn("phone");
                    setBroadcastFile(null);
                    setBroadcastPreview(null);
                  }}
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
              className="crm-pill-btn"
            >
              ← Другой канал
            </button>
            {editingIntegrationId != null && (
              <span className="text-sm font-medium text-[#8C6D31]">Редактирование подключения №{editingIntegrationId}</span>
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
            <div className="integ-form-panel">
              <div className="lux-subheading">
                {editingIntegrationId != null ? "Параметры интеграции" : "Новая интеграция"}
              </div>
              {editingIntegrationId == null && (
                <div className="mt-3 flex items-center gap-3 rounded-xl border border-[#E1D9C6]/60 bg-[#FAF8F4] px-3 py-2">
                  <div
                    className={[
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl [&>svg]:h-6 [&>svg]:w-6",
                      CHANNELS.find((c) => c.id === integrationProvider)?.bg ?? "bg-[#F7F4EB]",
                    ].join(" ")}
                  >
                    {integrationProvider === "green_api" && <IconWhatsApp />}
                    {integrationProvider === "telegram" && <IconTelegram />}
                    {integrationProvider === "google_sheets" && <IconSheets className="h-8 w-8" />}
                    {integrationProvider === "instagram" && <IconInstagram className="h-8 w-8" />}
                    {integrationProvider === "gmail" && <IconGmail className="h-8 w-8" />}
                  </div>
                  <div className="text-xs text-[#7A7265]">
                    Тип канала выбран по иконке. Чтобы сменить — нажмите «Другой канал».
                  </div>
                </div>
              )}
              {editingIntegrationId != null && (
                <label className="mt-3 block text-sm text-[#7A7265]">
                  Провайдер
                  <select
                    value={integrationProvider}
                    disabled
                    className="mt-1 w-full cursor-not-allowed rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm opacity-60"
                  >
                    <option value="green_api">GREEN API (WhatsApp)</option>
                    <option value="telegram">Telegram Bot</option>
                    <option value="google_sheets">Google Sheets</option>
                    <option value="instagram">Instagram / Meta</option>
                    <option value="gmail">Gmail</option>
                  </select>
                </label>
              )}

              <div className="mt-3 grid gap-3">
                <label className="text-sm text-[#7A7265]">
                  Название
                  <input
                    value={integrationName}
                    onChange={(e) => setIntegrationName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                  />
                </label>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="text-sm text-[#7A7265]">
                    Воронка
                    <select
                      value={integrationPipelineId ?? ""}
                      onChange={(e) => {
                        const id = Number(e.target.value);
                        setIntegrationPipelineId(Number.isFinite(id) ? id : null);
                        setIntegrationStageId(null);
                      }}
                      className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                    >
                      {(pipelinesQuery.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-[#7A7265]">
                    Стадия
                    <select
                      value={integrationStageId ?? ""}
                      onChange={(e) => setIntegrationStageId(Number(e.target.value))}
                      className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                    >
                      {(integrationStagesQuery.data ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#E1D9C6]/60 bg-[#FAF8F4] p-3 text-sm text-[#2C2520]">
                  <input
                    type="checkbox"
                    checked={integrationCloseDealEnabled}
                    onChange={(e) => setIntegrationCloseDealEnabled(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-[#DCD1B4]"
                  />
                  <span>
                    <span className="font-medium text-[#2C2520]">Кнопка «Закрыть сделку» для менеджеров</span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-[#7A7265]">
                      Менеджер закроет сделку с суммами на карточке лида. Лид уйдёт на стадию успеха из настроек
                      сервера.
                    </span>
                  </span>
                </label>

                {(integrationProvider === "telegram" || integrationProvider === "instagram") && (
                  <label className="text-sm text-[#7A7265]">
                    Verify token (секрет webhook)
                    {editingIntegrationId != null && (
                      <span className="ml-1 text-[11px] font-normal text-[#A89880]">— оставьте пустым, чтобы не менять</span>
                    )}
                    <div className="mt-1 flex gap-2">
                      <input
                        value={integrationSecret}
                        onChange={(e) => setIntegrationSecret(e.target.value)}
                        className="w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => void generateIntegrationSecret()}
                        className="shrink-0 rounded-xl border border-[#E1D9C6] px-3 py-2 text-sm text-[#2C2520] hover:bg-[#F7F4EB]/40"
                      >
                        Сгенерировать
                      </button>
                    </div>
                  </label>
                )}

                {integrationProvider === "green_api" ? (
                  <div className="grid gap-3">
                    <p className="text-[11px] leading-relaxed text-[#7A7265]">
                      Скопируйте из кабинета Green API: <span className="text-[#7A7265]">idInstance</span>,{" "}
                      <span className="text-[#7A7265]">apiTokenInstance</span>. Webhook настроится автоматически.
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="text-sm text-[#7A7265]">
                        idInstance
                        <input
                          value={greenInstanceId}
                          onChange={(e) => setGreenInstanceId(e.target.value)}
                          placeholder="Напр. 7103507365"
                          className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                        />
                      </label>
                      <label className="text-sm text-[#7A7265]">
                        apiTokenInstance
                        <input
                          type="password"
                          autoComplete="off"
                          value={greenApiToken}
                          onChange={(e) => setGreenApiToken(e.target.value)}
                          placeholder={
                            editingIntegrationId != null ? "Оставьте пустым, чтобы не менять" : "Токен из кабинета"
                          }
                          className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                        />
                      </label>
                    </div>
                    <label className="text-sm text-[#7A7265]">
                      Адрес API (по желанию)
                      <input
                        value={greenApiBaseUrl}
                        onChange={(e) => setGreenApiBaseUrl(e.target.value)}
                        placeholder="https://7103.api.greenapi.com"
                        className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                      />
                    </label>
                  </div>
                ) : integrationProvider === "google_sheets" ? (
                  <div className="grid gap-3">
                    <p className="text-[11px] leading-relaxed text-[#7A7265]">
                      Ссылка на Google Sheets, доступная сервисному аккаунту CRM. Колонки по умолчанию:{" "}
                      <span className="text-[#7A7265]">full_name</span>, <span className="text-[#7A7265]">phone_number</span>.
                    </p>
                    <label className="text-sm text-[#7A7265]">
                      URL таблицы
                      <input
                        value={sheetsUrl}
                        onChange={(e) => setSheetsUrl(e.target.value)}
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                        className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                      />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="text-sm text-[#7A7265]">
                        Лист (необязательно)
                        <input
                          value={sheetsTabName}
                          onChange={(e) => setSheetsTabName(e.target.value)}
                          placeholder="Sheet1"
                          className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                        />
                      </label>
                      <label className="text-sm text-[#7A7265]">
                        Строка заголовков
                        <input
                          value={sheetsHeaderRow}
                          onChange={(e) => setSheetsHeaderRow(e.target.value)}
                          placeholder="1"
                          className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                        />
                      </label>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label className="text-sm text-[#7A7265]">
                        Колонка имени
                        <input
                          value={sheetsNameColumn}
                          onChange={(e) => setSheetsNameColumn(e.target.value)}
                          placeholder="full_name"
                          className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                        />
                      </label>
                      <label className="text-sm text-[#7A7265]">
                        Колонка телефона
                        <input
                          value={sheetsPhoneColumn}
                          onChange={(e) => setSheetsPhoneColumn(e.target.value)}
                          placeholder="phone_number"
                          className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                        />
                      </label>
                      <label className="text-sm text-[#7A7265]">
                        Колонка email
                        <input
                          value={sheetsEmailColumn}
                          onChange={(e) => setSheetsEmailColumn(e.target.value)}
                          placeholder="email"
                          className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                        />
                      </label>
                    </div>
                    <label className="text-sm text-[#7A7265]">
                      Стартовая строка данных
                      <input
                        value={sheetsStartRow}
                        onChange={(e) => setSheetsStartRow(e.target.value)}
                        placeholder="2"
                        className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                      />
                    </label>
                  </div>
                ) : integrationProvider === "instagram" ? (
                  <div className="grid gap-3">
                    <div className="rounded-xl border border-[#E1D9C6] bg-[#FBF8F1] px-3 py-2.5 text-[11px] leading-relaxed text-[#7A7265]">
                      <p className="font-medium text-[#6B1D2F]">Как связать с Meta (как Green API для WhatsApp)</p>
                      <ol className="mt-1.5 list-decimal space-y-1 pl-4">
                        <li>
                          В приложении MetodiOne-IG нажмите «Добавить все необходимые разрешения»
                          (instagram_business_basic, manage_comments, manage_messages).
                        </li>
                        <li>«Добавить аккаунт» — привяжите Instagram Business и получите Access Token.</li>
                        <li>
                          Webhooks: Callback URL из карточки интеграции справа, Verify Token = секрет из формы ниже.
                          Подписки: <span className="font-medium">messages</span>, при Lead Ads ещё{" "}
                          <span className="font-medium">leadgen</span>.
                        </li>
                        <li>
                          Сохраните интеграцию здесь. Входящие Direct → лид + чат; ответ из CRM Чаты уходит обратно в
                          Instagram.
                        </li>
                      </ol>
                    </div>
                    <label className="text-sm text-[#7A7265]">
                      Access Token (Page / Instagram)
                      {editingIntegrationId != null && (
                        <span className="ml-1 text-[11px] font-normal text-[#A89880]">
                          — пусто = оставить сохранённый токен
                        </span>
                      )}
                      <input
                        type="password"
                        autoComplete="off"
                        value={igPageToken}
                        onChange={(e) => setIgPageToken(e.target.value)}
                        placeholder={
                          editingIntegrationId != null
                            ? "Оставьте пустым, чтобы не менять"
                            : "Токен из «Сгенерируйте маркеры доступа» или Graph API Explorer"
                        }
                        className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                      />
                    </label>
                    <label className="text-sm text-[#7A7265]">
                      Тип токена
                      <select
                        value={igGraphHost}
                        onChange={(e) => setIgGraphHost(e.target.value as "page" | "instagram")}
                        className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                      >
                        <option value="instagram">Instagram Login (graph.instagram.com) — как в мастере API</option>
                        <option value="page">Page Access Token (graph.facebook.com)</option>
                      </select>
                    </label>
                    <label className="text-sm text-[#7A7265]">
                      App Secret (рекомендуется)
                      {editingIntegrationId != null && (
                        <span className="ml-1 text-[11px] font-normal text-[#A89880]">
                          — пусто = не менять; для проверки подписи X-Hub-Signature-256
                        </span>
                      )}
                      <input
                        type="password"
                        autoComplete="off"
                        value={igAppSecret}
                        onChange={(e) => setIgAppSecret(e.target.value)}
                        placeholder="Показать в настройках приложения Meta → App Secret"
                        className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                      />
                    </label>
                  </div>
                ) : integrationProvider === "gmail" ? (
                  <div className="grid gap-3">
                    <p className="text-[11px] leading-relaxed text-[#7A7265]">
                      Подключение Gmail по IMAP. В Google-аккаунте включите двухфакторную аутентификацию и создайте{" "}
                      <span className="text-red-200/90">App Password</span>.
                    </p>
                    <label className="text-sm text-[#7A7265]">
                      Email
                      <input
                        value={gmailEmail}
                        onChange={(e) => setGmailEmail(e.target.value)}
                        placeholder="name@gmail.com"
                        className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                      />
                    </label>
                    <label className="text-sm text-[#7A7265]">
                      App Password
                      {editingIntegrationId != null && (
                        <span className="ml-1 text-[11px] font-normal text-[#A89880]">— пусто = оставить текущий</span>
                      )}
                      <input
                        type="password"
                        autoComplete="off"
                        value={gmailAppPassword}
                        onChange={(e) => setGmailAppPassword(e.target.value)}
                        placeholder={editingIntegrationId != null ? "Оставьте пустым, чтобы не менять" : "16-символьный пароль приложения"}
                        className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                      />
                    </label>
                    <label className="text-sm text-[#7A7265]">
                      IMAP host
                      <input
                        value={gmailImapHost}
                        onChange={(e) => setGmailImapHost(e.target.value)}
                        placeholder="imap.gmail.com"
                        className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                      />
                    </label>
                  </div>
                ) : (
                  <label className="text-sm text-[#7A7265]">
                    Config (JSON)
                    <textarea
                      value={integrationConfigText}
                      onChange={(e) => setIntegrationConfigText(e.target.value)}
                      rows={5}
                      className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 font-mono text-xs"
                    />
                  </label>
                )}

                <div className="rounded-xl border border-[#E1D9C6]/60 bg-[#FAF8F4] p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#7A7265]">Шаблоны сообщений</p>
                  <p className="mt-1 text-[11px] text-[#A89880]">
                    Переменные: {"{name}"}, {"{date}"}, {"{time}"}, {"{manager}"}
                  </p>
                  <div className="mt-2 grid gap-2">
                    <label className="text-sm text-[#7A7265]">
                      Приветствие
                      <textarea
                        value={tplGreeting}
                        onChange={(e) => setTplGreeting(e.target.value)}
                        rows={2}
                        className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                      />
                    </label>
                    <label className="text-sm text-[#7A7265]">
                      Подтверждение записи
                      <textarea
                        value={tplConfirm}
                        onChange={(e) => setTplConfirm(e.target.value)}
                        rows={2}
                        className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                      />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="text-sm text-[#7A7265]">
                        Напоминание за 24ч
                        <textarea
                          value={tplReminder24h}
                          onChange={(e) => setTplReminder24h(e.target.value)}
                          rows={2}
                          className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                        />
                      </label>
                      <label className="text-sm text-[#7A7265]">
                        Напоминание за 2ч
                        <textarea
                          value={tplReminder2h}
                          onChange={(e) => setTplReminder2h(e.target.value)}
                          rows={2}
                          className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                        />
                      </label>
                    </div>
                    <label className="text-sm text-[#7A7265]">
                      Реактивация
                      <textarea
                        value={tplReactivation}
                        onChange={(e) => setTplReactivation(e.target.value)}
                        rows={2}
                        className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                      />
                    </label>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => void submitCreateIntegration()}
                    className="btn-primary w-full py-2.5"
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
                      className="w-full rounded-xl border border-[#E1D9C6] py-2 text-sm text-[#7A7265] transition hover:bg-[#F7F4EB]/40"
                    >
                      Отменить редактирование
                    </button>
                  )}
                </div>
                {integrationProvider === "green_api" ? (
                  <p className="text-[11px] text-[#A89880]">
                    Ошибка про адрес API: задайте <span className="font-mono text-[#7A7265]">public_api_base_url</span> на
                    сервере или сохраняйте интеграцию с того же сайта, где открыт API.
                  </p>
                ) : integrationProvider === "google_sheets" ? (
                  <p className="text-[11px] text-[#A89880]">
                    После сохранения нажмите «Синхронизировать» в списке для первой загрузки строк.
                  </p>
                ) : integrationProvider === "instagram" ? (
                  <p className="text-[11px] text-[#A89880]">
                    В подписках webhook укажите этот Callback URL, verify token = секрет выше. Лиды с форм и новые
                    директ-сообщения подтянутся в CRM автоматически.
                  </p>
                ) : integrationProvider === "gmail" ? (
                  <p className="text-[11px] text-[#A89880]">
                    Используйте только пароль приложения Google. Обычный пароль аккаунта не подойдет.
                  </p>
                ) : (
                  <p className="text-[11px] text-[#A89880]">
                    Скопируйте webhook URL из списка справа и укажите секрет в @BotFather.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-[#E1D9C6]/50 bg-white p-4 lg:sticky lg:top-4 lg:self-start">
              <div className="lux-subheading">Подключённые интеграции</div>
              <p className="mt-1 text-[11px] text-[#A89880]">Webhook, синхронизация, изменение</p>
              <div className="mt-3 max-h-[min(520px,70vh)] space-y-2 overflow-y-auto">
                {integrationsQuery.isLoading && <p className="text-sm text-[#7A7265]">Загрузка…</p>}
                {(integrationsQuery.data ?? []).length === 0 && !integrationsQuery.isLoading && (
                  <p className="text-sm text-[#A89880]">Пока нет — выберите канал выше</p>
                )}
                {(integrationsQuery.data ?? []).map((it) => (
                  <IntegrationCard
                    key={it.id}
                    it={it}
                    onEdit={() => beginEditIntegration(it)}
                    onSync={() => void syncSheetsNow(it.id)}
                    onBackfill={() => void greenBackfillNow(it.id)}
                    backfillLoading={backfillLoadingIntegrationId === it.id}
                    onBroadcast={() => {
                      setBroadcastIntegrationId(it.id);
                      setBroadcastSource("database");
                      setBroadcastText("");
                      setBroadcastExcelColumn("phone");
                      setBroadcastFile(null);
                      setBroadcastPreview(null);
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {broadcastIntegrationId != null && (
        <div className="mo-section mt-4 border-[#0F4C3A]/25 bg-[#EDF7F1]/50">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="lux-subheading">Рассылка WhatsApp</h3>
            <button
              type="button"
              onClick={() => {
                setBroadcastIntegrationId(null);
                setBroadcastPreview(null);
              }}
              className="rounded-lg border border-[#DCD1B4] px-2 py-1 text-xs text-[#7A7265] hover:bg-[#F7F4EB]/40"
            >
              Закрыть
            </button>
          </div>
          <div className="grid gap-3">
            <label className="text-sm text-[#7A7265]">
              Источник номеров
              <select
                value={broadcastSource}
                onChange={(e) => {
                  setBroadcastSource(e.target.value === "excel" ? "excel" : "database");
                  setBroadcastPreview(null);
                  setBroadcastLastResult(null);
                }}
                className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
              >
                <option value="database">Из базы (телефоны лидов)</option>
                <option value="excel">Загрузить Excel / CSV</option>
              </select>
            </label>
            {broadcastSource === "excel" && (
              <>
                <label className="text-sm text-[#7A7265]">
                  Файл (.xlsx или .csv)
                  <input
                    type="file"
                    accept=".xlsx,.csv"
                    onChange={(e) => {
                      setBroadcastFile(e.target.files?.[0] ?? null);
                      setBroadcastPreview(null);
                      setBroadcastLastResult(null);
                    }}
                    className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                  />
                </label>
                <label className="text-sm text-[#7A7265]">
                  Колонка телефона (для xlsx)
                  <input
                    value={broadcastExcelColumn}
                    onChange={(e) => {
                      setBroadcastExcelColumn(e.target.value);
                      setBroadcastPreview(null);
                      setBroadcastLastResult(null);
                    }}
                    placeholder="phone"
                    className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
                  />
                </label>
              </>
            )}
            <label className="text-sm text-[#7A7265]">
              Текст сообщения
              <textarea
                value={broadcastText}
                onChange={(e) => setBroadcastText(e.target.value)}
                rows={4}
                className="mt-1 w-full rounded-xl border border-[#E1D9C6] bg-white mo-input py-2 text-sm"
              />
            </label>
            {broadcastPreview ? (
              <div className="rounded-xl border border-[#0F4C3A]/25 bg-white px-3 py-2 text-xs text-[#2C2520]">
                Найдено номеров: {broadcastPreview.found_count}. К отправке (с лимитом): {broadcastPreview.limited_count}.
              </div>
            ) : null}
            {broadcastLastResult ? (
              <div className="rounded-xl border border-[#DCD1B4] bg-white px-3 py-2 text-xs text-[#2C2520]">
                Рассылка завершена: отправлено {broadcastLastResult.sent_count} из {broadcastLastResult.requested_count}
                {broadcastLastResult.failed_count > 0 ? `, ошибок ${broadcastLastResult.failed_count}` : ", без ошибок"}.
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void previewGreenBroadcast()}
                disabled={broadcastSending}
                className="crm-pill-btn disabled:cursor-not-allowed disabled:opacity-60"
              >
                {previewLoading ? "Считаем..." : "Предпросмотр"}
              </button>
              <button
                type="button"
                onClick={() => void sendGreenBroadcast()}
                disabled={broadcastSending}
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {broadcastSending ? "Отправляем..." : "Отправить всем"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
