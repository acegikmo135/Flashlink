import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { api, type Overview } from "./api"

export interface SessionData {
  user: { id: string; email: string } | null
  admin?: boolean
  config: { origin: string; installer_url: string | null }
}

const Ctx = createContext<{ session: SessionData | null; reload: () => Promise<void> }>({ session: null, reload: async () => {} })
export const useSession = () => useContext(Ctx)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionData | null>(null)
  const reload = useCallback(async () => {
    try {
      const data = await api<SessionData | null>("/api/web/session")
      if (!data || typeof data !== "object" || !("config" in data)) throw new Error("no session API")
      setSession(data)
    } catch {
      setSession({ user: null, config: { origin: window.location.origin, installer_url: null } })
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])
  return <Ctx.Provider value={{ session, reload }}>{children}</Ctx.Provider>
}

const OvCtx = createContext<{ data: Overview | null; error: string | null; refresh: () => Promise<void> }>({ data: null, error: null, refresh: async () => {} })
export const useOverview = () => useContext(OvCtx)

export function OverviewProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try {
      setData(await api<Overview>("/api/web/overview"))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    }
  }, [])
  useEffect(() => {
    void refresh()
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh()
    }, 4000)
    return () => clearInterval(t)
  }, [refresh])
  return <OvCtx.Provider value={{ data, error, refresh }}>{children}</OvCtx.Provider>
}
