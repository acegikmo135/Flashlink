import { Loader2, LogOut } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { PageHeader } from "@/components/shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"
import { useSession } from "@/lib/session"

export function AccountPage() {
  const { session, reload } = useSession()
  const nav = useNavigate()
  const [f, setF] = useState({ current_password: "", new_password: "" })
  const [busy, setBusy] = useState(false)

  async function change(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api("/api/web/password", { body: f })
      setF({ current_password: "", new_password: "" })
      toast.success("Password changed. Other browser sessions were signed out.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change password")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Account" description="Your sign-in and security settings." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>The email you sign in with.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input readOnly value={session?.user?.email ?? ""} />
            </div>
          </CardContent>
          <CardFooter>
            <Button variant="outline" onClick={async () => { await api("/api/web/logout", { body: {} }); await reload(); nav("/login") }}>
              <LogOut /> Sign out
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <form onSubmit={change}>
            <CardHeader>
              <CardTitle>Change password</CardTitle>
              <CardDescription>Other browser sessions are signed out when you change it.</CardDescription>
            </CardHeader>
            <CardContent className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cur">Current password</Label>
                <Input id="cur" type="password" autoComplete="current-password" required value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new">New password <span className="font-normal text-muted-foreground">· min. 10 characters</span></Label>
                <Input id="new" type="password" autoComplete="new-password" required minLength={10} value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} />
              </div>
            </CardContent>
            <CardFooter className="mt-6">
              <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Update password</Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </>
  )
}
