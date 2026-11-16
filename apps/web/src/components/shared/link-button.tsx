import type { ComponentProps } from "react"
import type { VariantProps } from "class-variance-authority"
import { Link } from "wouter"

import { buttonVariants } from "@/components/ui/button-variants"
import { cn } from "@/lib/utils"

/**
 * A real link that looks like a button. Base UI's Button render prop gives the
 * element button semantics; navigation needs link semantics, so this uses the
 * same variants on a plain <a> instead.
 */
export function LinkButton({
  className,
  variant = "default",
  size = "default",
  ...props
}: ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>) {
  return (
    <Link
      className={cn(buttonVariants({ variant, size }), className)}
      data-slot="link-button"
      {...props}
    />
  )
}
