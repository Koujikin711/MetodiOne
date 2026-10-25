import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { GradientIconBox } from "@/components/GradientIconBox";
import { ChevronDown, Moon, Sun } from "@/components/icons";
import { ShellNavIcon } from "@/components/ShellNavLink";
import type { ShellSidebarNavItem } from "@/lib/shellSidebarNavItems";
import { getStoredTheme, toggleTheme, type ThemeMode } from "@/lib/themeMode";

type Props = {
  items: ShellSidebarNavItem[];
  expanded: boolean;
};

function itemActive(pathname: string, to: string, end?: boolean) {
  if (pathname === to) return true;
  if (end) return false;
  return pathname.startsWith(to.endsWith("/") ? to : `${to}/`);
}

function SettingsSubLink({
  item,
  expanded,
}: {
  item: ShellSidebarNavItem;
  expanded: boolean;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const active = itemActive(pathname, item.to, item.end);
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => navigate(item.to)}
        className={["shell-nav-link shell-settings-sub-link", active ? "is-active" : ""].filter(Boolean).join(" ")}
      >
        <GradientIconBox variant={item.variant} className="shell-nav-icon-box">
          <ShellNavIcon iconKey={item.iconKey} />
        </GradientIconBox>
        <span className="shell-nav-label">{item.labelShort}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => navigate(item.to)}
      className={["shell-settings-text-link", active ? "is-active" : ""].filter(Boolean).join(" ")}
    >
      {item.labelFull}
    </button>
  );
}

export function ShellSidebarSettingsMenu({ items, expanded }: Props) {
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const location = useLocation();

  const routeActive = items.some((item) => {
    if (item.end) return location.pathname === item.to;
    return location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
  });

  const [open, setOpen] = useState(routeActive);

  useEffect(() => {
    if (routeActive) {
      setOpen(true);
    }
  }, [routeActive, location.pathname]);

  useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() => {
      const t = root.dataset.theme;
      if (t === "dark" || t === "light") setTheme(t);
    });
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  const isDark = theme === "dark";
  const themeLabel = isDark ? "Светлая тема" : "Тёмная тема";
  const themeShort = isDark ? "Светлая" : "Тёмная";
  const toggleLabel = open ? "Скрыть" : "Доп";
  const toggleShort = open ? "Скрыть" : "Доп";

  return (
    <div className={["shell-settings-root", open ? "is-open" : "", routeActive ? "has-active" : ""].filter(Boolean).join(" ")}>
      <button
        type="button"
        aria-label={open ? "Скрыть" : "Дополнительно"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="shell-settings-toggle"
      >
        <ChevronDown className="shell-settings-chevron" aria-hidden />
        <span className="shell-settings-toggle-text">{expanded ? toggleLabel : toggleShort}</span>
      </button>

      {open ? (
        <div className="shell-settings-panel" role="menu">
          {items.map((item) => (
            <SettingsSubLink key={item.id} item={item} expanded={expanded} />
          ))}
          {!expanded ? (
            <button type="button" role="menuitem" className="shell-nav-link shell-settings-sub-link" onClick={() => setTheme(toggleTheme())}>
              <span className="shell-nav-icon-box inline-flex items-center justify-center rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] text-[var(--mo-text)]">
                {isDark ? <Sun className="shell-nav-icon-glyph" /> : <Moon className="shell-nav-icon-glyph" />}
              </span>
              <span className="shell-nav-label">{themeShort}</span>
            </button>
          ) : (
            <button type="button" role="menuitem" className="shell-settings-text-link" onClick={() => setTheme(toggleTheme())}>
              {themeLabel}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
