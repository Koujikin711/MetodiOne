import { useEffect, useRef, useState } from "react";
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

function SettingsRowLink({
  item,
  onNavigate,
}: {
  item: ShellSidebarNavItem;
  onNavigate: () => void;
}) {
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
      <GradientIconBox variant={item.variant} className="h-8 w-8 shrink-0 rounded-lg [&_svg]:h-4 [&_svg]:w-4">
        <ShellNavIcon iconKey={item.iconKey} />
      </GradientIconBox>
      <span className="min-w-0 truncate font-medium">{item.labelFull}</span>
    </NavLink>
  );
}

export function ShellSidebarSettingsMenu({ items, expanded, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const rootRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  const routeActive = items.some((item) => {
    if (item.end) return location.pathname === item.to;
    return location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
  });

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

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

  return (
    <div ref={rootRef} className="shell-settings-root relative">
      <button
        type="button"
        title="Настройки"
        aria-expanded={open}
        aria-haspopup="menu"
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
        <div
          role="menu"
          className={[
            "shell-settings-flyout",
            expanded ? "shell-settings-flyout--expanded" : "shell-settings-flyout--collapsed",
          ].join(" ")}
        >
          <p className="shell-settings-flyout-title">Настройки</p>
          <div className="shell-settings-flyout-list no-scrollbar max-h-[min(70vh,22rem)] overflow-y-auto">
            {items.map((item) => (
              <SettingsRowLink key={item.id} item={item} onNavigate={() => setOpen(false)} />
            ))}
          </div>
          <div className="shell-settings-flyout-divider" />
          <button type="button" role="menuitem" className="shell-settings-row" onClick={() => setTheme(toggleTheme())}>
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] text-[var(--mo-text)]">
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </span>
            <span className="min-w-0 truncate font-medium">{themeLabel}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="shell-settings-row shell-settings-row--logout"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <GradientIconBox variant="pink" className="h-8 w-8 shrink-0 rounded-lg [&_svg]:h-4 [&_svg]:w-4">
              <LogOut className="h-4 w-4" />
            </GradientIconBox>
            <span className="min-w-0 truncate font-medium">Выход</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
