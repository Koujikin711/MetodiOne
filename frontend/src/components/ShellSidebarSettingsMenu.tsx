import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { GradientIconBox } from "@/components/GradientIconBox";
import { LogOut, Moon, Settings, Sun } from "@/components/icons";
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
  onNavigate,
}: {
  item: ShellSidebarNavItem;
  expanded: boolean;
  onNavigate: () => void;
}) {
  if (!expanded) {
    return (
      <NavLink
        to={item.to}
        end={item.end}
        preventScrollReset
        title={item.title}
        onClick={onNavigate}
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
      onClick={onNavigate}
      className={({ isActive }) =>
        ["shell-settings-row", isActive ? "is-active" : ""].filter(Boolean).join(" ")
      }
    >
      <GradientIconBox variant={item.variant} className="shell-settings-row-icon">
        <ShellNavIcon iconKey={item.iconKey} />
      </GradientIconBox>
      <span className="min-w-0 truncate font-medium">{item.labelFull}</span>
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
    setOpen(false);
  }, [location.pathname]);

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

  return (
    <div className={["shell-settings-root", open ? "is-open" : ""].filter(Boolean).join(" ")}>
      <button
        type="button"
        title="Настройки"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={["shell-nav-link group w-full", open || routeActive ? "is-active" : ""].filter(Boolean).join(" ")}
      >
        <GradientIconBox variant="platform" className="shell-nav-icon-box">
          <Settings className="shell-nav-icon-glyph" />
        </GradientIconBox>
        <span className="shell-nav-text">Настройки</span>
        <span className="shell-nav-label">Настр.</span>
      </button>

      {open ? (
        <div className="shell-settings-panel" role="menu">
          {items.map((item) => (
            <SettingsSubLink key={item.id} item={item} expanded={expanded} onNavigate={() => setOpen(false)} />
          ))}
          <div className="shell-settings-panel-divider" />
          {!expanded ? (
            <button type="button" role="menuitem" className="shell-nav-link shell-settings-sub-link" onClick={() => setTheme(toggleTheme())}>
              <span className="shell-nav-icon-box inline-flex items-center justify-center rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] text-[var(--mo-text)]">
                {isDark ? <Sun className="shell-nav-icon-glyph" /> : <Moon className="shell-nav-icon-glyph" />}
              </span>
              <span className="shell-nav-label">{themeShort}</span>
            </button>
          ) : (
            <button type="button" role="menuitem" className="shell-settings-row" onClick={() => setTheme(toggleTheme())}>
              <span className="shell-settings-row-icon inline-flex items-center justify-center rounded-lg border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] text-[var(--mo-text)]">
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </span>
              <span className="min-w-0 truncate font-medium">{themeLabel}</span>
            </button>
          )}
          {!expanded ? (
            <button
              type="button"
              role="menuitem"
              className="shell-nav-link shell-settings-sub-link shell-settings-sub-link--logout"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
            >
              <GradientIconBox variant="pink" className="shell-nav-icon-box">
                <LogOut className="shell-nav-icon-glyph" />
              </GradientIconBox>
              <span className="shell-nav-label">Выход</span>
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="shell-settings-row shell-settings-row--logout"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
            >
              <GradientIconBox variant="pink" className="shell-settings-row-icon">
                <LogOut className="h-4 w-4" />
              </GradientIconBox>
              <span className="min-w-0 truncate font-medium">Выход</span>
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
