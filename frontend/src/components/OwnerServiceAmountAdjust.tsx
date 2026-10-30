import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Pencil } from "@/components/icons";
import { formatMoney } from "@/lib/money";

/** Карандаш у колонки «Сумма»: смена стоимости курса/протокола. */
export function OwnerServiceAmountAdjust({
  serviceAmount,
  paidAmount,
  pending,
  onApply,
}: {
  serviceAmount: number;
  paidAmount: number;
  pending: boolean;
  onApply: (body: { service_amount: number; reason: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(serviceAmount));
  const [reason, setReason] = useState("");
  const parsed = Number(String(amount).replace(",", "."));
  const validAmount = Number.isFinite(parsed) && parsed >= 0;
  const tooLow = validAmount && paidAmount > 0 && parsed + 0.001 < paidAmount;
  const reasonOk = reason.trim().length >= 3;
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function close() {
    setOpen(false);
    setReason("");
    setAmount(String(serviceAmount));
  }

  useEffect(() => {
    if (!open) setAmount(String(serviceAmount));
  }, [serviceAmount, open]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function place() {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = 380;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      let top = r.bottom + 6;
      if (top + 200 > window.innerHeight - 8) top = Math.max(8, r.top - 200);
      setPos({ top, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    function onPointer(e: MouseEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (panelRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      close();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const panel =
    open && pos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            className="owner-paid-adjust print-omit fixed z-[90] w-[24rem] max-w-[calc(100vw-1rem)] rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-3 shadow-xl"
            style={{ top: pos.top, left: pos.left }}
            role="dialog"
            aria-label="Изменить стоимость"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] font-semibold text-[var(--mo-text)]">Стоимость продажи</p>
              <button
                type="button"
                className="mo-muted -mr-1 -mt-0.5 rounded-md px-2 py-0.5 text-[11px] hover:bg-[var(--mo-accent-soft)] hover:text-[var(--mo-text)]"
                aria-label="Закрыть"
                onClick={close}
              >
                Закрыть
              </button>
            </div>
            <p className="text-[11px] mo-muted">
              Сейчас {formatMoney(serviceAmount)}, оплачено {formatMoney(paidAmount)}. Запись попадёт в
              аудит.
            </p>
            <div className="mt-1.5 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-[11px] mo-muted">
                Новая сумма
                <input
                  type="number"
                  min={0}
                  inputMode="decimal"
                  className="mo-input w-28 !min-h-9 text-sm"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-label="Новая стоимость"
                />
              </label>
              <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[11px] mo-muted">
                Причина
                <input
                  className="mo-input !min-h-9 text-sm"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Почему меняем цену"
                  aria-label="Причина смены стоимости"
                />
              </label>
              <button
                type="button"
                className="btn-secondary min-h-9 px-3 text-sm disabled:opacity-50"
                disabled={pending || !validAmount || !reasonOk || tooLow}
                onClick={() => {
                  if (!validAmount || !reasonOk || tooLow) return;
                  onApply({ service_amount: parsed, reason: reason.trim() });
                  close();
                }}
              >
                Сохранить
              </button>
            </div>
            {tooLow ? (
              <p className="mt-1 text-[11px] text-red-300">
                Нельзя поставить меньше уже оплаченного ({formatMoney(paidAmount)}).
              </p>
            ) : validAmount && parsed !== serviceAmount ? (
              <p className="mt-1 text-[11px] mo-muted">
                Долг станет {formatMoney(Math.max(parsed - paidAmount, 0))}.
              </p>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <span className="owner-paid-adjust print-omit ml-1 inline-flex align-middle">
      <button
        ref={btnRef}
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--mo-text)] hover:bg-[var(--mo-accent-soft)]"
        aria-label={open ? "Скрыть правку стоимости" : "Изменить стоимость"}
        title={open ? "Скрыть" : "Изменить стоимость"}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      {panel}
    </span>
  );
}
