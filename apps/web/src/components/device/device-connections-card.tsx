import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { ArrowRightIcon } from "lucide-react"

import type {
  GetNetworkTopology200LinksItem as TopologyLink,
  GetNetworkTopology200NodesItem as TopologyNode,
} from "@/api/generated/model"
import { LinkButton } from "@/components/shared/link-button"
import { Chip } from "@/components/ui/chip"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Direct and relayed peers from the topology snapshot. The link's own fields
 * decide the chip, so this matches what the map draws for the same device.
 */
export function DeviceConnectionsCard({
  networkId,
  deviceId,
  nodes,
  links,
  loading,
}: {
  networkId: string
  deviceId: string
  nodes: TopologyNode[]
  links: TopologyLink[]
  loading: boolean
}) {
  const { t } = useTranslation()
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const node = nodes.find((entry) => entry.deviceId === deviceId)
  const connections = node
    ? links.filter((link) => link.source === node.id || link.target === node.id)
    : []

  return (
    <section className="rounded-xl bg-card shadow-sm ring-1 ring-line">
      <div className="flex items-center gap-3 px-4 pt-4 pb-2 sm:px-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-base leading-6 font-semibold tracking-[-0.006em]">
            {t("devices.detail.connections")}
          </h2>
          <p className="text-[13px] text-fg-3">{t("devices.detail.connectionsHint")}</p>
        </div>
        <LinkButton href={`/networks/${networkId}/map`} size="sm" variant="ghost">
          {t("network.tabs.map")}
          <ArrowRightIcon className="size-4" />
        </LinkButton>
      </div>

      {loading ? (
        <div className="space-y-2 px-4 pb-4 sm:px-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : connections.length === 0 ? (
        <p className="px-4 pb-4 text-[13px] text-fg-3 sm:px-5">
          {t("devices.detail.noConnections")}
        </p>
      ) : (
        <div className="pb-1">
          {connections.map((link) => {
            const other = byId.get(link.source === node?.id ? link.target : link.source)
            return (
              <div
                className="flex min-h-12 items-center gap-2 border-t border-line px-4 py-2 sm:px-5"
                key={link.id}
              >
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                  {other?.hostname ?? link.target}
                </span>
                <Chip variant={link.kind === "direct" ? "ok" : "warn"}>
                  {link.kind === "direct" ? t("topology.direct") : t("topology.relayed")}
                </Chip>
                <span className="w-14 text-right font-mono text-xs text-fg-3">
                  {link.latencyMs !== null ? `${link.latencyMs} ms` : t("common.none")}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
