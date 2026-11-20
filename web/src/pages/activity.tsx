import { PageHeader } from "@/components/shell"
import { JobBadge } from "@/components/status"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ago } from "@/lib/format"
import { useOverview } from "@/lib/session"

export function ActivityPage() {
  const { data } = useOverview()
  if (!data) return <Skeleton className="h-96" />
  return (
    <>
      <PageHeader title="Activity" description="Every flash and verification requested through MCP. Firmware is never stored — only this metadata." />
      <Card className="ios-rise" style={{ "--i": 0 } as React.CSSProperties}>
        <CardContent>
          {data.jobs.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Board</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="max-w-40 truncate font-mono text-xs">{j.id}</TableCell>
                    <TableCell className="font-medium">{j.board}<span className="ml-2 text-xs text-muted-foreground">{j.family}</span></TableCell>
                    <TableCell className="capitalize">{j.kind}</TableCell>
                    <TableCell><JobBadge status={j.status} /></TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{j.error_code ?? ""}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{ago(j.finished_at ?? j.created_at)}</TableCell>
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
