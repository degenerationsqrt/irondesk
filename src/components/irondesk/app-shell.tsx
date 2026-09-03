import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Apple,
  BarChart3,
  Bot,
  ClipboardList,
  Dumbbell,
  HeartPulse,
  History,
  House,
  LayoutDashboard,
  Library,
  LogOut,
  PlugZap,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { PwaInstallButton } from "@/components/irondesk/pwa-manager";
import { WorkoutSyncRecovery } from "@/components/irondesk/workout-sync-recovery";
import { useAuth } from "@/lib/auth/auth-provider";
import { accountQuery } from "@/lib/irondesk/queries";

import { cn } from "@/lib/utils";

export interface NavItem {
  to: string;
  label: string;
  short: string;
  icon: LucideIcon;
}

export const navItems: NavItem[] = [
  { to: "/", label: "Today", short: "Today", icon: LayoutDashboard },
  { to: "/workout", label: "Workout", short: "Train", icon: Dumbbell },
  { to: "/program", label: "My Program", short: "Program", icon: ClipboardList },
  { to: "/home-workouts", label: "Home Workouts", short: "Home", icon: House },
  { to: "/history", label: "History", short: "Log", icon: History },
  { to: "/exercises", label: "Exercises", short: "Library", icon: Library },
  { to: "/progress", label: "Progress", short: "Trends", icon: BarChart3 },
  { to: "/nutrition", label: "Nutrition", short: "Fuel", icon: Apple },
  { to: "/recovery", label: "Recovery", short: "Recover", icon: HeartPulse },
  { to: "/coach", label: "AI Coach", short: "Coach", icon: Bot },
  { to: "/connections", label: "Connections", short: "Import", icon: PlugZap },
  { to: "/settings", label: "Settings", short: "Setup", icon: Settings },
];

/** Keep the no-gym library one tap away, including while another workout is active. */
const mobilePrimary = ["/", "/workout", "/program", "/home-workouts", "/history", "/progress"];

export function IronDeskLogo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="group flex items-center gap-2.5">
      <span className="relative flex size-8 items-center justify-center rounded-lg border border-primary/40 bg-primary/12">
        <Activity className="size-4 text-primary" strokeWidth={2.6} />
      </span>
      {!compact && (
        <span className="text-display text-xl leading-none font-bold tracking-tight">
          IRON<span className="text-primary">DESK</span>
          <span className="ml-1 align-super text-[0.5rem] font-semibold tracking-[0.2em] text-muted-foreground">
            2.0
          </span>
        </span>
      )}
    </Link>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary/12 text-primary"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "absolute top-1.5 bottom-1.5 -left-3 w-0.5 rounded-full transition-opacity",
          active ? "bg-primary opacity-100" : "opacity-0",
        )}
      />
      <Icon className="size-4 shrink-0" strokeWidth={2.2} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function useActivePath() {
  return useRouterState({ select: (s) => s.location.pathname });
}

function isActive(pathname: string, to: string) {
  return to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
}

/** Current viewer identity for the sidebar / user menu. */
function useViewer() {
  const { user, demo, mode } = useAuth();
  const { data: account } = useQuery({ ...accountQuery, enabled: mode === "live" });
  const name = demo
    ? "Demo Athlete"
    : (account?.profile?.display_name ?? user?.email?.split("@")[0] ?? "Athlete");
  const initials = name
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  const goal =
    account?.preferences?.primary_goal?.replace("_", " ") ?? (demo ? "Sample data" : "Training");
  return { name, initials: initials || "IA", goal, demo, email: user?.email ?? null };
}

