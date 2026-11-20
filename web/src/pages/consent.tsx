import { CheckCircle2, Loader2, ShieldAlert, XCircle } from "lucide-react"
import { useEffect, useState } from "react"
import { useLocation, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api, ApiError } from "@/lib/api"
import { useSession } from "@/lib/session"
import { AuthFrame } from "./auth"

type Info =
  | { status: "login_required" }
  | { status: "error"; message: string }
  | { status: "redirect"; url: string }
  | { status: "consent"; user: string; client_name: string; redirect_host: string; fields: Record<string, string> }

/** Shared "go back to the client app" interstitial. */
function Returning({ url }: { url: string }) {
  useEffect(() => {
    window.location.assign(url)
  }, [url])
  return (
    <AuthFrame>
      <Card>
        <CardHeader>
          <CardTitle>Returning to the application…</CardTitle>
          <CardDescription>If nothing happens, <a className="underline" href={url}>continue</a>. You can close this tab afterwards.</CardDescription>
        </CardHeader>
      </Card>
    </AuthFrame>
  )
}

export function AuthorizePage() {
  const loc = useLocation()
  const { session } = useSession()
  const [info, setInfo] = useState<Info | null>(null)
  const [busy, setBusy] = useState(false)
  const [redirect, setRedirect] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session) return
    api<Info>(`/api/web/oauth/authorize${loc.search}`)
      .then((i) => {
        if (i.status === "login_required") window.location.replace(`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`)
        else setInfo(i)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
  }, [session, loc.pathname, loc.search])

  if (redirect) return <Returning url={redirect} />
  if (info?.status === "redirect") return <Returning url={info.url} />

  async function decide(decision: "approve" | "deny") {
    if (info?.status !== "consent") return
    setBusy(true)
    try {
      const r = await api<{ redirect: string }>("/api/web/oauth/decision", { body: { ...info.fields, decision } })
      setRedirect(r.redirect)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed")
      setBusy(false)
    }
  }

  return (
    <AuthFrame>
      {!info && !error ? (
        <Skeleton className="h-72" />
      ) : error || info?.status === "error" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><XCircle className="size-5 text-destructive" /> Can’t authorize</CardTitle>
            <CardDescription>{error ?? (info as { message: string }).message}</CardDescription>
          </CardHeader>
        </Card>
      ) : info?.status === "consent" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Authorize {info.client_name}</CardTitle>
            <CardDescription>
              Signed in as <span className="text-foreground">{info.user}</span>. <span className="text-foreground">{info.client_name}</span> (redirects to <code className="font-mono text-xs">{info.redirect_host}</code>) wants to use your MCU Bridge account.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-4 space-y-3 text-sm">
            {["List your connected microcontrollers and read their status", "Flash, verify and reset boards you have allowed in the desktop app", "Read serial output and boot logs"].map((t) => (
              <div key={t} className="flex items-start gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />{t}</div>
            ))}
            <div className="flex items-start gap-2.5 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              It can never run commands or access files on your PC. You can revoke access any time under Access → Connected apps. Only approve if you just added this connector yourself.
            </div>
          </CardContent>
          <CardFooter className="mt-4 gap-2">
            <Button className="flex-1" size="lg" disabled={busy} onClick={() => decide("approve")}>{busy && <Loader2 className="animate-spin" />} Allow access</Button>
            <Button className="flex-1" size="lg" variant="outline" disabled={busy} onClick={() => decide("deny")}>Cancel</Button>
          </CardFooter>
        </Card>
      ) : null}
    </AuthFrame>
  )
}

export function PairPage() {
  const [params] = useSearchParams()
  const code = (params.get("code") ?? "").toUpperCase()
  const { session } = useSession()
  const [data, setData] = useState<{ device_name: string; platform: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<"approved" | "denied" | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!session) return
    if (!session.user) {
      window.location.replace(`/login?next=${encodeURIComponent(`/pair?code=${code}`)}`)
      return
    }
    api<{ device_name: string; platform: string }>(`/api/web/pair?code=${encodeURIComponent(code)}`).then(setData).catch((e) => setError(e instanceof Error ? e.message : "Failed"))
  }, [session, code])

  async function decide(decision: "approve" | "deny") {
    setBusy(true)
    try {
      await api("/api/web/pair/decision", { body: { code, decision } })
      setDone(decision === "approve" ? "approved" : "denied")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame>
      {done ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">{done === "approved" ? <><CheckCircle2 className="size-5 text-emerald-500" /> Desktop connected</> : <><XCircle className="size-5 text-destructive" /> Request denied</>}</CardTitle>
            <CardDescription>{done === "approved" ? "You can close this tab. The desktop app connects automatically." : "The desktop app was not linked."}</CardDescription>
          </CardHeader>
        </Card>
      ) : error ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><XCircle className="size-5 text-destructive" /> Can’t pair</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : !data ? (
        <Skeleton className="h-72" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Connect a desktop app</CardTitle>
            <CardDescription>
              MCU Bridge on <span className="text-foreground">{data.device_name}</span> ({data.platform}) wants to link to <span className="text-foreground">{session?.user?.email}</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-4 space-y-4">
            <div>
              <p className="mb-2 text-xs text-muted-foreground">Confirm this code matches the one in the desktop app:</p>
              <div className="rounded-lg border bg-muted/40 py-5 text-center font-mono text-3xl tracking-[0.25em]">{code}</div>
            </div>
            <p className="text-xs text-muted-foreground">Only approve if you started this on your own computer. You can revoke the app at any time.</p>
          </CardContent>
          <CardFooter className="mt-2 gap-2">
            <Button className="flex-1" size="lg" disabled={busy} onClick={() => decide("approve")}>{busy && <Loader2 className="animate-spin" />} Approve</Button>
            <Button className="flex-1" size="lg" variant="outline" disabled={busy} onClick={() => decide("deny")}>Deny</Button>
          </CardFooter>
        </Card>
      )}
    </AuthFrame>
  )
}
