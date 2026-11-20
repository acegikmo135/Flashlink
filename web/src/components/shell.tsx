import { Activity, KeyRound, LayoutDashboard, LogOut, Moon, Settings, Sun, Usb } from "lucide-react"
import { useTheme } from "next-themes"
import { NavLink, Outlet, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Brand } from "@/components/logo"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { api } from "@/lib/api"
import { OverviewProvider, useSession } from "@/lib/session"
import { cn } from "@/lib/utils"

const NAV = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/dashboard/devices", label: "Devices", icon: Usb },
  { to: "/dashboard/activity", label: "Activity", icon: Activity },
  { to: "/dashboard/access", label: "Access", icon: KeyRound },
  { to: "/dashboard/account", label: "Account", icon: Settings },
]

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      <Sun className="hidden dark:block" />
      <Moon className="dark:hidden" />
    </Button>
  )
}

export function Shell() {
  const { session, reload } = useSession()
  const nav = useNavigate()
  const email = session?.user?.email ?? ""
  return (
    <OverviewProvider>
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
            <NavLink to="/dashboard">
              <Brand />
            </NavLink>
            <nav className="hidden flex-1 items-center gap-1 md:flex">
              {NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) => cn("flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors", isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  <n.icon className="size-4" />
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-1 md:ml-0">
              <ThemeToggle />
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="max-w-48" />}>
                  <span className="truncate">{email}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => nav("/dashboard/account")}>
                    <Settings /> Account settings
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={async () => {
                      await api("/api/web/logout", { method: "POST", body: {} })
                      await reload()
                      toast.success("Signed out")
                      nav("/login")
                    }}
                  >
                    <LogOut /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t px-3 py-1.5 md:hidden">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn("flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium", isActive ? "bg-muted" : "text-muted-foreground")}>
                <n.icon className="size-3.5" />
                {n.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <Outlet />
        </main>
      </div>
    </OverviewProvider>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  )
}
