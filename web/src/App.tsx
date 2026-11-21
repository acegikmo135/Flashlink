import { lazy, Suspense } from "react"
import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import { Shell } from "@/components/shell"
import { Skeleton } from "@/components/ui/skeleton"
import { useSession } from "@/lib/session"
import { AccessPage } from "@/pages/access"
import { AccountPage } from "@/pages/account"
import { AdminPage } from "@/pages/admin"
import { RequestInvitePage } from "@/pages/request-invite"
import { ActivityPage } from "@/pages/activity"
import { AuthPage } from "@/pages/auth"
import { AuthorizePage, PairPage } from "@/pages/consent"
import { DevicesPage } from "@/pages/devices"
import { OverviewPage } from "@/pages/overview"

const LandingPage = lazy(() => import("@/landing/LandingPage"))

function Protected({ children }: { children: React.ReactNode }) {
  const { session } = useSession()
  const loc = useLocation()
  if (!session) return <div className="p-10"><Skeleton className="h-40 w-full max-w-3xl" /></div>
  if (!session.user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  return <>{children}</>
}

function Landing() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#08090a" }} />}>
      <LandingPage />
    </Suspense>
  )
}

function Home() {
  const { session } = useSession()
  if (!session) return null
  if (session.user) return <Navigate to="/dashboard" replace />
  return <Landing />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/home" element={<Landing />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/signup" element={<AuthPage mode="signup" />} />
      <Route path="/request-invite" element={<RequestInvitePage />} />
      <Route path="/admin" element={<Navigate to="/dashboard/admin" replace />} />
      <Route path="/pair" element={<PairPage />} />
      <Route path="/oauth/authorize" element={<AuthorizePage />} />
      <Route path="/dashboard" element={<Protected><Shell /></Protected>}>
        <Route index element={<OverviewPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="access" element={<AccessPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
