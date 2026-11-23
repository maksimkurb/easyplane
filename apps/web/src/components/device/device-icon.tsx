import {
  LaptopIcon,
  MonitorIcon,
  RouterIcon,
  ServerIcon,
  SmartphoneIcon,
  SquareTerminalIcon,
} from "lucide-react"

import type { DeviceOs } from "@/components/os-icon/resolve-os"
import { OsIcon } from "@/components/os-icon/os-icon"
import { deviceKind, type DeviceKind } from "@/lib/device-presentation"

/**
 * Device glyph: the reported OS when we have a mark for it, otherwise the
 * best-effort class icon. See deviceKind() and resolveOs().
 */
export function DeviceIcon({
  os,
  hostname,
  className,
}: {
  os: DeviceOs
  /** Weak fallback hint, used only when the OS is empty. */
  hostname?: string | null
  className?: string
}) {
  return (
    <OsIcon
      className={className}
      fallback={<DeviceClassIcon className={className} kind={deviceKind(os)} />}
      hostname={hostname}
      os={os}
    />
  )
}

function DeviceClassIcon({
  kind,
  className,
}: {
  kind: DeviceKind
  className?: string
}) {
  switch (kind) {
    case "phone":
      return <SmartphoneIcon aria-hidden="true" className={className} />
    case "router":
      return <RouterIcon aria-hidden="true" className={className} />
    case "server":
      return <ServerIcon aria-hidden="true" className={className} />
    case "windows":
      return <MonitorIcon aria-hidden="true" className={className} />
    case "laptop":
      return <LaptopIcon aria-hidden="true" className={className} />
    default:
      return <SquareTerminalIcon aria-hidden="true" className={className} />
  }
}
