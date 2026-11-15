import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { Link2Icon, PlusIcon, Trash2Icon, WaypointsIcon } from "lucide-react"
import { toast } from "sonner"

import {
  getListDevicesQueryKey,
  getListNetworkPeersQueryKey,
  useCreateNetworkPeer,
  useDeleteNetworkPeer,
  useLinkNetworkPeer,
  useListDevices,
  useListNetworkPeers,
  useUpdateDeviceHub,
} from "@/api/generated/easyplane"
import type { ListNetworkPeers200PeersItem } from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { OptionSelect } from "@/components/shared/option-select"
import { SectionCard } from "@/components/shared/section-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * A network's ordered peer list. Device-backed entries expand to the device's
 * advertised endpoints at push time and exclude the device itself, so a hub is
 * a listener and never dials its own public URL. Raw external URLs are pushed
 * verbatim; one that exactly matches a known device's endpoint is offered for
 * linking, which converts it into a device-backed entry.
 */
export function NetworkPeersCard({ networkId }: { networkId: string }) {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const peersQuery = useListNetworkPeers(networkId)
  const devicesQuery = useListDevices({ networkId })
  const [url, setUrl] = useState("")
  const [newDeviceId, setNewDeviceId] = useState("")
  const [linkTargets, setLinkTargets] = useState<Record<string, string>>({})

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: getListNetworkPeersQueryKey(networkId),
    })
    await queryClient.invalidateQueries({
      queryKey: getListDevicesQueryKey({ networkId }),
    })
  }

  const onError = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : t("common.error"))

  const createPeer = useCreateNetworkPeer({
    mutation: {
      onSuccess: async () => {
        toast.success(t("networks.peers.added"))
        setUrl("")
        await refresh()
      },
      onError,
    },
  })
  const deletePeer = useDeleteNetworkPeer({
    mutation: {
      onSuccess: async () => {
        toast.success(t("networks.peers.removed"))
        await refresh()
      },
      onError,
    },
  })
  const linkPeer = useLinkNetworkPeer({
    mutation: {
      onSuccess: async () => {
        toast.success(t("networks.peers.linked"))
        await refresh()
      },
      onError,
    },
  })
  const updateHub = useUpdateDeviceHub({
    mutation: {
      onSuccess: async () => {
        toast.success(t("networks.peers.added"))
        await refresh()
      },
      onError,
    },
  })

  const peers = peersQuery.data?.data.peers ?? []
  const devices = devicesQuery.data?.data ?? []
  const deviceBacked = new Set(
    peers.filter((peer) => peer.kind === "device").map((peer) => peer.deviceId)
  )
  const addableDevices = devices.filter((device) => !deviceBacked.has(device.id))
  const linkableDevices = devices.filter((device) => device.state === "approved")
  const busy =
    createPeer.isPending ||
    deletePeer.isPending ||
    linkPeer.isPending ||
    updateHub.isPending

  return (
    <SectionCard
      action={<WaypointsIcon className="size-4 text-muted-foreground" />}
      description={t("networks.peers.description")}
      title={`${t("networks.peers.title")} (${peers.length})`}
    >
      {peers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("networks.peers.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("networks.peers.peer")}</TableHead>
                <TableHead>{t("networks.peers.kind")}</TableHead>
                <TableHead>{t("networks.peers.endpoints")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {peers.map((peer) => (
                <PeerRow
                  busy={busy}
                  devices={linkableDevices}
                  key={peer.id}
                  linkTarget={
                    linkTargets[peer.id] ?? peer.suggestedDeviceId ?? ""
                  }
                  onLinkTarget={(value) =>
                    setLinkTargets((current) => ({ ...current, [peer.id]: value }))
                  }
                  onLink={(deviceId) =>
                    linkPeer.mutate({
                      networkId,
                      peerId: peer.id,
                      data: { deviceId },
                    })
                  }
                  onRemove={() =>
                    deletePeer.mutate({ networkId, peerId: peer.id })
                  }
                  peer={peer}
                  canWrite={isAdmin}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {isAdmin ? (
        <div className="mt-4 grid gap-4 border-t pt-4 md:grid-cols-2">
          <div className="grid gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t("networks.peers.addDevice")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <OptionSelect
                aria-label={t("networks.peers.device")}
                className="min-w-48 flex-1"
                empty={t("networks.peers.noDevices")}
                onValueChange={setNewDeviceId}
                options={addableDevices.map((device) => ({
                  value: device.id,
                  label:
                    device.dnsName ??
                    device.hostname ??
                    device.machineId.slice(0, 8),
                }))}
                placeholder={t("networks.peers.devicePlaceholder")}
                value={newDeviceId}
              />
              <Button
                disabled={newDeviceId === "" || busy}
                onClick={() =>
                  updateHub.mutate({
                    deviceId: newDeviceId,
                    data: { isHub: true },
                  })
                }
                size="sm"
                type="button"
              >
                <PlusIcon className="size-4" />
                {t("networks.peers.addHub")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("networks.peers.addDeviceHint")}
            </p>
          </div>

          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (url.trim() === "") return
              createPeer.mutate({ networkId, data: { url: url.trim() } })
            }}
          >
            <p className="text-xs font-medium text-muted-foreground">
              {t("networks.peers.addExternal")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={t("networks.peers.url")}
                className="min-w-48 flex-1"
                onChange={(event) => setUrl(event.target.value)}
                placeholder="tcp://hub.example.com:11010"
                value={url}
              />
              <Button disabled={url.trim() === "" || busy} size="sm" type="submit">
                <PlusIcon className="size-4" />
                {t("common.add")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("networks.peers.addExternalHint")}
            </p>
          </form>
        </div>
      ) : null}
    </SectionCard>
  )
}

function PeerRow({
  peer,
  devices,
  linkTarget,
  onLinkTarget,
  onLink,
  onRemove,
  canWrite,
  busy,
}: {
  peer: ListNetworkPeers200PeersItem
  devices: Array<{ id: string; dnsName: string | null; hostname: string }>
  linkTarget: string
  onLinkTarget: (value: string) => void
  onLink: (deviceId: string) => void
  onRemove: () => void
  canWrite: boolean
  busy: boolean
}) {
  const { t } = useTranslation()
  const deviceLabel = peer.deviceDnsName ?? peer.deviceHostname
  return (
    <TableRow>
      <TableCell className="max-w-64">
        {peer.kind === "device" ? (
          <div className="min-w-0">
            {peer.deviceId ? (
              <a
                className="truncate font-medium hover:underline"
                href={`/devices/${peer.deviceId}`}
              >
                {deviceLabel || peer.deviceId.slice(0, 8)}
              </a>
            ) : (
              <span className="text-muted-foreground">{t("common.none")}</span>
            )}
            <div className="truncate font-mono text-xs text-muted-foreground">
              {peer.endpoints.length > 0
                ? peer.endpoints.join(", ")
                : t("networks.peers.noEndpoints")}
            </div>
          </div>
        ) : (
          <div className="min-w-0">
            <code className="block truncate rounded bg-muted px-1.5 py-0.5 text-xs">
              {peer.url}
            </code>
            {peer.suggestedDeviceId ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("networks.peers.suggestion", {
                  name: peer.suggestedDeviceHostname ?? peer.suggestedDeviceId,
                })}
              </p>
            ) : null}
          </div>
        )}
      </TableCell>
      <TableCell>
        <Badge variant={peer.kind === "device" ? "default" : "outline"}>
          {t(`networks.peers.kindValue.${peer.kind}`)}
        </Badge>
        {peer.kind === "device" ? (
          <div className="mt-1 text-xs text-muted-foreground">
            {peer.deviceIsHub ? t("networks.peers.hub") : t("networks.peers.notHub")}
          </div>
        ) : null}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {peer.kind === "device"
          ? t("networks.peers.deviceHint")
          : t("networks.peers.externalHint")}
      </TableCell>
      <TableCell className="text-right">
        {canWrite ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {peer.kind === "external" ? (
              <>
                <OptionSelect
                  aria-label={t("networks.peers.linkTo")}
                  className="w-40"
                  empty={t("networks.peers.noLinkDevices")}
                  onValueChange={onLinkTarget}
                  options={devices.map((device) => ({
                    value: device.id,
                    label: device.dnsName ?? device.hostname,
                  }))}
                  triggerClassName="h-8"
                  value={linkTarget}
                />
                <Button
                  disabled={linkTarget === "" || busy}
                  onClick={() => onLink(linkTarget)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Link2Icon className="size-4" />
                  {t("networks.peers.linkTo")}
                </Button>
              </>
            ) : null}
            <Button
              disabled={busy}
              onClick={() => {
                if (window.confirm(t("networks.peers.removeConfirm"))) onRemove()
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Trash2Icon className="size-4" />
              {t("common.remove")}
            </Button>
          </div>
        ) : null}
      </TableCell>
    </TableRow>
  )
}
