import { useTranslation } from "react-i18next"
import { AlertTriangleIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Non-blocking inline error for a background list (routes) that failed. The
 * rest of the page keeps working from the data it already has; the user can
 * retry once the retry budget in lib/query-retry is spent.
 */
export function RouteLoadError({
  onRetry,
  pending = false,
  message,
  className,
}: {
  onRetry: () => void
  pending?: boolean
  /** Overrides the default "Couldn't load routes" copy. */
  message?: string
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-warn-soft px-3 py-2 text-[13px] ring-1 ring-warn-line",
        className
      )}
      role="status"
    >
      <AlertTriangleIcon
        aria-hidden="true"
        className="size-4 flex-none text-warn"
      />
      <span className="min-w-0 flex-1 text-fg-2">
        {message ?? t("routes.loadError")}
      </span>
      <Button
        className="flex-none"
        disabled={pending}
        onClick={onRetry}
        size="sm"
        variant="outline"
      >
        {t("routes.retry")}
      </Button>
    </div>
  )
}
