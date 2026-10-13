import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

type BridgeStatus = {
  reachable: boolean;
  ready: boolean;
  phone: string | null;
  connectionState: string;
  qrDataUrl: string | null;
  error: string | null;
};

export function WaQrConnectPanel() {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const json = await apiFetch<BridgeStatus>("/api/integrations/wa-bridge");
      setStatus(json);
      setNotice(null);
    } catch (err) {
      setStatus(null);
      setNotice(err instanceof Error ? err.message : "Мост WhatsApp не запущен");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(id);
  }, [load]);

  const reset = async () => {
    if (busy) return;
    if (!window.confirm("Сбросить сеанс WhatsApp и показать новый QR?")) return;
    setBusy(true);
    try {
      await apiFetch("/api/integrations/wa-bridge", {
        method: "POST",
        body: JSON.stringify({ action: "restart" }),
      });
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Мост WhatsApp не запущен");
    } finally {
      setBusy(false);
    }
  };

  const waiting = !status?.ready;
  const showQr = Boolean(status?.qrDataUrl) && waiting;
  const headline = status?.ready
    ? "Подключено"
    : status?.reachable
      ? "Ожидание сканирования"
      : "Мост WhatsApp не запущен";

  return (
    <div className="mt-5 rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-4">
      <h3 className="text-base font-semibold text-[var(--mo-text)]">WhatsApp — экстренное подключение</h3>
      <p className="mt-2 text-sm lux-caption">
        Пока Green API отвечает, чаты идут через него. Если Green API недоступен или не настроен, сообщения идут через
        этот QR-сеанс — в те же диалоги. На телефоне: WhatsApp → Связанные устройства → Привязка устройства.
      </p>
      <p className="mt-3 text-sm font-semibold text-[var(--mo-text)]">{headline}</p>
      {status?.ready && status.phone ? (
        <p className="mt-1 text-sm lux-caption">Номер: {status.phone}</p>
      ) : null}
      {status?.error && waiting ? <p className="mt-2 text-xs text-[var(--mo-warning)]">{status.error}</p> : null}
      {notice ? <p className="mt-2 text-xs text-[var(--mo-warning)]">{notice}</p> : null}
      {showQr ? (
        <img
          src={status?.qrDataUrl || ""}
          alt="WhatsApp QR"
          className="mx-auto mt-4 h-64 w-64 rounded-xl bg-white p-2"
        />
      ) : null}
      <button
        type="button"
        onClick={() => void reset()}
        disabled={busy || !status?.reachable}
        className="btn-primary mt-4 disabled:opacity-50"
      >
        {busy ? "…" : "Сбросить и показать QR"}
      </button>
    </div>
  );
}
