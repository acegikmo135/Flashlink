import { Activity, KeyRound, LayoutDashboard, LogOut, Settings, Usb } from "lucide-react"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Brand } from "@/components/logo"
import { ThemeSwitch } from "@/components/theme-switch"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { OverviewProvider, useSession } from "@/lib/session"
import { cn } from "@/lib/utils"

const NAV = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard, tint: "bg-ios-blue", end: true },
  { to: "/dashboard/devices", label: "Devices", icon: Usb, tint: "bg-ios-green" },
  { to: "/dashboard/activity", label: "Activity", icon: Activity, tint: "bg-ios-orange" },
  { to: "/dashboard/access", label: "Access", icon: KeyRound, tint: "bg-ios-purple" },
  { to: "/dashboard/account", label: "Account", icon: Settings, tint: "bg-ios-gray" },
]

function Tile({ tint, children }: { tint: string; children: React.ReactNode }) {
  return <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-[8px] text-white shadow-sm", tint)}>{children}</span>
}

export function Shell() {
  const { session, reload } = useSession()
  const nav = useNavigate()
  const loc = useLocation()
  const email = session?.user?.email ?? ""

  async function signOut() {
    await api("/api/web/logout", { method: "POST", body: {} })
    await reload()
    toast.success("Signed out")
    nav("/login")
  }

  return (
    <OverviewProvider>
      <div className="min-h-screen bg-background md:pl-72">
        {/* Sidebar (iPadOS / macOS style) */}
        <aside className="ios-glass fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-sidebar-border p-4 md:flex">
          <div className="px-2 pb-5 pt-2 text-[17px]">
            <Brand />
          </div>
          <nav className="flex flex-1 flex-col gap-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn(
                    "group flex items-center gap-3 rounded-[14px] px-2.5 py-2 text-[15px] font-medium transition-all duration-300 [transition-timing-function:var(--ease-ios)]",
                    isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-foreground/80 hover:bg-secondary active:scale-[0.98]",
                  )
                }
              >
                <Tile tint={n.tint}>
                  <n.icon className="size-4" strokeWidth={2.2} />
                </Tile>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="space-y-3">
            <ThemeSwitch className="w-full" />
            <div className="flex items-center gap-2.5 rounded-[14px] bg-secondary p-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ios-blue text-sm font-semibold uppercase text-white">{email.slice(0, 1)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{email}</div>
                <div className="text-[11px] text-muted-foreground">Signed in</div>
              </div>
              <Button variant="ghost" size="icon" aria-label="Sign out" onClick={signOut}>
                <LogOut />
              </Button>
            </div>
          </div>
        </aside>

        {/* Mobile top bar */}
        <header className="ios-glass sticky top-0 z-30 flex items-center justify-between border-b border-sidebar-border px-4 py-2.5 md:hidden">
          <Brand />
          <ThemeSwitch compact />
        </header>

        <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 sm:px-8 md:pb-12 md:pt-12">
          <div key={loc.pathname} className="ios-page">
            <Outlet />
          </div>
        </main>

        {/* Mobile tab bar (iOS style) */}
        <nav className="ios-glass fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-sidebar-border px-1 pb-[max(env(safe-area-inset-bottom),0.25rem)] pt-1.5 md:hidden">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn("flex flex-col items-center gap-0.5 rounded-xl py-1 text-[10px] font-medium transition-all duration-300 active:scale-90", isActive ? "text-ios-blue" : "text-muted-foreground")}>
              <n.icon className="size-[22px]" strokeWidth={2} />
              {n.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </OverviewProvider>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[34px] font-bold leading-[1.1] tracking-[-0.03em]">{title}</h1>
        {description && <p className="mt-1.5 text-[15px] text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  )
}

export { ThemeSwitch as ThemeToggle }
