import { Loader2 } from "lucide-react"
import { useState } from "react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { Brand } from "@/components/logo"
import { ThemeSwitch } from "@/components/theme-switch"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"
import { safeNext } from "@/lib/format"
import { useSession } from "@/lib/session"

export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_oklab,var(--ios-blue)_16%,transparent),transparent)]" />
      <div className="absolute right-4 top-4">
        <ThemeSwitch compact />
      </div>
      <div className="mb-8 text-lg">
        <Brand />
      </div>
      <div className="ios-pop relative w-full max-w-sm">{children}</div>
      <p className="mt-8 max-w-sm text-center text-xs text-muted-foreground">Cloud-to-desktop firmware flashing for AI coding agents.</p>
    </div>
  )
}

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const { session, reload } = useSession()
  const [params] = useSearchParams()
  const nav = useNavigate()
  const next = safeNext(params.get("next"))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ email: "", password: "", invite: "" })
  const signup = mode === "signup"

  if (session?.user) return <Navigate to={next} replace />

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api(`/api/web/${mode}`, { body: form })
      await reload()
      if (next.startsWith("/oauth/")) window.location.assign(next)
      else nav(next, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  const q = params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : ""
  return (
    <AuthFrame>
      <Card>
        <form onSubmit={submit}>
          <CardHeader>
            <CardTitle className="text-xl">{signup ? "Create your account" : "Welcome back"}</CardTitle>
            <CardDescription>{signup ? "An invite code is required. The setup script printed it once." : "Sign in to manage your desktop apps, devices and access."}</CardDescription>
          </CardHeader>
          <CardContent className="mt-4 space-y-4">
            {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="username" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password{signup && <span className="font-normal text-muted-foreground"> · min. 10 characters</span>}</Label>
              <Input id="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 10 : 1} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            {signup && (
              <div className="space-y-2">
                <Label htmlFor="invite">Invite code</Label>
                <Input id="invite" autoComplete="off" spellCheck={false} required value={form.invite} onChange={(e) => setForm({ ...form, invite: e.target.value })} />
              </div>
            )}
          </CardContent>
          <CardFooter className="mt-6 flex-col gap-3">
            <Button type="submit" className="h-11 w-full text-[15px]" size="lg" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {signup ? "Create account" : "Sign in"}
            </Button>
            <p className="text-sm text-muted-foreground">
              {signup ? "Already have an account? " : "No account yet? "}
              <Link className="font-medium text-foreground underline-offset-4 hover:underline" to={`${signup ? "/login" : "/signup"}${q}`} onClick={() => toast.dismiss()}>
                {signup ? "Sign in" : "Create one"}
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </AuthFrame>
  )
}
