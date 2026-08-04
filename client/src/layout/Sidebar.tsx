import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { getAppVersion } from "../lib/appVersion";
import { isTauriEnv } from "../lib/tauriEnv";
import { Sun, Moon, MoonStar, Flower2, ChevronDown } from "lucide-react";
import clsx from "clsx";
import { useThemeStore } from "../state/theme";
import { useTr } from "../state/lang";
import { useLogsStore } from "../state/logs";
import { useUpdateStore } from "../state/update";
import RosterPicker from "./RosterPicker";
import NotificationInbox from "./NotificationInbox";
import { NAV_ITEMS, groupNavItems } from "./navItems";
import type { Theme } from "../state/theme";

/** Friendly label for the active theme. Pulled out so the toggle row
 *  in the footer doesn't need a chained ternary. */
function themeLabel(
  theme: Theme,
  tr: (
    key: string,
    vars?: Record<string, string | number>,
    fallback?: string,
  ) => string,
): string {
  if (theme === "light") return tr("light_mode", undefined, "PS5 Light");
  if (theme === "oled") return tr("oled_mode", undefined, "OLED mode");
  if (theme === "rose") return tr("rose_mode", undefined, "Rose");
  return tr("dark_mode", undefined, "PS5 Dark");
}

/** Icon picker that mirrors `themeLabel`. One icon per state keeps each
 *  visually distinct: sun (PS5 Light) → moon (PS5 Dark) → moon-star
 *  (OLED) → flower (Rose). The toggle button cycles through these in order. */
function themeIcon(theme: Theme) {
  if (theme === "light") return <Sun size={14} />;
  if (theme === "oled") return <MoonStar size={14} />;
  if (theme === "rose") return <Flower2 size={14} />;
  return <Moon size={14} />;
}

export default function Sidebar({
  onNavigate,
}: {
  /** Called when a nav item is tapped — used by the mobile drawer to
   *  close itself after navigation. No-op on desktop (inline sidebar). */
  onNavigate?: () => void;
} = {}) {
  const { theme, toggleTheme } = useThemeStore();
  const tr = useTr();
  const errorCount = useLogsStore(
    (s) => s.entries.filter((e) => e.level === "error").length,
  );
  const updateAvailable = useUpdateStore((s) => s.phase.kind === "available");
  const [version, setVersion] = useState<string>("");
  useEffect(() => {
    getAppVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  const location = useLocation();

  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("sidebar-collapsed-sections");
      if (stored) return new Set(JSON.parse(stored) as string[]);
    } catch {
      /* ignore malformed storage */
    }
    return new Set();
  });

  const toggleSection = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(
          "sidebar-collapsed-sections",
          JSON.stringify([...next]),
        );
      } catch {
        /* ignore quota / private mode */
      }
      return next;
    });
  }, []);

  const groups = useMemo(
    () =>
      groupNavItems(
        NAV_ITEMS.filter((item) => !item.hideInBrowser || isTauriEnv()),
      ),
    [],
  );

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-2)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
      {/* Brand header — compact, logo + name + version in a single
          row. Subtle border below separates it from the nav. */}
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3.5">
        <img
          src="/logo-square.png"
          alt=""
          aria-hidden
          className="h-11 w-11 shrink-0 rounded-lg"
        />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-base font-bold tracking-tight">
            PS5Upload
          </span>
          <span className="truncate text-xs text-[var(--color-muted)]">
            {version ? `v${version}` : "—"}
          </span>
        </div>
      </div>

      {/* Multi-PS5 picker — sits between the brand header and nav.
          Always present so the user can switch consoles from any
          screen without context-switching. Migrates legacy single-
          host users to a default profile on first mount via
          ensureRosterMigrated() in AppShell. */}
      <RosterPicker />

      {/* Navigation — grouped by collapsible section. Each section header
          is a button that toggles its items' visibility. Collapse state
          persists to localStorage; the section containing the active route
          is always rendered expanded so the active item stays visible. */}
      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.map((group, gIdx) => {
          const isActiveSection =
            location.pathname !== "/" &&
            group.items.some((i) => location.pathname.startsWith(i.to));
          const isCollapsed = !isActiveSection && collapsed.has(group.section.key);
          return (
            <div key={group.section.key} className={gIdx === 0 ? "" : "mt-2"}>
              <button
                type="button"
                onClick={() => toggleSection(group.section.key)}
                aria-expanded={!isCollapsed}
                aria-controls={`sidebar-section-${group.section.key}`}
                className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              >
                <ChevronDown
                  size={12}
                  strokeWidth={2}
                  className={clsx(
                    "shrink-0 transition-transform duration-150",
                    isCollapsed && "-rotate-90",
                  )}
                />
                {tr(group.section.key, undefined, group.section.fallback)}
              </button>
              {!isCollapsed && (
                <div
                  id={`sidebar-section-${group.section.key}`}
                  role="region"
                  className="mb-1 mt-0.5"
                >
                  {group.items.map(({ to, key, fallback, icon: Icon }) => {
                    const isLogs = to === "/logs";
                    const isSettings = to === "/settings";
                    return (
                      <NavLink
                        key={to}
                        to={to}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          clsx(
                            "group flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                            isActive
                              ? "bg-[var(--color-accent)] font-medium text-[var(--color-accent-contrast)]"
                              : "text-[var(--color-text)] hover:bg-[var(--color-surface-3)]",
                          )
                        }
                      >
                        <Icon size={16} strokeWidth={1.75} />
                        <span className="min-w-0 flex-1 truncate">
                          {tr(key, undefined, fallback)}
                        </span>
                        {isLogs && errorCount > 0 && (
                          <span
                            className="rounded-full bg-[var(--color-bad)] px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white group-[.active]:bg-white group-[.active]:text-[var(--color-bad)]"
                            title={tr(
                              errorCount === 1
                                ? "logged_error_one"
                                : "logged_error_many",
                              { count: errorCount },
                              `${errorCount} logged error${errorCount === 1 ? "" : "s"}`,
                            )}
                          >
                            {errorCount > 99 ? "99+" : errorCount}
                          </span>
                        )}
                        {isSettings && updateAvailable && (
                          <span
                            className="h-2 w-2 rounded-full bg-[var(--color-accent)] group-[.active]:bg-[var(--color-accent-contrast)]"
                            aria-label={tr(
                              "update_available_short",
                              undefined,
                              "Update available",
                            )}
                            title={tr(
                              "update_available_tooltip",
                              undefined,
                              "Update available — open Settings to install",
                            )}
                          />
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Theme toggle + notification inbox — minimal footer row.
          The inbox bell shows unread count badges; the theme toggle
          cycles Dark → Light → OLED. Both are persistent affordances
          that live across screens. */}
      <div className="flex items-center justify-between border-t border-[var(--color-border)] px-3 py-2">
        <span className="text-xs text-[var(--color-muted)]">
          {themeLabel(theme, tr)}
        </span>
        <div className="flex items-center gap-1">
          <NotificationInbox />
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={tr(
              "switch_theme",
              { current: theme },
              `Switch theme (current: ${theme})`,
            )}
            className="rounded-md p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)]"
          >
            {themeIcon(theme)}
          </button>
        </div>
      </div>
    </aside>
  );
}
