import { useTranslation } from "react-i18next"

import { useGetDevice } from "@/api/generated/easyplane"
import type {
  GetNetworkTopology200LinksItem as TopologyLink,
  GetNetworkTopology200NodesItem as TopologyNode,
  GetNetworkTopology200ObservationsItem as TopologyObservation,
} from "@/api/generated/model"
import { DeviceStatusBadges } from "@/components/device-status"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export interface DeviceDrawerProps {
  node: TopologyNode | null
  observation: TopologyObservation | null
  links: TopologyLink[]
  nodes: TopologyNode[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Raw view of one device: the status fields the panel knows plus exactly what
 * the real client reported in CollectNetworkInfo (peer connections and route
 * table). Nothing is recomputed here, so an operator can compare the map's
 * derived link with the client's own numbers.
 */
export function DeviceDrawer({
  node,
  observation,
  links,
  nodes,
  open,
  onOpenChange,
}: DeviceDrawerProps) {
  const { t } = useTranslation()
  const byId = new Map(nodes.map((entry) => [entry.id, entry]))
  // Status fields that live on the device row (OS, last seen, revisions) are
  // not part of the topology snapshot, so the drawer reads them from the API.
  const deviceQuery = useGetDevice(node?.deviceId ?? "", {
    query: { enabled: Boolean(node?.deviceId) },
  })
  const device = deviceQuery.data?.data

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="overflow-y-auto sm:max-w-xl" side="right">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {node?.hostname ?? t("topology.deviceDrawer")}
            {node?.relayCapable ? (
              <Badge className="border-violet-500/40 text-violet-700 dark:text-violet-300" variant="outline">
                {t("topology.relayCapable")}
              </Badge>
            ) : null}
          </SheetTitle>
          <SheetDescription>
            {node?.peerId ? `peer ${node.peerId}` : t("common.none")} ·{" "}
            {observation?.collectedAt
              ? new Date(observation.collectedAt).toLocaleString()
              : t("topology.noProbeYet")}
          </SheetDescription>
        </SheetHeader>

        {node ? (
          <div className="space-y-5 px-4 pb-6">
            {device ? (
              <div className="space-y-2">
                <DeviceStatusBadges
                  online={device.online}
                  state={device.state}
                  sync={device.sync}
                />
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <Info
                    label={t("devices.os")}
                    value={
                      `${device.os.distribution || device.os.type} ${device.os.version}`.trim() ||
                      null
                    }
                  />
                  <Info label={t("devices.machineId")} mono value={device.machineId} />
                  <Info
                    label={t("devices.lastSeen")}
                    value={
                      device.lastSeenAt
                        ? new Date(device.lastSeenAt).toLocaleString()
                        : null
                    }
                  />
                  <Info
                    label={t("devices.appliedRevision")}
                    value={
                      device.appliedRevision !== null
                        ? `${device.appliedRevision} / ${device.desiredRevision ?? "—"}`
                        : null
                    }
                  />
                </dl>
                {device.lastPushError ? (
                  <p className="rounded border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-700 dark:text-red-300">
                    {t("devices.pushError")}: {device.lastPushError}
                  </p>
                ) : null}
              </div>
            ) : null}
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Info label={t("devices.virtualIp")} mono value={node.virtualIpv4} />
              <Info label={t("topology.natType")} value={node.natType} />
              <Info label={t("topology.tcpNatType")} value={node.tcpNatType} />
              <Info label={t("devices.version")} mono value={node.version} />
              <Info
                label={t("topology.publicIps")}
                mono
                value={node.publicIps.join(", ") || null}
              />
              <Info
                label={t("topology.listeners")}
                mono
                value={node.listeners.join(" ") || null}
              />
              <Info
                label={t("topology.proxyCidrs")}
                mono
                value={node.proxyCidrs.join(", ") || null}
              />
              <Info
                label={t("topology.relaysFor")}
                value={
                  node.relaysFor
                    .map((id) => byId.get(id)?.hostname ?? id)
                    .join(", ") || null
                }
              />
            </dl>

            {node.capabilityReasons.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {t("topology.capabilityReasons")}
                </p>
                <div className="flex flex-wrap gap-1">
                  {node.capabilityReasons.map((reason) => (
                    <Badge className="font-mono text-[10px]" key={reason} variant="outline">
                      {reason}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            <section>
              <h4 className="mb-2 text-sm font-medium">{t("topology.links")}</h4>
              {links.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("common.empty")}</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {links.map((link) => {
                    const other = byId.get(
                      link.source === node.id ? link.target : link.source
                    )
                    return (
                      <li
                        className="flex flex-wrap items-center gap-2 rounded border px-2 py-1.5"
                        key={link.id}
                      >
                        <Badge
                          className={
                            link.kind === "relayed"
                              ? "border-amber-500/40 text-amber-700 dark:text-amber-300"
                              : "border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                          }
                          variant="outline"
                        >
                          {link.kind === "direct"
                            ? t("topology.direct")
                            : t("topology.relayed")}
                        </Badge>
                        <span className="font-medium">
                          {other?.hostname ?? link.target}
                        </span>
                        <span className="text-muted-foreground">
                          {link.protocol}
                          {link.protocolIsFirstHop ? ` (${t("topology.firstHop")})` : ""}
                        </span>
                        {link.viaHostname ? (
                          <span className="text-muted-foreground">
                            {t("topology.viaRelay", { host: link.viaHostname })}
                          </span>
                        ) : null}
                        {link.latencyMs !== null ? <span>{link.latencyMs} ms</span> : null}
                        {link.lossPercent !== null ? (
                          <span>{link.lossPercent}% {t("topology.loss")}</span>
                        ) : null}
                        {link.cost !== null ? (
                          <span className="text-muted-foreground">
                            {t("topology.hops", { count: link.cost })}
                          </span>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <section>
              <h4 className="mb-1 text-sm font-medium">{t("topology.rawPeers")}</h4>
              <p className="mb-2 text-xs text-muted-foreground">
                {t("topology.rawPeersHint")}
              </p>
              {!observation || observation.peers.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("topology.noProbeYet")}</p>
              ) : (
                <div className="overflow-x-auto rounded border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">{t("topology.peerId")}</TableHead>
                        <TableHead className="text-xs">{t("topology.tunnel")}</TableHead>
                        <TableHead className="text-xs">{t("topology.latency")}</TableHead>
                        <TableHead className="text-xs">{t("topology.loss")}</TableHead>
                        <TableHead className="text-xs">{t("topology.direction")}</TableHead>
                        <TableHead className="text-xs">{t("topology.connRemote")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {observation.peers.map((peer) => (
                        <TableRow key={peer.connId}>
                          <TableCell className="font-mono text-[10px]">
                            {peer.peerId}
                            {peer.direct ? " · direct" : ""}
                          </TableCell>
                          <TableCell className="font-mono text-[10px]">
                            {peer.rawTunnelType || peer.protocol}
                          </TableCell>
                          <TableCell className="text-[10px]">
                            {peer.latencyMs !== null ? `${peer.latencyMs} ms` : t("common.none")}
                          </TableCell>
                          <TableCell className="text-[10px]">
                            {peer.lossPercent !== null ? `${peer.lossPercent}%` : t("common.none")}
                          </TableCell>
                          <TableCell className="text-[10px]">
                            {peer.isClient
                              ? t("topology.dialer")
                              : t("topology.acceptor")}
                          </TableCell>
                          <TableCell className="max-w-48 truncate font-mono text-[10px]">
                            {peer.remoteAddr ?? t("common.none")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            <section>
              <h4 className="mb-1 text-sm font-medium">{t("topology.rawRoutes")}</h4>
              <p className="mb-2 text-xs text-muted-foreground">
                {t("topology.rawRoutesHint")}
              </p>
              {!observation || observation.routes.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("topology.noProbeYet")}</p>
              ) : (
                <div className="overflow-x-auto rounded border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">{t("topology.host")}</TableHead>
                        <TableHead className="text-xs">IP</TableHead>
                        <TableHead className="text-xs">{t("topology.hops")}</TableHead>
                        <TableHead className="text-xs">{t("topology.nextHop")}</TableHead>
                        <TableHead className="text-xs">{t("topology.natType")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {observation.routes.map((route) => (
                        <TableRow key={route.peerId}>
                          <TableCell className="text-xs">{route.hostname}</TableCell>
                          <TableCell className="font-mono text-[10px]">
                            {route.virtualIpv4 ?? t("common.none")}
                          </TableCell>
                          <TableCell className="text-[10px]">{route.cost}</TableCell>
                          <TableCell className="font-mono text-[10px]">
                            {route.nextHopPeerId}
                          </TableCell>
                          <TableCell className="text-[10px]">{route.natType}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            {observation?.events && observation.events.length > 0 ? (
              <section>
                <h4 className="mb-1 text-sm font-medium">{t("topology.clientEvents")}</h4>
                <ul className="list-inside list-disc text-xs text-muted-foreground">
                  {observation.events.slice(-10).map((event, index) => (
                    <li key={`${index}-${event}`}>{event}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function Info({
  label,
  value,
  mono,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs break-all" : "text-sm"}>
        {value && value.length > 0 ? value : t("common.none")}
      </dd>
    </div>
  )
}
