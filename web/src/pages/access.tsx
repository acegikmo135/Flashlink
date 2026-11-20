import { KeyRound, Loader2, Plug, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { CodeBlock, CopyButton } from "@/components/copy-button"
import { PageHeader } from "@/components/shell"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/lib/api"
import { ago } from "@/lib/format"
import { useOverview, useSession } from "@/lib/session"

function Revoke({ title, description, onConfirm, label }: { title: string; description: string; onConfirm: () => Promise<void>; label: string }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="ghost" size="icon" aria-label={label} />}><Trash2 /></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>Revoke</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function CreateToken({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("Claude Code")
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const { session } = useSession()
  const origin = session?.config.origin ?? window.location.origin

  async function create() {
    setBusy(true)
    try {
      const r = await api<{ token: string }>("/api/web/tokens", { body: { name } })
      setToken(r.token)
      onCreated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create token")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setToken(null); setName("Claude Code") } }}>
      <DialogTrigger render={<Button size="sm" />}><Plus /> New token</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{token ? "Copy your token now" : "Create access token"}</DialogTitle>
          <DialogDescription>{token ? "It is shown only once. Anyone holding it can flash your allowed boards — treat it like an SSH key." : "For clients that cannot use the OAuth connector, e.g. `claude mcp add`."}</DialogDescription>
        </DialogHeader>
        {token ? (
          <div className="space-y-4">
            <CodeBlock>{token}</CodeBlock>
            <div>
              <Label className="mb-2 block">Add it to Claude Code</Label>
              <CodeBlock>{`claude mcp add --transport http mcu-bridge ${origin}/mcp --header "Authorization: Bearer ${token}"`}</CodeBlock>
            </div>
            <DialogFooter><Button onClick={() => setOpen(false)}>Done</Button></DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tname">Name</Label>
              <Input id="tname" value={name} maxLength={48} onChange={(e) => setName(e.target.value)} />
            </div>
            <DialogFooter>
              <Button onClick={create} disabled={busy || !name.trim()}>{busy && <Loader2 className="animate-spin" />} Create token</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function AccessPage() {
  const { data, refresh } = useOverview()
  const { session } = useSession()
  const origin = session?.config.origin ?? window.location.origin
  if (!data) return <Skeleton className="h-96" />
  return (
    <>
      <PageHeader title="Access" description="Connect Claude (or any MCP client) to your boards." />

      <Card className="ios-rise" style={{ "--i": 0 } as React.CSSProperties}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plug className="size-4" /> Connector (recommended)</CardTitle>
          <CardDescription>Add MCU Bridge in claude.ai → Settings → Connectors → Add custom connector, then sign in here when prompted. No token to copy.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
            <code className="min-w-0 flex-1 truncate font-mono text-sm">{origin}/mcp</code>
            <CopyButton value={`${origin}/mcp`} label="Copy URL" />
          </div>
          <p className="text-xs text-muted-foreground">Leave the OAuth client fields empty — clients register themselves. Access tokens last one hour and refresh automatically.</p>
        </CardContent>
      </Card>

      <Card className="mt-6 ios-rise" style={{ "--i": 1 } as React.CSSProperties}>
        <CardHeader>
          <CardTitle>Connected apps</CardTitle>
          <CardDescription>Applications you authorised through the sign-in flow.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.apps.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No connected apps yet.</p>
          ) : (
            <Table>
              <TableBody>
                {data.apps.map((a) => (
                  <TableRow key={a.client_id}>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell className="text-muted-foreground">connected {ago(a.since)}</TableCell>
                    <TableCell className="text-right">
                      <Revoke label={`Disconnect ${a.name}`} title={`Disconnect “${a.name}”?`} description="It loses access immediately and must be authorised again." onConfirm={async () => { await api("/api/web/apps/revoke", { body: { client_id: a.client_id } }); toast.success("App disconnected"); void refresh() }} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6 ios-rise" style={{ "--i": 2 } as React.CSSProperties}>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><KeyRound className="size-4" /> Access tokens</CardTitle>
              <CardDescription className="mt-1">Long-lived Bearer tokens, up to 10. Revoke any time.</CardDescription>
            </div>
            <CreateToken onCreated={() => void refresh()} />
          </div>
        </CardHeader>
        <CardContent>
          {data.tokens.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No tokens.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.tokens.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-muted-foreground">{ago(t.created_at)}</TableCell>
                    <TableCell className="text-muted-foreground">{ago(t.last_used_at)}</TableCell>
                    <TableCell className="text-right">
                      <Revoke label={`Revoke ${t.name}`} title={`Revoke “${t.name}”?`} description="Clients using this token stop working immediately." onConfirm={async () => { await api("/api/web/tokens/revoke", { body: { id: t.id } }); toast.success("Token revoked"); void refresh() }} />
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
