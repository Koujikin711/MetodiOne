type Props = {
  /** Доп. строка под основным текстом */
  detail?: string;
  /** 0–100; если не задано — бесконечная анимация прогресса */
  progress?: number;
};

/**
 * Экран крупного обновления MetodiOne (не для коротких пушей).
 * Текст общий для всех организаций.
 */
export function AppUpdatingState({ detail, progress }: Props) {
  const pct =
    progress != null && Number.isFinite(progress)
      ? Math.max(0, Math.min(100, Math.round(progress)))
      : null;

  return (
    <div
      className="app-updating relative mx-auto flex w-full max-w-md flex-col items-center px-5 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="app-updating__glow" aria-hidden />
      <div className="app-updating__glow app-updating__glow--soft" aria-hidden />

      <div className="app-updating__scene" aria-hidden>
        <svg
          className="app-updating__art"
          viewBox="0 0 360 132"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="au-core" x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="color-mix(in srgb, var(--mo-accent) 38%, var(--mo-surface-elevated))" />
              <stop offset="1" stopColor="color-mix(in srgb, var(--mo-accent) 10%, var(--mo-surface))" />
            </linearGradient>
          </defs>

          <circle cx="300" cy="28" r="28" className="app-updating__sun" />
          <circle cx="300" cy="28" r="16" className="app-updating__sun-core" />
          <ellipse cx="70" cy="36" rx="26" ry="9" className="app-updating__haze app-updating__haze--a" />
          <ellipse cx="128" cy="24" rx="20" ry="7" className="app-updating__haze app-updating__haze--b" />
          <ellipse cx="238" cy="42" rx="22" ry="8" className="app-updating__haze app-updating__haze--c" />

          <g className="app-updating__orbits" transform="translate(180 66)">
            <circle r="44" className="app-updating__orbit-ring" />
            <circle r="44" className="app-updating__orbit-dash" />
            <circle r="24" className="app-updating__orbit-core" fill="url(#au-core)" />
            <circle r="7" className="app-updating__orbit-dot" />
            <g className="app-updating__orbit-spin">
              <circle cx="0" cy="-44" r="4" className="app-updating__orbit-bead" />
            </g>
            <g className="app-updating__orbit-spin app-updating__orbit-spin--alt">
              <circle cx="0" cy="44" r="3" className="app-updating__orbit-bead app-updating__orbit-bead--alt" />
            </g>
          </g>
        </svg>

        <div className="app-updating__bar" aria-hidden>
          <div className="app-updating__track">
            <div
              className={
                pct != null
                  ? "app-updating__fill"
                  : "app-updating__fill app-updating__fill--indeterminate"
              }
              style={pct != null ? { width: `${Math.max(pct, 4)}%` } : undefined}
            >
              <span className="app-updating__shimmer" />
            </div>
          </div>
        </div>
      </div>

      <p className="app-updating__brand">MetodiOne</p>
      <h1 className="app-updating__title">Обновление</h1>
      <p className="app-updating__text">
        Мы стараемся, чтобы MetodiOne стал ещё лучше. В данный момент идёт обновление.
      </p>
      <p className="app-updating__wait">
        {detail?.trim() || "Подождите, пожалуйста, скоро всё заработает."}
      </p>
      {pct != null ? (
        <p className="app-updating__pct" aria-hidden>
          {pct}%
        </p>
      ) : null}
    </div>
  );
}
