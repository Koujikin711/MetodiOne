import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { GradientIconBox } from "@/components/GradientIconBox";
import { ChevronDown, LogOut, Moon, Sun } from "@/components/icons";
import { ShellNavIcon } from "@/components/ShellNavLink";
import type { ShellSidebarNavItem } from "@/lib/shellSidebarNavItems";
import { getStoredTheme, toggleTheme, type ThemeMode } from "@/lib/themeMode";

type Props = {
  items: ShellSidebarNavItem[];
  expanded: boolean;
  onLogout: () => void;
};

function SettingsSubLink({
  item,
  expanded,
}: {
  item: ShellSidebarNavItem;
  expanded: boolean;
}) {
  if (!expanded) {
    return (
      <NavLink
        to={item.to}
        end={item.end}
        preventScrollReset
        title={item.title}
        className={({ isActive }) =>
          ["shell-nav-link shell-settings-sub-link", isActive ? "is-active" : ""].filter(Boolean).join(" ")
        }
      >
        <GradientIconBox variant={item.variant} className="shell-nav-icon-box">
          <ShellNavIcon iconKey={item.iconKey} />
        </GradientIconBox>
        <span className="shell-nav-label">{item.labelShort}</span>
      </NavLink>
    );
  }

  return (
    <NavLink
      to={item.to}
      end={item.end}
      preventScrollReset
      title={item.title}
      className={({ isActive }) =>
        ["shell-settings-text-link", isActive ? "is-active" : ""].filter(Boolean).join(" ")
      }
    >
      {item.labelFull}
    </NavLink>
  );
}

export function ShellSidebarSettingsMenu({ items, expanded, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const location = useLocation();

  const routeActive = items.some((item) => {
    if (item.end) return location.pathname === item.to;
    return location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
  });

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
  const toggleLabel = open ? "Скрыть" : "Настройки";
  const toggleShort = open ? "Скрыть" : "Настр.";

  return (
    <div className={["shell-settings-root", open ? "is-open" : "", routeActive ? "has-active" : ""].filter(Boolean).join(" ")}>
      <button
        type="button"
        title={open ? "Скрыть настройки" : "Настройки"}
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
            <>
              <button type="button" role="menuitem" className="shell-nav-link shell-settings-sub-link" onClick={() => setTheme(toggleTheme())}>
                <span className="shell-nav-icon-box inline-flex items-center justify-center rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] text-[var(--mo-text)]">
                  {isDark ? <Sun className="shell-nav-icon-glyph" /> : <Moon className="shell-nav-icon-glyph" />}
                </span>
                <span className="shell-nav-label">{themeShort}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="shell-nav-link shell-settings-sub-link shell-settings-sub-link--logout"
                onClick={() => {
                  onLogout();
                }}
              >
                <GradientIconBox variant="pink" className="shell-nav-icon-box">
                  <LogOut className="shell-nav-icon-glyph" />
                </GradientIconBox>
                <span className="shell-nav-label">Выход</span>
              </button>
            </>
          ) : (
            <>
              <button type="button" role="menuitem" className="shell-settings-text-link" onClick={() => setTheme(toggleTheme())}>
                {themeLabel}
              </button>
              <button
                type="button"
                role="menuitem"
                className="shell-settings-text-link shell-settings-text-link--logout"
                onClick={() => {
                  onLogout();
                }}
              >
                Выход
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
