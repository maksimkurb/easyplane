import { useTranslation } from "react-i18next"
import { useLocation } from "wouter"

import { useGetDevice, useGetNetwork } from "@/api/generated/easyplane"

export type Crumb = { label: string; href?: string }

/**
 * Breadcrumbs are derived from the URL because several routes (network
 * settings, map, access) share one breadcrumb that ends at the network. The
 * network and device names come from the same cached queries the page uses, so
 * this adds no extra request after the page has loaded.
 */
export function useBreadcrumbs(): { crumbs: Crumb[]; back: string } {
  const { t } = useTranslation()
  const [location] = useLocation()

  const networkMatch = location.match(/^\/networks\/(?!import$)([^/]+)/)
  const deviceMatch = location.match(/^\/devices\/([^/]+)/)
  const networkId = networkMatch?.[1] ?? ""
  const deviceId = deviceMatch?.[1] ?? ""

  const networkQuery = useGetNetwork(networkId, {
    query: { enabled: Boolean(networkId), retry: false },
  })
  const deviceQuery = useGetDevice(deviceId, {
    query: { enabled: Boolean(deviceId), retry: false },
  })

  const networkName =
    networkQuery.data?.data?.name ??
    deviceQuery.data?.data?.networkName ??
    networkId.slice(0, 8)
  const deviceNetworkId = deviceQuery.data?.data?.networkId

  if (location === "/" || (location.startsWith("/networks") && !networkMatch)) {
    if (location === "/networks/import") {
      return {
        crumbs: [
          { label: t("nav.items.networks"), href: "/networks" },
          { label: t("nav.items.importNetwork") },
        ],
        back: "/networks",
      }
    }
    return { crumbs: [{ label: t("nav.items.networks") }], back: "/networks" }
  }

  if (networkMatch) {
    return {
      crumbs: [
        { label: t("nav.items.networks"), href: "/networks" },
        { label: networkName },
      ],
      back: "/networks",
    }
  }

  if (deviceMatch) {
    const deviceName =
      deviceQuery.data?.data?.dnsName ||
      deviceQuery.data?.data?.hostname ||
      t("devices.detail.title")
    return {
      crumbs: [
        { label: t("nav.items.networks"), href: "/networks" },
        {
          label: networkName,
          href: deviceNetworkId ? `/networks/${deviceNetworkId}` : undefined,
        },
        { label: deviceName },
      ],
      back: deviceNetworkId ? `/networks/${deviceNetworkId}` : "/networks",
    }
  }

  if (location.startsWith("/audit")) {
    return { crumbs: [{ label: t("nav.items.audit") }], back: "/networks" }
  }
  if (location.startsWith("/topology")) {
    return { crumbs: [{ label: t("nav.items.topology") }], back: "/networks" }
  }
  if (location.startsWith("/devices")) {
    return { crumbs: [{ label: t("nav.items.devices") }], back: "/networks" }
  }
  if (location.startsWith("/pending")) {
    return { crumbs: [{ label: t("nav.items.pending") }], back: "/networks" }
  }
  return { crumbs: [{ label: t("nav.items.networks") }], back: "/networks" }
}
