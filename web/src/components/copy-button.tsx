import { Check, Copy } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        setDone(true)
        setTimeout(() => setDone(false), 1600)
      }}
    >
      {done ? <Check /> : <Copy />}
      {done ? "Copied" : label}
    </Button>
  )
}

export function CodeBlock({ children, copy }: { children: string; copy?: boolean }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3">
      <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed">{children}</code>
      {copy !== false && <CopyButton value={children} />}
    </div>
  )
}
