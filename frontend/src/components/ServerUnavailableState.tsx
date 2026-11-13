type Props = {
  message?: string;
  onRetry?: () => void;
};

/**
 * 503-экран: исходный робот из GIF (моргает левый глаз как в референсе).
 * Робот / провода / фон не двигаем отдельно — анимация уже в файле.
 */
export function ServerUnavailableState({ message, onRetry }: Props) {
  const retry = onRetry ?? (() => window.location.reload());
  const label = onRetry ? "Повторить" : "Обновить страницу";

  return (
    <div
      className="server-down relative mx-auto flex w-full max-w-xl flex-col items-center overflow-hidden px-5 py-12 text-center sm:py-16"
      role="alert"
      aria-live="polite"
    >
      <div className="server-down__glow" aria-hidden />
      <div className="server-down__figure">
          <img
            src="/server-unavailable-robot.gif?v=2"
            alt=""
            width={493}
            height={467}
            className="server-down__robot"
            draggable={false}
          />
      </div>
      <p className="server-down__eyebrow">503 · нет связи</p>
      <h2 className="server-down__title">Сервер клиники сейчас отдыхает</h2>
      <p className="server-down__text">
        {message?.trim() ||
          "Связь с API временно пропала. Подождите немного и обновите — обычно это проходит само."}
      </p>
      <button type="button" className="btn-primary server-down__cta" onClick={retry}>
        {label}
      </button>
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
