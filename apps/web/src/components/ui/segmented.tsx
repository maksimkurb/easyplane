import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export type SegmentedOption<T extends string> = {
  value: T
  label: ReactNode
  /** Optional count shown after the label, muted unless the option is on. */
  count?: ReactNode
  disabled?: boolean
}

/**
 * Segmented control used for filters and small enumerations. It is a radio
 * group, not a set of tabs: every option is mutually exclusive and the chosen
 * one is announced with aria-checked.
 */
export function Segmented<T extends string>({
  value,
  options,
  onValueChange,
  label,
  className,
  size = "default",
  fill = false,
}: {
  value: T
  options: SegmentedOption<T>[]
  onValueChange: (value: T) => void
  label: string
  className?: string
  size?: "default" | "sm"
  /** Equal-width options; use inside narrow panels and sheets. */
  fill?: boolean
}) {
  return (
    <div
      aria-label={label}
      className={cn(
        "inline-flex gap-0.5 rounded-[10px] bg-surface-3 p-[3px]",
        fill ? "w-full flex-none" : "flex-none",
        className
      )}
      role="radiogroup"
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            aria-checked={active}
            className={cn(
              "inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
              fill && "min-w-0 flex-1 justify-center px-1.5",
              size === "sm" && "h-7 px-2 text-xs",
              active
                ? "bg-card text-foreground shadow-sm ring-1 ring-line"
                : "text-fg-2 hover:text-foreground"
            )}
            disabled={option.disabled}
            key={option.value}
            onClick={() => onValueChange(option.value)}
            role="radio"
            type="button"
          >
            {option.label}
            {option.count !== undefined ? (
              <span className="font-normal text-fg-3">{option.count}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
