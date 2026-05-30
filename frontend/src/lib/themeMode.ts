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

export function toggleTheme(): ThemeMode {
  const next: ThemeMode = getStoredTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}

/** Вызывать до первого рендера React, чтобы не мигал светлый фон. */
export function initTheme() {
  applyTheme(getStoredTheme());
}
