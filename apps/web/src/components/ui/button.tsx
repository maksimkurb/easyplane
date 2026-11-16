import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "cursor-pointer group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-[var(--brand-hover)] [a]:hover:bg-[var(--brand-hover)]",
        outline:
          "border-line-2 bg-card text-foreground shadow-xs hover:bg-surface-2 aria-expanded:bg-surface-2 aria-expanded:text-foreground",
        secondary:
          "bg-surface-2 text-foreground hover:bg-surface-3 aria-expanded:bg-surface-3 aria-expanded:text-foreground",
        ghost:
          "text-fg-2 hover:bg-surface-2 hover:text-foreground aria-expanded:bg-surface-2 aria-expanded:text-foreground",
        destructive:
          "border-err-line bg-card text-err shadow-xs hover:bg-err-soft focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 gap-2 px-4",
        xs: "h-7 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 rounded-lg px-3 text-[13px] [&_svg:not([class*='size-'])]:size-4",
        lg: "h-11 gap-2 rounded-lg px-5 text-[15px]",
        xl: "h-12 gap-2 rounded-xl px-6 text-base",
        icon: "size-10 px-0",
        "icon-xs": "size-7 rounded-md px-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9 rounded-lg px-0",
        "icon-lg": "size-11 rounded-lg px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button }
