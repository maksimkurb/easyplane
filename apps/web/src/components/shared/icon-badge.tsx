import type { ReactNode } from "react"

import { Chip } from "@/components/ui/chip"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { ComponentProps } from "react"

/**
 * A status mark that takes one icon's worth of room. The label (and optional
 * extra lines) live in a tooltip; assistive tech reads `label` directly.
 */
export function IconBadge({
  icon,
  label,
  lines = [],
  variant,
}: {
  icon: ReactNode
  label: string
  lines?: readonly string[]
  variant?: ComponentProps<typeof Chip>["variant"]
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Chip
            aria-label={[label, ...lines].join(", ")}
            className="size-[22px] justify-center px-0"
            role="img"
            tabIndex={0}
            variant={variant}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent>
        <span className="block font-medium">{label}</span>
        {lines.map((line) => (
          <span className="block font-mono text-xs" key={line}>
            {line}
          </span>
        ))}
      </TooltipContent>
    </Tooltip>
  )
}
