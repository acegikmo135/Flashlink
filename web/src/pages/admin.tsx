import { Check, Loader2, Mail, MailWarning, Plus, ShieldAlert, Trash2, X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { CodeBlock } from "@/components/copy-button"
import { PageHeader } from "@/components/shell"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api, type AdminOverview, type InviteRequestRow, type InviteRow } from "@/lib/api"
import { ago } from "@/lib/format"
import { useSession } from "@/lib/session"

type Issued = { code: string; email: string | null; expires_at: number | null; mail: string }

const mailText = (m: string) => (m.startsWith("sent") ? "Emailed to the requester" : m === "skipped" ? "Not emailed" : m === "not_configured" ? "Mail is not configured: send the code yourself" : "Email failed: send the code yourself")

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card size="sm">
      <CardContent className="py-1">
        <div className="text-[13px] text-muted-foreground">{label}</div>
        <div className="mt-1 text-3xl font-semibold tracking-tight">{value}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  )
}

function IssueDialog({ open, onClose, preset, onDone }: { open: boolean; onClose: () => void; preset: { request?: InviteRequestRow } | null; onDone: (i: Issued) => void }) {
  const req = preset?.request
  const [label, setLabel] = useState("")
  const [email, setEmail] = useState("")
  const [uses, setUses] = useState("1")
  const [days, setDays] = useState("7")
  const [sendMail, setSendMail] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) { setLabel(req?.name ?? ""); setEmail(req?.email ?? ""); setUses("1"); setDays("7"); setSendMail(true) }
  }, [open, req])

  async function go() {
    setBusy(true)
    try {
      const body = { max_uses: Number(uses) || 1, expires_days: Number(days) || 0, send_mail: sendMail }
      const r = req
        ? await api<{ code: string; expires_at: number | null; mail: string }>("/api/web/admin/requests/decision", { body: { id: req.id, decision: "approve", ...body } })
        : await api<{ code: string; expires_at: number | null; mail: string }>("/api/web/admin/invites", { body: { ...body, label, email } })
      onDone({ code: r.code, email: req?.email ?? (email || null), expires_at: r.expires_at, mail: r.mail })
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the invite")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{req ? "Approve request" : "New invite code"}</DialogTitle>
          <DialogDescription>{req ? `Creates a code for ${req.email}.` : "Create a code to hand out yourself, or email it directly."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!req && (
            <>
              <div className="space-y-2"><Label htmlFor="i-label">Label</Label><Input id="i-label" placeholder="e.g. Maker meetup" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="i-email">Send to <span className="font-normal text-muted-foreground">· optional</span></Label><Input id="i-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="i-uses">Uses</Label><Input id="i-uses" type="number" min={1} max={100} value={uses} onChange={(e) => setUses(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="i-days">Expires in (days)</Label><Input id="i-days" type="number" min={0} max={365} value={days} onChange={(e) => setDays(e.target.value)} /></div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">Set days to 0 for a code that never expires.</p>
          {(req || email) && (
            <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
              <span className="flex items-center gap-2"><Mail className="size-4" /> Email the code to {req?.email ?? (email || "them")}</span>
              <Switch checked={sendMail} onCheckedChange={setSendMail} />
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={go} disabled={busy}>{busy && <Loader2 className="animate-spin" />} {req ? "Approve & create code" : "Create code"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Confirm({ title, description, action, onConfirm, children }: { title: string; description: string; action: string; onConfirm: () => Promise<void>; children: React.ReactNode }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={onConfirm}>{action}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const inviteState = (i: InviteRow) =>
  i.revoked_at ? { t: "Revoked", v: "destructive" as const } : i.expires_at && i.expires_at < Date.now() ? { t: "Expired", v: "secondary" as const } : i.uses >= i.max_uses ? { t: "Used up", v: "secondary" as const } : { t: "Active", v: "default" as const }

export function AdminPage() {
  const { session } = useSession()
  const [data, setData] = useState<AdminOverview | null>(null)
  const [issue, setIssue] = useState<{ request?: InviteRequestRow } | null>(null)
  const [issued, setIssued] = useState<Issued | null>(null)

  const load = useCallback(async () => {
    try { setData(await api<AdminOverview>("/api/web/admin/overview")) } catch (e) { toast.error(e instanceof Error ? e.message : "Could not load") }
  }, [])
  useEffect(() => { if (session?.admin) void load() }, [session?.admin, load])

  if (!session?.admin) {
    return (
      <>
        <PageHeader title="Admin" />
        <Card><CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground"><ShieldAlert className="size-5" /> This area is only available to the owner account. Set <code className="font-mono">ADMIN_EMAIL</code> on the Worker to your account's email.</CardContent></Card>
      </>
    )
  }
  if (!data) return <Skeleton className="h-96" />

  const pending = data.requests.filter((r) => r.status === "pending")
  const act = async (path: string, body: object, ok: string) => {
    try { await api(path, { body }); toast.success(ok); await load() } catch (e) { toast.error(e instanceof Error ? e.message : "Failed") }
  }

  return (
    <>
      <PageHeader title="Admin" description="Invite requests, invite codes and accounts." actions={<Button size="sm" onClick={() => setIssue({})}><Plus /> New invite code</Button>} />

      {!data.mail.transport || !data.mail.admin_email_set ? (
        <Card className="mb-5 border-ios-orange/40">
          <CardContent className="flex items-start gap-3 py-1 text-sm">
            <MailWarning className="mt-0.5 size-4 shrink-0 text-ios-orange" />
            <div>
              <b>Email is not set up.</b> Requests are still saved here, but you will not get a message when one arrives. Set <code className="font-mono">ADMIN_EMAIL</code>, <code className="font-mono">MAIL_FROM</code> and either <code className="font-mono">RESEND_API_KEY</code> or a <code className="font-mono">send_email</code> binding (see docs/setup.md).
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Pending requests" value={data.stats.pending} />
        <Stat label="Active invite codes" value={data.stats.active_invites} />
        <Stat label="Accounts" value={data.stats.users} />
        <Stat label="Email" value={data.mail.transport ? <span className="text-xl">{data.mail.transport === "resend" ? "Resend" : "Cloudflare"}</span> : <span className="text-xl text-muted-foreground">off</span>} hint={!data.mail.transport ? "needs MAIL_FROM + a transport" : data.mail.admin_email_set ? "you are notified of requests" : "ADMIN_EMAIL missing"} />
      </div>

      <Tabs defaultValue={pending.length ? "requests" : "invites"}>
        <TabsList>
          <TabsTrigger value="requests">Requests{pending.length > 0 && <Badge className="ml-1.5">{pending.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="invites">Invite codes</TabsTrigger>
          <TabsTrigger value="users">Accounts</TabsTrigger>
        </TabsList>

        <TabsContent value="requests">
          <Card className="mt-3">
            <CardHeader><CardTitle>Invite requests</CardTitle><CardDescription>Anyone can ask from the sign-up page. Approving creates a code and can email it for you.</CardDescription></CardHeader>
            <CardContent>
              {data.requests.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No requests yet.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Who</TableHead><TableHead className="hidden md:table-cell">Message</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.requests.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-medium">{r.name || r.email}</div>
                          {r.name && <div className="text-xs text-muted-foreground">{r.email}</div>}
                          <div className="text-xs text-muted-foreground">{ago(r.created_at)}</div>
                        </TableCell>
                        <TableCell className="hidden max-w-xs md:table-cell"><span className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{r.message || "—"}</span></TableCell>
                        <TableCell><Badge variant={r.status === "pending" ? "default" : r.status === "approved" ? "secondary" : "outline"}>{r.status}</Badge></TableCell>
                        <TableCell className="text-right">
                          {r.status === "pending" ? (
                            <div className="flex justify-end gap-1.5">
                              <Button size="sm" onClick={() => setIssue({ request: r })}><Check /> Approve</Button>
                              <Confirm title="Reject this request?" description={`${r.email} will not be notified.`} action="Reject" onConfirm={() => act("/api/web/admin/requests/decision", { id: r.id, decision: "reject" }, "Rejected")}><X /> Reject</Confirm>
                            </div>
                          ) : (
                            <Button variant="ghost" size="icon" aria-label="Delete request" onClick={() => act("/api/web/admin/requests/delete", { id: r.id }, "Deleted")}><Trash2 /></Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invites">
          <Card className="mt-3">
            <CardHeader><CardTitle>Invite codes</CardTitle><CardDescription>{data.master_code_set ? "The deployment's master SIGNUP_CODE also keeps working. " : ""}Codes are shown once when created; only a hash is stored.</CardDescription></CardHeader>
            <CardContent>
              {data.invites.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No codes yet.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>For</TableHead><TableHead>Used</TableHead><TableHead className="hidden sm:table-cell">Expires</TableHead><TableHead>State</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {data.invites.map((i) => {
                      const st = inviteState(i)
                      return (
                        <TableRow key={i.id}>
                          <TableCell className="font-mono text-xs">FLASH-····-····-{i.code_hint}</TableCell>
                          <TableCell className="text-sm">{i.label || i.email || "—"}</TableCell>
                          <TableCell>{i.uses}/{i.max_uses}</TableCell>
                          <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{i.expires_at ? new Date(i.expires_at).toLocaleDateString() : "never"}</TableCell>
                          <TableCell><Badge variant={st.v}>{st.t}</Badge></TableCell>
                          <TableCell className="text-right">
                            {st.t === "Active" && <Confirm title="Revoke this code?" description="It will stop working immediately. Accounts already created with it stay." action="Revoke" onConfirm={() => act("/api/web/admin/invites/revoke", { id: i.id }, "Revoked")}><Trash2 /></Confirm>}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users">
          <Card className="mt-3">
            <CardHeader><CardTitle>Accounts</CardTitle><CardDescription>{data.stats.users} total · {data.stats.agents} connected desktop apps · {data.stats.jobs} jobs run.</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Joined</TableHead><TableHead>Invite</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.users.map((u) => (
                    <TableRow key={u.id}><TableCell className="font-medium">{u.email}</TableCell><TableCell className="text-sm text-muted-foreground">{ago(u.created_at)}</TableCell><TableCell className="text-sm text-muted-foreground">{u.invite_label ?? "master code"}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <IssueDialog open={!!issue} onClose={() => setIssue(null)} preset={issue} onDone={(i) => { setIssued(i); void load() }} />

      <Dialog open={!!issued} onOpenChange={(o) => !o && setIssued(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Invite code created</DialogTitle><DialogDescription>It is shown only once. {issued ? mailText(issued.mail) + "." : ""}</DialogDescription></DialogHeader>
          {issued && (
            <div className="space-y-3">
              <CodeBlock>{issued.code}</CodeBlock>
              <p className="text-xs text-muted-foreground">{issued.expires_at ? `Valid until ${new Date(issued.expires_at).toLocaleString()}.` : "Never expires."}</p>
            </div>
          )}
          <DialogFooter><Button onClick={() => setIssued(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
