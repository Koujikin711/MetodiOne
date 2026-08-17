export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "mo-theme";

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === "dark" || raw === "light") return raw;
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
  localStorage.setItem(STORAGE_KEY, mode);
}

function withThemeTransition(apply: () => void) {
  if (typeof document === "undefined") {
    apply();
    return;
  }
  const root = document.documentElement;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> };
  };

  if (reduced) {
    apply();
    return;
  }

  /** Длительность должна совпадать с CSS --mo-duration-theme. */
  const DURATION_MS = 820;

  if (typeof doc.startViewTransition === "function") {
    root.classList.add("theme-transitioning");
    const vt = doc.startViewTransition(apply);
    void vt.finished.finally(() => {
      root.classList.remove("theme-transitioning");
    });
    return;
  }

  root.classList.add("theme-transitioning");
  // Двойной rAF — браузер успевает зафиксировать «до», потом меняем тему.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      apply();
      window.setTimeout(() => root.classList.remove("theme-transitioning"), DURATION_MS);
    });
  });
}

export function toggleTheme(): ThemeMode {
  const next: ThemeMode = getStoredTheme() === "dark" ? "light" : "dark";
  withThemeTransition(() => applyTheme(next));
  return next;
}

/** Вызывать до первого рендера React, чтобы не мигал светлый фон. */
export function initTheme() {
  applyTheme(getStoredTheme());
}
