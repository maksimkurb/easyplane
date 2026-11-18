import { useTranslation } from "react-i18next"

import { formatDateTime, formatRelativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * One timestamp format for the whole panel: relative ("2 days ago") in the
 * reader's language and the absolute value on hover/focus. Hiding the exact
 * time behind a tooltip keeps lists calm while still making an audit trail
 * precise when someone needs it.
 */
export function RelativeTime({
  value,
  className,
  empty = "—",
}: {
  value: string | null | undefined
  className?: string
  empty?: string
}) {
  const { i18n } = useTranslation()
  const relative = formatRelativeTime(value, i18n.language)
  if (!relative) return <span className={className}>{empty}</span>
  return (
    <time
      className={cn("whitespace-nowrap", className)}
      dateTime={value ?? undefined}
      title={formatDateTime(value, i18n.language)}
    >
      {relative}
    </time>
  )
}
