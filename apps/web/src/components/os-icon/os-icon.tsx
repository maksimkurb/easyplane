import type { ComponentProps, ReactNode } from "react"

import { cn } from "@/lib/utils"
import { OS_GLYPHS } from "@/components/os-icon/os-icons"
import { resolveOs, type DeviceOs } from "@/components/os-icon/resolve-os"

/**
 * The OS glyph for a device, drawn with `currentColor` so it follows the
 * theme. Decorative by default; pass `label` when it stands on its own and
 * needs an accessible name (the label also becomes the native tooltip).
 *
 * Returns `fallback` when the OS is unknown, which lets <DeviceIcon> keep the
 * generic class icon (server / laptop / phone / router) for those devices.
 */
export function OsIcon({
  os,
  hostname,
  label,
  fallback = null,
  className,
  ...props
}: {
  /** The device's reported OS. */
  os: DeviceOs
  /** Weak hint used only when the OS is empty. */
  hostname?: string | null
  /** Accessible name; omit for a purely decorative icon. */
  label?: string
  /** Rendered when no OS glyph matches. */
  fallback?: ReactNode
} & Omit<ComponentProps<"svg">, "children">) {
  const glyph = resolveOs(os, hostname)
  if (!glyph) return <>{fallback}</>

  return (
    <svg
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cn("shrink-0", className)}
      data-os-icon={glyph}
      fill="currentColor"
      focusable="false"
      role={label ? "img" : undefined}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {label ? <title>{label}</title> : null}
      <path d={OS_GLYPHS[glyph].path} />
    </svg>
  )
}
