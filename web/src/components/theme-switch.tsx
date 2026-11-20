import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { Segmented } from "@/components/segmented"

/** Light / Dark / Auto. Adds a short colour cross-fade class so the switch animates smoothly. */
export function ThemeSwitch({ className, size = "sm", compact = false }: { className?: string; size?: "sm" | "md"; compact?: boolean }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const set = (v: string) => {
    const el = document.documentElement
    el.classList.add("theme-anim")
    setTheme(v)
    window.setTimeout(() => el.classList.remove("theme-anim"), 480)
  }
  return (
    <Segmented
      className={className}
      size={size}
      value={(mounted ? theme : "dark") as "light" | "dark" | "system"}
      onChange={set}
      options={[
        { value: "light", aria: "Light", label: compact ? <Sun className="size-3.5" /> : <><Sun className="size-3.5" />Light</> },
        { value: "dark", aria: "Dark", label: compact ? <Moon className="size-3.5" /> : <><Moon className="size-3.5" />Dark</> },
        { value: "system", aria: "Auto", label: compact ? <Monitor className="size-3.5" /> : <><Monitor className="size-3.5" />Auto</> },
      ]}
    />
  )
}
