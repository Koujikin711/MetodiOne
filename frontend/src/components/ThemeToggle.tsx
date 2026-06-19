import { useEffect, useState } from "react";

import { Moon, Sun } from "@/components/icons";
import { getStoredTheme, toggleTheme, type ThemeMode } from "@/lib/themeMode";

type Props = {
  compact?: boolean;
  className?: string;
  sidebar?: boolean;
  expanded?: boolean;
};

export function ThemeToggle({ compact = false, className = "", sidebar = false, expanded = true }: Props) {
  const [mode, setMode] = useState<ThemeMode>(() => getStoredTheme());

  useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() => {
      const t = root.dataset.theme;
      if (t === "dark" || t === "light") setMode(t);
    });
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  function onClick() {
    setMode(toggleTheme());
  }

  const isDark = mode === "dark";
  const label = isDark ? "Светлая тема" : "Тёмная тема";

  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={[
          "rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-2 mo-muted transition hover:border-[var(--mo-gold)] hover:text-[var(--mo-text)]",
          className,
        ].join(" ")}
        title={label}
        aria-label={label}
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    );
  }

  if (sidebar) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={[
          "shell-nav-link group",
          expanded ? "shell-nav-link--expanded" : "shell-nav-link--collapsed",
          className,
        ].join(" ")}
        title={label}
        aria-label={label}
      >
        <span className="shell-nav-icon-box inline-flex h-10 w-10 items-center justify-center rounded-xl">
          {isDark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
        </span>
        <span className="shell-nav-text">{isDark ? "Светлая тема" : "Тёмная тема"}</span>
        <span className="shell-nav-label">{isDark ? "Светлая" : "Тёмная"}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "shell-nav-link group flex w-full flex-col items-center gap-2 px-1 py-2.5 text-center",
        className,
      ].join(" ")}
      title={label}
      aria-label={label}
    >
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] shadow-[var(--mo-shadow-luxury)] mo-muted transition group-hover:border-[var(--mo-gold)] group-hover:text-[var(--mo-text)]">
        {isDark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
      </span>
      <span className="shell-nav-label max-w-[4rem]">{isDark ? "Светлая" : "Тёмная"}</span>
    </button>
  );
}
