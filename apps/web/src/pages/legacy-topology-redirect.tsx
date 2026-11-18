import { useTranslation } from "react-i18next"
import { Redirect } from "wouter"

import { useListNetworks } from "@/api/generated/easyplane"

/**
 * `/topology` used to be a second, global copy of the per-network Map tab.
 * Keeping the URL as a redirect avoids dead bookmarks without maintaining two
 * maps: a deep link to one network opens its Map, otherwise the network list is
 * the place where a map can be chosen.
 */
export function LegacyTopologyRedirect() {
  const { t } = useTranslation()
  const networksQuery = useListNetworks()
  const networks = networksQuery.data?.data ?? []

  if (networksQuery.isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    )
  }

  const requested =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("network")
  const requestedNetwork = requested
    ? networks.find((network) => network.id === requested)
    : undefined

  if (requestedNetwork) {
    return <Redirect to={`/networks/${requestedNetwork.id}/map`} />
  }
  if (networks.length === 1) {
    return <Redirect to={`/networks/${networks[0]!.id}/map`} />
  }
  return <Redirect to="/networks" />
}
