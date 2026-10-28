import { useEffect, useState } from "react";

/**
 * DEV: «Изменить имя» в модалке записи (мок).
 */

export function DevBookingRenamePreview() {
  const [name, setName] = useState("Курбонзода хусейн");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  useEffect(() => {
    const root = document.documentElement;
    const prev = root.dataset.theme;
    root.dataset.theme = "dark";
    return () => {
      if (prev) root.dataset.theme = prev;
      else delete root.dataset.theme;
    };
  }, []);

  return (
    <div className="app-shell-bg min-h-[100dvh] px-4 py-5 text-[var(--mo-text)] sm:px-6">
      <p className="mo-muted mb-2 text-[11px] tracking-wide">Локально · правка ФИО в записи</p>
      <h1 className="lux-heading-page text-[1.35rem]">Изменить имя пациента</h1>
      <p className="mo-muted mt-2 max-w-2xl text-sm leading-relaxed">
        В модалке записи: «Изменить имя» → «Курбонзода Хусейн» → Сохранить. Если есть карточка CRM — имя
        обновится и там.
      </p>

      <div className="mt-6 flex justify-center">
        <div className="booking-appt-detail-modal mo-card w-full max-w-md">
          <div className="booking-appt-detail-modal__body">
            <p className="booking-appt-detail-modal__eyebrow">Запись клиента</p>
            {editing ? (
              <div className="mt-1 space-y-2">
                <input
                  className="mo-input w-full text-base font-semibold"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-primary px-3 py-1.5 text-xs"
                    onClick={() => {
                      const next = draft.trim();
                      if (next) setName(next);
                      setEditing(false);
                    }}
                  >
                    Сохранить
                  </button>
                  <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setEditing(false)}>
                    Отмена
                  </button>
                </div>
                <p className="text-[11px] mo-muted">Сохранится и в карточке CRM.</p>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <p className="booking-appt-detail-modal__name">{name}</p>
                <button
                  type="button"
                  className="shrink-0 text-xs underline"
                  onClick={() => {
                    setDraft(name);
                    setEditing(true);
                  }}
                >
                  Изменить имя
                </button>
              </div>
            )}
            <div className="booking-appt-detail-modal__meta-row mt-2">
              <span>02 окт., 16:00</span>
              <span className="booking-appt-detail-modal__service">Услуга: Протокол</span>
            </div>
          </div>
          <footer className="booking-appt-detail-modal__foot">
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs">
              Карточка в CRM
            </button>
            <button type="button" className="btn-primary px-3 py-1.5 text-xs">
              Закрыть
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
