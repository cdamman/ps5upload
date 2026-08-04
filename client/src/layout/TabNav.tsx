import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router";
import {
  LayoutDashboard,
  Gamepad2,
  FolderTree,
  Cpu,
  Activity,
  MoreHorizontal,
  X,
} from "lucide-react";
import { useTr } from "../state/lang";
import Sidebar from "./Sidebar";
import type { LucideIcon } from "lucide-react";

/**
 * v5 primary navigation.
 *
 * Desktop (md+): a 56px icon rail on the far left with 5 primary tabs.
 *   Each tab deep-links into a v4 screen that belongs to that v5 tab's
 *   domain. A "More" button at the bottom opens the full v4 sidebar as
 *   a drawer so every legacy route is still reachable during the
 *   Phase 5.1 migration.
 *
 * Mobile (<md): a 56px bottom nav with the same 5 tabs. The mobile
 *   top-bar hamburger is replaced by this nav; the "More" tab navigates
 *   to the /more screen. It used to open the desktop Sidebar in a bottom
 *   sheet — a 270px-wide column in a 448px sheet, 36px rows, and two
 *   nested scrollers. A real route fixes all three and makes the Android
 *   back button work without special-casing.
 *
 * Routing note: each tab links to the *current* v4 route that best
 *   represents that v5 tab. As Phase 5.1 builds each new tab shell,
 *   these targets will switch to the new `/home`, `/games`, `/files`,
 *   `/console`, `/tasks` routes.
 */

interface TabDef {
  /** v5 tab id (also used as the i18n key suffix). */
  id: "home" | "games" | "files" | "console" | "tasks";
  /** lucide icon component. */
  icon: LucideIcon;
  /** Current v4 route to link to (will become /<id> as tabs are built). */
  to: string;
  /** Additional v4 prefixes that count as "active" for this tab. */
  matches: string[];
}

const TABS: TabDef[] = [
  {
    id: "home",
    icon: LayoutDashboard,
    to: "/home",
    matches: [
      "/home",
      "/dashboard",
      "/whats-new",
      "/connection",
      "/about",
      "/faq",
      "/settings",
      "/first-run",
    ],
  },
  {
    id: "games",
    icon: Gamepad2,
    to: "/games",
    matches: [
      "/games",
      "/library",
      "/installed",
      "/cheats",
      "/saves",
      "/screenshots",
      "/videos",
      "/game-activity",
      "/sdk-changer",
      "/tmdb",
      "/search",
    ],
  },
  {
    id: "files",
    icon: FolderTree,
    to: "/files",
    matches: [
      "/files",
      "/upload",
      "/install-package",
      "/file-system",
      "/volumes",
      "/smb",
      "/smb-browser",
      "/disk-usage",
    ],
  },
  {
    id: "console",
    icon: Cpu,
    to: "/console",
    matches: [
      "/console",
      "/hardware",
      "/fan-curve",
      "/profile",
      "/backup",
      "/remote-play",
      "/notifications",
      "/fw-spoof",
      "/ftp-server",
      "/nanodns",
      "/nano-dns",
      "/payloads",
      "/send-payload",
      "/processes",
      "/shell",
      "/stats",
    ],
  },
  {
    id: "tasks",
    icon: Activity,
    to: "/tasks",
    matches: [
      "/tasks",
      "/activity",
      "/logs",
      "/kernel-log",
      "/audit-log",
      "/bug-report",
    ],
  },
];

function useActiveTab(): string | null {
  const { pathname } = useLocation();
  for (const tab of TABS) {
    if (
      tab.matches.some(
        (p) => pathname === p || pathname.startsWith(p + "/"),
      )
    ) {
      return tab.id;
    }
  }
  return null;
}

/**
 * Desktop rail. 56px wide, icon + tooltip, vertically centered. Renders
 * only at md+ (the bottom nav takes over below md). The "More" button
 * at the bottom opens the full v4 Sidebar as a drawer so every legacy
 * route stays reachable during the Phase 5.1 migration.
 */
