import { useState } from "react"
import { useTranslation } from "react-i18next"
import { CheckIcon, CopyIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * An inline, low-chrome copyable value (network name, IP). The whole value is
 * the button: the redesign keeps copy affordances quiet instead of showing a
 * separate button next to every identifier.
 */
export function CopyInline({
  value,
  label,
  className,
  title,
  multiline = false,
}: {
  value: string
  label: string
  className?: string
  /** Full value on hover; the visible text may be truncated. */
  title?: string
  /** Let a long identifier wrap instead of truncating it. */
  multiline?: boolean
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard is unavailable on insecure origins; the value is still shown.
    }
  }

  return (
    <button
      aria-label={`${label} ${value}`}
      className={cn(
        "inline-flex h-8 min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 font-mono text-xs text-fg-2 hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
        className
      )}
      onClick={() => void copy()}
      title={title}
      type="button"
    >
      <span className={multiline ? "min-w-0 break-all" : "truncate"}>
        {value}
      </span>
      {copied ? (
        <CheckIcon aria-hidden="true" className="size-3.5 flex-none text-ok" />
      ) : (
        <CopyIcon aria-hidden="true" className="size-3.5 flex-none text-fg-3" />
      )}
      <span aria-live="polite" className="sr-only">
        {copied ? t("common.copied") : ""}
      </span>
    </button>
  )
}
