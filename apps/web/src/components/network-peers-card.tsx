import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import {
  GlobeIcon,
  Link2Icon,
  PlusIcon,
  ServerIcon,
  Trash2Icon,
} from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { Input } from "@/components/ui/input"

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
    <section className="rounded-xl bg-card shadow-sm ring-1 ring-line">
      <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-base leading-6 font-semibold tracking-[-0.006em]">
            {t("networks.peers.title")} ({peers.length})
          </h2>
          <p className="text-[13px] text-fg-3">{t("networks.peers.description")}</p>
        </div>
      </div>

      {peers.length === 0 ? (
        <p className="border-t border-line px-4 py-5 text-[13px] text-fg-3 sm:px-5">
          {t("networks.peers.empty")}
        </p>
      ) : (
        <div className="border-t border-line">
          {peers.map((peer) => (
            <PeerRow
              busy={busy}
              canWrite={isAdmin}
              devices={linkableDevices}
              key={peer.id}
              linkTarget={linkTargets[peer.id] ?? peer.suggestedDeviceId ?? ""}
              onLink={(deviceId) =>
                linkPeer.mutate({ networkId, peerId: peer.id, data: { deviceId } })
              }
              onLinkTarget={(value) =>
                setLinkTargets((current) => ({ ...current, [peer.id]: value }))
              }
              onRemove={() => deletePeer.mutate({ networkId, peerId: peer.id })}
              peer={peer}
            />
          ))}
        </div>
      )}

      {isAdmin ? (
        <div className="grid gap-4 border-t border-line px-4 py-4 md:grid-cols-2 sm:px-5">
          <div className="grid gap-2">
            <p className="text-[13px] font-medium">{t("networks.peers.addDevice")}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <OptionSelect
                aria-label={t("networks.peers.device")}
                className="min-w-0 sm:flex-1"
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
                className="max-sm:w-full"
                disabled={newDeviceId === "" || busy}
                onClick={() =>
                  updateHub.mutate({ deviceId: newDeviceId, data: { isHub: true } })
                }
                size="sm"
                type="button"
              >
                <PlusIcon className="size-4" />
                {t("networks.peers.addHub")}
              </Button>
            </div>
            <p className="text-xs text-fg-3">{t("networks.peers.addDeviceHint")}</p>
          </div>

          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (url.trim() === "") return
              createPeer.mutate({ networkId, data: { url: url.trim() } })
            }}
          >
            <p className="text-[13px] font-medium">{t("networks.peers.addExternal")}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                aria-label={t("networks.peers.url")}
                className="min-w-0 sm:flex-1"
                onChange={(event) => setUrl(event.target.value)}
                placeholder="tcp://hub.example.com:11010"
                value={url}
              />
              <Button
                className="max-sm:w-full"
                disabled={url.trim() === "" || busy}
                size="sm"
                type="submit"
              >
                <PlusIcon className="size-4" />
                {t("common.add")}
              </Button>
            </div>
            <p className="text-xs text-fg-3">{t("networks.peers.addExternalHint")}</p>
          </form>
        </div>
      ) : null}
    </section>
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
    <div className="border-t border-line px-4 py-3 first:border-t-0 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="grid size-9 flex-none place-items-center rounded-[9px] bg-surface-2 text-fg-2 ring-1 ring-line">
          {peer.kind === "device" ? (
            <ServerIcon aria-hidden="true" className="size-4" />
          ) : (
            <GlobeIcon aria-hidden="true" className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {peer.kind === "device" ? (
              <>
                <a
                  className="truncate font-medium hover:underline"
                  href={`/devices/${peer.deviceId}`}
                >
                  {deviceLabel || peer.deviceId?.slice(0, 8) || t("common.none")}
                </a>
                <Chip variant="brand">{t("networks.peers.hub")}</Chip>
              </>
            ) : (
              <>
                <code className="w-full break-all font-mono text-xs sm:w-auto sm:truncate">{peer.url}</code>
                <Chip>{t("networks.peers.kindValue.external")}</Chip>
              </>
            )}
          </div>
          <p className="mt-0.5 text-xs break-words text-fg-3">
            {peer.kind === "device"
              ? peer.endpoints.length > 0
                ? peer.endpoints.join(", ")
                : t("networks.peers.noEndpoints")
              : t("networks.peers.externalHint")}
          </p>
          {peer.kind === "external" && peer.suggestedDeviceId ? (
            <p className="mt-1 text-xs text-fg-3">
              {t("networks.peers.suggestion", {
                name: peer.suggestedDeviceHostname ?? peer.suggestedDeviceId,
              })}
            </p>
          ) : null}
        </div>
        {canWrite ? (
          <Button
            aria-label={t("common.remove")}
            disabled={busy}
            onClick={() => {
              if (window.confirm(t("networks.peers.removeConfirm"))) onRemove()
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Trash2Icon className="size-4" />
          </Button>
        ) : null}
      </div>

      {canWrite && peer.kind === "external" ? (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:pl-12">
          <OptionSelect
            aria-label={t("networks.peers.linkTo")}
            className="min-w-0 sm:w-56"
            empty={t("networks.peers.noLinkDevices")}
            onValueChange={onLinkTarget}
            options={devices.map((device) => ({
              value: device.id,
              label: device.dnsName ?? device.hostname,
            }))}
            placeholder={t("networks.peers.linkTo")}
            value={linkTarget}
          />
          <Button
            className="max-sm:w-full"
            disabled={linkTarget === "" || busy}
            onClick={() => onLink(linkTarget)}
            size="sm"
            type="button"
            variant="outline"
          >
            <Link2Icon className="size-4" />
            {t("networks.peers.linkTo")}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
