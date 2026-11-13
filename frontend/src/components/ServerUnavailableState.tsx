type Props = {
  message?: string;
  onRetry?: () => void;
};

/** Экран 502/503/504 — робот в проводах, в стиле MetodiOne. */
export function ServerUnavailableState({ message, onRetry }: Props) {
  return (
    <div
      className="mx-auto flex w-full max-w-lg flex-col items-center px-4 py-10 text-center sm:py-14"
      role="alert"
      aria-live="polite"
    >
      <img
        src="/server-unavailable-robot.png"
        alt=""
        width={280}
        height={280}
        className="h-auto w-[min(17rem,72vw)] select-none object-contain"
        draggable={false}
      />
      <h2 className="lux-heading mt-6 text-[1.35rem] leading-snug text-[var(--mo-text)] sm:text-[1.5rem]">
        Сервер клиники сейчас отдыхает
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--mo-text-muted)]">
        {message?.trim() ||
          "Связь с API временно пропала. Подождите немного и обновите — обычно это проходит само."}
      </p>
      {onRetry ? (
        <button type="button" className="btn-primary mt-6 min-h-11 px-5" onClick={onRetry}>
          Повторить
        </button>
      ) : (
        <button
          type="button"
          className="btn-primary mt-6 min-h-11 px-5"
          onClick={() => window.location.reload()}
        >
          Обновить страницу
        </button>
      )}
    </div>
  );
}

export function isServerUnavailableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return (
    /временно недоступен\s*\(50[234]\)/i.test(msg) ||
    /Сервер не ответил за \d+ с/i.test(msg) ||
    /Нет связи с (сервером|API)/i.test(msg)
  );
}
