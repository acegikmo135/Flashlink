import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export function Dot({ on, className }: { on: boolean; className?: string }) {
  return <span className={cn("inline-block size-2 rounded-full", on ? "bg-emerald-500" : "bg-muted-foreground/40", className)} />
}

const JOB: Record<string, { label: string; cls: string }> = {
  completed: { label: "Completed", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500" },
  failed: { label: "Failed", cls: "border-red-500/30 bg-red-500/10 text-red-400" },
  verification_failed: { label: "Verify failed", cls: "border-red-500/30 bg-red-500/10 text-red-400" },
  cancelled: { label: "Cancelled", cls: "border-amber-500/30 bg-amber-500/10 text-amber-500" },
  expired: { label: "Expired", cls: "border-amber-500/30 bg-amber-500/10 text-amber-500" },
}

export function JobBadge({ status }: { status: string }) {
  const j = JOB[status]
  return (
    <Badge variant="outline" className={cn(j?.cls ?? "border-sky-500/30 bg-sky-500/10 text-sky-400")}>
      {j?.label ?? status.replace(/_/g, " ")}
    </Badge>
  )
}

export function DeviceStateBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    idle: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
    flashing: "border-amber-500/30 bg-amber-500/10 text-amber-500",
    verifying: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  }
  return (
    <Badge variant="outline" className={map[state] ?? ""}>
      {state === "idle" ? "Ready" : state.replace(/_/g, " ")}
    </Badge>
  )
}
