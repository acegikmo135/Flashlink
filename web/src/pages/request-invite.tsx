import { CheckCircle2, Loader2 } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"
import { AuthFrame } from "./auth"

export function RequestInvitePage() {
  const [form, setForm] = useState({ email: "", name: "", message: "", website: "" })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api("/api/web/invite-request", { body: form })
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame>
      <Card>
        {done ? (
          <>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl"><CheckCircle2 className="size-5 text-ios-green" /> Request sent</CardTitle>
              <CardDescription>Thanks. If your request is approved, the invite code is emailed to <b>{form.email}</b>.</CardDescription>
            </CardHeader>
            <CardFooter className="mt-4 flex-col gap-3">
              <Link className="w-full" to="/signup"><Button className="h-11 w-full" size="lg">I have a code</Button></Link>
            </CardFooter>
          </>
        ) : (
          <form onSubmit={submit}>
            <CardHeader>
              <CardTitle className="text-xl">Request an invite</CardTitle>
              <CardDescription>MCU Bridge accounts are invite-only. Tell us who you are and the owner will review it.</CardDescription>
            </CardHeader>
            <CardContent className="mt-4 space-y-4">
              {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
              <div className="space-y-2">
                <Label htmlFor="r-email">Email</Label>
                <Input id="r-email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="r-name">Name <span className="font-normal text-muted-foreground">· optional</span></Label>
                <Input id="r-name" autoComplete="name" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="r-msg">What will you build? <span className="font-normal text-muted-foreground">· optional</span></Label>
                <textarea id="r-msg" rows={3} maxLength={500} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
              </div>
              {/* honeypot: real people never see or fill this */}
              <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
            </CardContent>
            <CardFooter className="mt-6 flex-col gap-3">
              <Button type="submit" className="h-11 w-full text-[15px]" size="lg" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />} Request invite
              </Button>
              <p className="text-sm text-muted-foreground">
                Already have a code? <Link className="font-medium text-foreground underline-offset-4 hover:underline" to="/signup">Create your account</Link>
              </p>
            </CardFooter>
          </form>
        )}
      </Card>
    </AuthFrame>
  )
}
