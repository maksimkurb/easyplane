import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode
  description?: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        "mb-6 grid grid-cols-1 gap-x-4 gap-y-2 md:mb-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-start",
        className
      )}
    >
      <h1
        className="min-w-0 text-2xl leading-8 font-semibold tracking-[-0.018em] text-balance"
        id="page-title"
      >
        {title}
      </h1>
      {actions ? (
        <div className="order-3 min-w-0 pt-2 md:order-none md:pt-0">
          {actions}
        </div>
      ) : null}
      {description ? (
        <p className="min-w-0 text-sm text-pretty text-fg-3 md:col-span-2">
          {description}
        </p>
      ) : null}
    </header>
  )
}
