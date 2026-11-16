import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * The 1180px column from the redesign: 32px gutters on desktop, 24px on
 * tablets and 16px on phones.
 */
export function PageContainer({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn("mx-auto w-full max-w-[1180px] min-w-0 px-4 sm:px-6 lg:px-8", className)}
    >
      {children}
    </div>
  )
}
