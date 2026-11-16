import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

const chipVariants = cva(
  "inline-flex h-[22px] flex-none items-center gap-1 rounded-md px-2 text-xs leading-4 font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "bg-surface-2 text-fg-2 ring-1 ring-line",
        brand: "bg-brand-soft text-brand-text",
        relay: "bg-relay-soft text-relay",
        ok: "bg-ok-soft text-ok",
        warn: "bg-warn-soft text-warn ring-1 ring-warn-line",
        err: "bg-err-soft text-err ring-1 ring-err-line",
        outline: "bg-transparent text-fg-2 ring-1 ring-line",
        tag: "bg-transparent font-mono text-[11.5px] font-normal text-fg-2 ring-1 ring-line",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
)

export function Chip({
  className,
  variant,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof chipVariants>) {
  return <span className={cn(chipVariants({ variant }), className)} {...props} />
}

/** Online/offline indicator. Decorative; the text next to it carries meaning. */
export function Dot({
  online,
  className,
}: {
  online?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 flex-none rounded-full",
        online
          ? "bg-ok-dot ring-3 ring-ok-soft"
          : "bg-fg-3/50",
        className
      )}
    />
  )
}
