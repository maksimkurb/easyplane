import { useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function CopyButton({
  value,
  className,
  label,
}: {
  value: string
  className?: string
  label?: string
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard is unavailable on insecure origins; the value stays visible.
    }
  }

  return (
    <Button
      className={cn("shrink-0", className)}
      onClick={() => void copy()}
      size="sm"
      type="button"
      variant="outline"
    >
      {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
      {label ?? (copied ? t("common.copied") : t("common.copy"))}
    </Button>
  )
}
