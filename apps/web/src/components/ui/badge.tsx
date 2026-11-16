import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-[22px] w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-transparent px-2 py-0.5 text-xs leading-4 font-medium whitespace-nowrap transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-brand-soft text-brand-text [a]:hover:bg-brand-soft/80",
        secondary:
          "bg-surface-2 text-fg-2 ring-1 ring-line [a]:hover:bg-surface-3",
        success:
          "bg-ok-soft text-ok focus-visible:ring-success/20 dark:bg-ok-soft dark:focus-visible:ring-success/40 [a]:hover:bg-ok-soft/80",
        warning:
          "bg-warn-soft text-warn ring-1 ring-warn-line focus-visible:ring-warning/20 dark:bg-warn-soft dark:focus-visible:ring-warning/40 [a]:hover:bg-warn-soft/80",
        destructive:
          "bg-err-soft text-err ring-1 ring-err-line focus-visible:ring-destructive/20 dark:bg-err-soft dark:focus-visible:ring-destructive/40 [a]:hover:bg-err-soft/80",
        outline:
          "bg-surface-2 text-fg-2 ring-1 ring-line [a]:hover:bg-surface-3",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[22px] px-2 py-0.5 text-xs",
        xs: "h-[18px] px-1.5 py-0 text-[11px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  size = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, size }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge }
