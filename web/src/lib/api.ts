export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

export async function api<T = any>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  })
  let data: any = null
  try {
    data = await res.json()
  } catch {
    /* non-JSON */
  }
  if (!res.ok || data?.ok === false) {
    throw new ApiError(res.status, data?.error?.code ?? "ERROR", data?.error?.message ?? `Request failed (${res.status})`)
  }
  return data as T
}

export interface Device {
  device_id: string
  name: string | null
  state: string
  port: string | null
  family: string | null
  chip: string | null
  board: string | null
  remote_flashing_allowed: boolean
  flash_size: string | null
  active_job_id: string | null
}
export interface AgentInfo {
  id: string
  name: string
  platform: string
  created_at: number
  last_seen_at: number | null
  online: boolean
  version: string | null
  os: string | null
  devices: number
  toolchains: Record<string, { available: boolean; version?: string | null }>
}
export interface JobRow {
  id: string
  device_id: string | null
  kind: string
  board: string
  family: string
  status: string
  error_code: string | null
  created_at: number
  finished_at: number | null
}
export interface Overview {
  email: string
  stats: { agents_online: number; devices_ready: number; jobs_total: number; jobs_ok: number }
  agents: AgentInfo[]
  devices: Device[]
  tokens: { id: string; name: string; created_at: number; last_used_at: number | null }[]
  apps: { client_id: string; name: string; since: number }[]
  jobs: JobRow[]
}

export interface InviteRequestRow { id: string; email: string; name: string | null; message: string | null; status: "pending" | "approved" | "rejected"; created_at: number; handled_at: number | null; invite_id: string | null; mail_status: string | null }
export interface InviteRow { id: string; code_hint: string; label: string | null; email: string | null; max_uses: number; uses: number; expires_at: number | null; created_at: number; revoked_at: number | null; request_id: string | null }
export interface AdminOverview {
  mail: { transport: "resend" | "cloudflare" | null; admin_email_set: boolean; from_set: boolean }
  master_code_set: boolean
  stats: { users: number; pending: number; active_invites: number; agents: number; jobs: number }
  requests: InviteRequestRow[]
  invites: InviteRow[]
  users: { id: string; email: string; created_at: number; invite_label: string | null }[]
}