export function TabRail() {
  const tr = useTr();
  const activeTab = useActiveTab();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);

  // Close on Escape; restore focus to the More button. Lock body scroll
  // while the drawer is open so the background doesn't move.
  useEffect(() => {
    if (!moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMoreOpen(false);
        moreBtnRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    moreRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  return (
    <>
      <nav
        aria-label={tr("v5_tab_primary_nav", undefined, "Primary")}
        className="hidden md:flex md:h-full md:w-14 flex-col items-center justify-center gap-1 border-r border-[var(--color-border)] bg-[var(--color-surface-2)] pt-[env(safe-area-inset-top)]"
      >
        {TABS.map((tab, i) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          const label = tr(`v5_tab_${tab.id}`, undefined, tab.id);
          const desc = tr(`v5_tab_${tab.id}_desc`, undefined, "");
          return (
            <NavLink
              key={tab.id}
              to={tab.to}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              title={`${label}${desc ? " — " + desc : ""}`}
              accessKey={String(i + 1)}
              className={[
                "group relative flex h-11 w-11 items-center justify-center rounded-lg transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]",
                active
                  ? "bg-[var(--color-surface-3)] text-[var(--color-text)]"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)]",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <Icon size={22} aria-hidden />
              {active && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-full bg-[var(--color-accent)]"
                />
              )}
              {/* Tooltip (CSS hover, title attr is the fallback) */}
              <span
                role="tooltip"
                className="pointer-events-none absolute left-full ml-3 z-50 hidden whitespace-nowrap rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)] elev-3 group-hover:block group-focus-visible:block"
              >
                {label}
                <span
                  aria-hidden
                  className="ml-1 text-[var(--color-muted)]"
                >
                  {`Alt+${i + 1}`}
                </span>
              </span>
            </NavLink>
          );
        })}

        {/* Spacer pushes More to the bottom. */}
        <div className="flex-1" />

        <button
          ref={moreBtnRef}
          type="button"
          aria-label={tr("v5_tab_more", undefined, "More")}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          title={tr("v5_tab_more_desc", undefined, "All screens")}
          onClick={() => setMoreOpen(true)}
          className={[
            "mb-2 flex h-11 w-11 items-center justify-center rounded-lg transition-colors",
            "text-[var(--color-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)]",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <MoreHorizontal size={22} aria-hidden />
        </button>
      </nav>

      {/* "More" drawer — full v4 Sidebar in a side dialog. */}
      {moreOpen && (
        <div
          ref={moreRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="false"
          aria-label={tr("v5_tab_more", undefined, "More")}
          className="fixed inset-0 z-50 hidden md:block outline-none"
        >
          <button
            type="button"
            aria-label={tr("nav_close_aria", undefined, "Close")}
            onClick={() => setMoreOpen(false)}
            className="anim-scrim absolute inset-0 bg-[var(--overlay-scrim)]"
          />
          <div className="anim-drawer elev-3 absolute inset-y-0 left-14 flex max-w-[85%]">
            <div className="relative flex flex-col bg-[var(--color-surface-2)]">
              <button
                type="button"
                aria-label={tr("nav_close_aria", undefined, "Close")}
                onClick={() => setMoreOpen(false)}
                className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              >
                <X size={18} />
              </button>
              <Sidebar onNavigate={() => setMoreOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Mobile bottom nav. Renders only below md. 5 icon tabs, hardware
 * back-button aware via the backStack store. The "More" tab opens the
 * full v4 Sidebar as a bottom sheet so every legacy route is still
 * reachable.
 */
export function TabBottomNav() {
  const tr = useTr();
  const activeTab = useActiveTab();

  return (
    <>
      <nav
        aria-label={tr("v5_tab_primary_nav", undefined, "Primary")}
        className="h-bottom-nav md:hidden fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-[var(--color-border)] bg-[var(--color-surface-2)] pb-[env(safe-area-inset-bottom)]"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          const label = tr(`v5_tab_${tab.id}`, undefined, tab.id);
          return (
            <NavLink
              key={tab.id}
              to={tab.to}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className={[
                "flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]",
                active
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--color-muted)]",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <Icon size={22} aria-hidden />
              <span>{label}</span>
            </NavLink>
          );
        })}
        {/* More — a real route, not a sheet. That makes the Android
            hardware back button and the backStack treat it like any
            other screen (mobile-design §3.4), and it lets the screen
            use <main>'s scroller instead of nesting its own. */}
        <NavLink
          to="/more"
          aria-label={tr("v5_tab_more", undefined, "More")}
          className={({ isActive }) =>
            [
              "flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]",
              isActive
                ? "text-[var(--color-accent)]"
                : "text-[var(--color-muted)]",
            ].join(" ")
          }
        >
          <MoreHorizontal size={22} aria-hidden />
          <span>{tr("v5_tab_more", undefined, "More")}</span>
        </NavLink>
      </nav>
    </>
  );
}
