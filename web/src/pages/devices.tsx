import { Pencil, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { PageHeader } from "@/components/shell"
import { Dot, DeviceStateBadge } from "@/components/status"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/lib/api"
import { ago } from "@/lib/format"
import { useOverview } from "@/lib/session"

function DeviceName({ id, name, fallback, onSaved }: { id: string; name: string | null; fallback: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(name ?? "")
  const save = async () => {
    try {
      await api(`/api/web/devices/${id}/name`, { method: "PUT", body: { name: val.trim() === "" ? null : val.trim() } })
      toast.success(val.trim() ? `Named “${val.trim()}”` : "Name removed")
      setEditing(false)
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the name")
    }
  }
  if (editing)
    return (
      <form onSubmit={(e) => { e.preventDefault(); void save() }} className="flex items-center gap-2">
        <Input autoFocus value={val} maxLength={32} placeholder="e.g. Kitchen ESP32" onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(false)} className="h-8 w-48" />
        <Button type="submit" size="sm">Save</Button>
      </form>
    )
  return (
    <button type="button" onClick={() => { setVal(name ?? ""); setEditing(true) }} className="group flex items-center gap-2 text-left" title="Rename — AIs will use this name">
      <span className="flex flex-col">
        <span className="font-medium">{name ?? fallback}</span>
        {name && <span className="text-xs font-normal text-muted-foreground">{fallback}</span>}
      </span>
      <Pencil className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  )
}

export function DevicesPage() {
  const { data, refresh } = useOverview()
  if (!data) return <Skeleton className="h-96" />
  return (
    <>
      <PageHeader title="Devices" description="Boards detected by your desktop apps, live." />
      <Card className="ios-rise" style={{ "--i": 0 } as React.CSSProperties}>
        <CardHeader>
          <CardTitle>Connected boards</CardTitle>
          <CardDescription>Click a board’s name to give it your own (e.g. “Kitchen ESP32”) — the AI uses it so boards never get mixed up. Only supported microcontrollers are listed. Remote flashing is controlled per device in the desktop app.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.devices.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No board detected. Plug one in over USB with MCU Bridge running.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Board</TableHead>
                  <TableHead>Port</TableHead>
                  <TableHead>Family</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Remote flashing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.devices.map((d) => (
                  <TableRow key={d.device_id}>
                    <TableCell><DeviceName id={d.device_id} name={d.name} fallback={d.chip ?? d.board ?? "Unidentified board"} onSaved={refresh} /></TableCell>
                    <TableCell className="font-mono text-xs">{d.port ?? "—"}</TableCell>
                    <TableCell>{d.family ?? "—"}</TableCell>
                    <TableCell><DeviceStateBadge state={d.state} /></TableCell>
                    <TableCell>{d.remote_flashing_allowed ? <Badge variant="secondary">Allowed</Badge> : <Badge variant="outline">Off</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6 ios-rise" style={{ "--i": 1 } as React.CSSProperties}>
        <CardHeader>
          <CardTitle>Desktop apps</CardTitle>
          <CardDescription>Each installation has its own revocable credential.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.agents.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No desktop app paired yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Computer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Tools</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.agents.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="font-medium">{a.name}</div>
                      <div className="text-xs text-muted-foreground">{a.os ?? a.platform}{a.version ? ` · v${a.version}` : ""}</div>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2 text-sm"><Dot on={a.online} />{a.online ? `Online · ${a.devices} board${a.devices === 1 ? "" : "s"}` : `Offline · ${ago(a.last_seen_at)}`}</span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(a.toolchains).map(([n, t]) => (
                          <Badge key={n} variant={t.available ? "secondary" : "outline"} className={t.available ? "" : "text-muted-foreground"}>{n}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger render={<Button variant="ghost" size="icon" aria-label={`Revoke ${a.name}`} />}><Trash2 /></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Revoke “{a.name}”?</AlertDialogTitle>
                            <AlertDialogDescription>It is disconnected immediately and must be paired again to flash.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={async () => { await api("/api/web/agents/revoke", { body: { id: a.id } }); toast.success("Desktop app revoked"); void refresh() }}>Revoke</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
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