function UserMenu({ variant }: { variant: "sidebar" | "top" }) {
  const { name, initials, goal, demo, email } = useViewer();
  const { signOut, exitDemo } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const leave = async () => {
    setOpen(false);
    if (demo) exitDemo();
    else await signOut();
    void navigate({ to: "/auth", search: {} });
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-3 rounded-lg text-left transition-colors hover:bg-sidebar-accent",
          variant === "sidebar" ? "w-full p-1" : "p-1",
        )}
      >
        <span className="numeric flex size-9 items-center justify-center rounded-lg border border-border-strong bg-surface-2 text-sm font-bold">
          {initials}
        </span>
        {variant === "sidebar" && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{name}</span>
            <span className="block truncate text-xs capitalize text-muted-foreground">{goal}</span>
          </span>
        )}
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-50 w-56 rounded-lg border border-border-strong bg-surface p-1.5 shadow-lg",
            variant === "sidebar" ? "bottom-12 left-0" : "top-11 right-0",
          )}
        >
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {demo ? "Demo mode · nothing is saved" : (email ?? "Signed in")}
            </p>
          </div>
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-sidebar-accent"
          >
            <Settings className="size-4" /> Profile & settings
          </Link>
          <button
            onClick={() => void leave()}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-danger transition-colors hover:bg-danger/10"
          >
            <LogOut className="size-4" /> {demo ? "Exit demo" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}

function Sidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
      <div className="flex h-14 items-center border-b border-sidebar-border px-5">
        <IronDeskLogo />
      </div>
      <nav className="flex-1 overflow-y-auto px-6 py-4">
        <p className="label-eyebrow mb-2">Training</p>
        <div className="flex flex-col gap-0.5">
          {navItems.slice(0, 6).map((item) => (
            <NavLink key={item.to} item={item} active={isActive(pathname, item.to)} />
          ))}
        </div>
        <p className="label-eyebrow mt-5 mb-2">Intelligence</p>
        <div className="flex flex-col gap-0.5">
          {navItems.slice(6).map((item) => (
            <NavLink key={item.to} item={item} active={isActive(pathname, item.to)} />
          ))}
        </div>
      </nav>
      <div className="border-t border-sidebar-border px-4 py-3">
        <UserMenu variant="sidebar" />
      </div>
    </aside>
  );
}

function MobileNav({ pathname }: { pathname: string }) {
  const items = navItems.filter((i) => mobilePrimary.includes(i.to));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="grid grid-cols-6">
        {items.map((item) => {
          const active = isActive(pathname, item.to);
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[0.625rem] font-semibold tracking-wide uppercase transition-colors",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="size-5" strokeWidth={2.2} />
                {item.short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function TopBar({ pathname }: { pathname: string }) {
  const current = navItems.find((i) => isActive(pathname, i.to));
  const { demo } = useAuth();
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
        <div className="lg:hidden">
          <IronDeskLogo />
        </div>
        <div className="hidden min-w-0 lg:block">
          <p className="label-eyebrow">IronDesk</p>
          <h1 className="truncate text-lg leading-none font-semibold tracking-tight">
            {current?.label ?? "Dashboard"}
          </h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <PwaInstallButton />
          {demo && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/12 px-2 py-1 text-[0.6875rem] font-bold tracking-widest text-warning max-[430px]:hidden">
              <span className="size-1.5 rounded-full bg-warning" />
              DEMO
            </span>
          )}
          <Link
            to="/workout"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Dumbbell className="size-3.5" strokeWidth={2.6} />
            Start
          </Link>
          <div className="lg:hidden">
            <UserMenu variant="top" />
          </div>
        </div>
      </div>
    </header>
  );
}

/** Route-aware app shell: desktop sidebar, compact top bar, mobile bottom nav. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useActivePath();
  return (
    <div className="min-h-screen bg-background">
      <Sidebar pathname={pathname} />
      <div className="lg:pl-60">
        <TopBar pathname={pathname} />
        <main className="grid-fade mx-auto w-full max-w-[1500px] px-4 pt-4 pb-24 sm:px-6 lg:pb-10">
          {children}
        </main>
      </div>
      <MobileNav pathname={pathname} />
      <WorkoutSyncRecovery />
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
