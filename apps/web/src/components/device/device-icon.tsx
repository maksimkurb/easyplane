import {
  LaptopIcon,
  MonitorIcon,
  RouterIcon,
  ServerIcon,
  SmartphoneIcon,
  SquareTerminalIcon,
} from "lucide-react"

import { deviceKind } from "@/lib/device-presentation"

/** Device glyph derived from the reported OS. See deviceKind(). */
export function DeviceIcon({
  os,
  className,
}: {
  os: { type?: string | null; distribution?: string | null }
  className?: string
}) {
  switch (deviceKind(os)) {
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
