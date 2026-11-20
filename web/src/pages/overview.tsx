import { Check, Download, ExternalLink } from "lucide-react"
import { Link } from "react-router-dom"
import { CopyButton } from "@/components/copy-button"
import { PageHeader } from "@/components/shell"
import { JobBadge } from "@/components/status"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ago } from "@/lib/format"
import { useOverview, useSession } from "@/lib/session"
import { cn } from "@/lib/utils"

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <div className="text-3xl font-semibold tabular-nums leading-none tracking-tight">{value}</div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>
    </Card>
  )
}

function Step({ n, done, title, body, action }: { n: number; done: boolean; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-3">
      <div className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium", done ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500" : "text-muted-foreground")}>
        {done ? <Check className="size-3.5" /> : n}
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm font-medium", done && "text-muted-foreground line-through decoration-muted-foreground/40")}>{title}</div>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      {!done && action}
    </div>
  )
}

export function OverviewPage() {
  const { data } = useOverview()
  const { session } = useSession()
  const origin = session?.config.origin ?? window.location.origin
  const installer = session?.config.installer_url
  if (!data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        <Skeleton className="h-64" />
      </div>
    )
  }
  const s = data.stats
  const rate = s.jobs_total ? Math.round((100 * s.jobs_ok) / s.jobs_total) : null
  const connected = data.apps.length > 0 || data.tokens.length > 0
  const allDone = data.agents.length > 0 && s.devices_ready > 0 && connected && s.jobs_ok > 0
  return (
    <>
      <PageHeader title="Overview" description="Your desktop apps, boards and recent flashing activity." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Desktop apps online" value={`${s.agents_online}/${data.agents.length}`} hint={data.agents.length ? "paired with your account" : "none paired yet"} />
        <Stat label="Boards ready" value={s.devices_ready} hint="supported MCUs detected now" />
        <Stat label="Flashes" value={s.jobs_total} hint={`${s.jobs_ok} completed`} />
        <Stat label="Success rate" value={rate === null ? "—" : `${rate}%`} hint="confirmed by the desktop app" />
      </div>

      {!allDone && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Get started</CardTitle>
            <CardDescription>Four steps from install to your first flash.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            <Step
              n={1}
              done={data.agents.length > 0}
              title="Install the Windows app and sign in"
              body="Run the installer, then open the pairing link or scan the QR code shown on first launch."
              action={
                installer && (
                  <Button size="sm" render={<a href={installer} />}>
                    <Download /> Download
                  </Button>
                )
              }
            />
            <Step n={2} done={s.agents_online > 0} title="Keep MCU Bridge running" body="It sits in the system tray and reconnects automatically." />
            <Step n={3} done={s.devices_ready > 0} title="Plug in a board" body="ESP32, ESP8266, Arduino, STM32 (ST-Link) or CH32V003 (WCH-LinkE)." />
            <Step
              n={4}
              done={connected}
              title="Connect Claude"
              body="Add this server as a custom connector in claude.ai (sign in when prompted), or create a token."
              action={
                <div className="flex gap-2">
                  <CopyButton value={`${origin}/mcp`} label="Copy URL" />
                  <Button size="sm" variant="outline" render={<Link to="/dashboard/access" />}>
                    Access <ExternalLink />
                  </Button>
                </div>
              }
            />
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>The last flashes and verifications across all your boards.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.jobs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing flashed yet. Ask Claude to flash your board.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Board</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="hidden sm:table-cell">Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.jobs.slice(0, 6).map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="text-muted-foreground">{ago(j.finished_at ?? j.created_at)}</TableCell>
                    <TableCell className="font-medium">{j.board}</TableCell>
                    <TableCell className="capitalize">{j.kind}</TableCell>
                    <TableCell><JobBadge status={j.status} /></TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">{j.error_code ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  )
}
