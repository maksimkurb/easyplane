import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "wouter"
import {
  ChevronDownIcon,
  KeyRoundIcon,
  LinkIcon,
  PlusIcon,
  TrashIcon,
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  getGetNetworkQueryKey,
  getListInvitesQueryKey,
  getListNetworksQueryKey,
  useDeleteNetwork,
  useRevokeInvite,
  useUpdateNetwork,
} from "@/api/generated/easyplane"
import type {
  ListInvites200Item,
  UpdateNetworkBody,
} from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { CopyInline } from "@/components/shared/copy-inline"
import { NetworkMagicDnsCard } from "@/components/network-magic-dns-card"
import { NetworkPeersCard } from "@/components/network-peers-card"
import { NetworkRendezvousCard } from "@/components/network-rendezvous-card"
import { NetworkRoutesCard } from "@/components/network-routes-card"
import { NetworkSecuritySettings } from "@/components/network/network-security-card"
import {
  NetworkShell,
  type NetworkShellData,
} from "@/components/network/network-shell"
import {
  SettingsCard,
  SettingsRow,
  SwitchRowBody,
  UnsavedChangesBar,
} from "@/components/network/settings-layout"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

const SECTIONS = [
  "general",
  "connectivity",
  "dns",
  "security",
  "invites",
  "danger",
] as const

type Section = (typeof SECTIONS)[number]

export function NetworkSettingsPage({ networkId }: { networkId: string }) {
  return (
    <NetworkShell networkId={networkId} tab="settings">
      {(data) => <SettingsTab data={data} />}
    </NetworkShell>
  )
}

function SettingsTab({ data }: { data: NetworkShellData }) {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const [, navigate] = useLocation()
  const network = data.network

  const [section, setSection] = useState<Section>("general")
  const [name, setName] = useState(network.name)
  const [zone, setZone] = useState(network.magicDnsZone)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteName, setDeleteName] = useState("")
  const [revokeTarget, setRevokeTarget] = useState<ListInvites200Item | null>(
    null
  )

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getGetNetworkQueryKey(network.id),
      }),
      queryClient.invalidateQueries({ queryKey: getListNetworksQueryKey() }),
      queryClient.invalidateQueries({
        queryKey: getListInvitesQueryKey(network.id),
      }),
    ])
  }
  const onError = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : t("common.error"))

  const update = useUpdateNetwork({
    mutation: {
      onError,
    },
  })
  const revokeInvite = useRevokeInvite({
    mutation: {
      onSuccess: async () => {
        setRevokeTarget(null)
        toast.success(t("settings.revoked"))
        await refresh()
      },
      onError,
    },
  })
  const remove = useDeleteNetwork({
    mutation: {
      onSuccess: async () => {
        toast.success(t("settings.deleted"))
        await queryClient.invalidateQueries({
          queryKey: getListNetworksQueryKey(),
        })
        navigate("/networks")
      },
      onError,
    },
  })

  // Switches and other single-value changes apply immediately. The toast's
  // Undo writes the previous value back, so a mis-tap is always recoverable.
  const applyPatch = (patch: UpdateNetworkBody, undo?: UpdateNetworkBody) => {
    update.mutate(
      { networkId: network.id, data: patch },
      {
        onSuccess: async () => {
          await refresh()
          toast.success(t("settings.saved"), {
            action: undo
              ? {
                  label: t("common.undo"),
                  onClick: () =>
                    update.mutate(
                      { networkId: network.id, data: undo },
                      {
                        onSuccess: async () => {
                          await refresh()
                          toast.success(t("settings.undone"))
                        },
                      }
                    ),
                }
              : undefined,
          })
        },
      }
    )
  }

  const nameDirty = name.trim() !== network.name && name.trim() !== ""
  const zoneDirty = zone.trim() !== network.magicDnsZone
  const zoneValid = zone.trim().length >= 3

  const saveName = () =>
    update.mutate(
      { networkId: network.id, data: { name: name.trim() } },
      {
        onSuccess: async () => {
          await refresh()
          toast.success(t("settings.saved"))
        },
      }
    )

  const saveZone = () =>
    update.mutate(
      { networkId: network.id, data: { magicDnsZone: zone.trim() } },
      {
        onSuccess: async () => {
          await refresh()
          toast.success(t("settings.saved"))
        },
      }
    )

  const label = (id: Section) => t(`settings.sections.${id}`)

  return (
    <div className="grid items-start gap-4 md:grid-cols-[190px_minmax(0,1fr)] md:gap-6">
      <nav
        aria-label={t("settings.navLabel")}
        className="-mx-1 flex [scrollbar-width:none] gap-1 overflow-x-auto rounded-xl bg-surface-3 p-1 md:sticky md:top-4 md:mx-0 md:flex-col md:rounded-none md:bg-transparent md:p-0 [&::-webkit-scrollbar]:hidden"
      >
        {SECTIONS.map((id) => {
          const current = section === id
          return (
            <button
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex h-9 flex-none items-center rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                current
                  ? "bg-card text-foreground shadow-sm ring-1 ring-line md:bg-surface-2 md:shadow-none"
                  : "text-fg-2 hover:text-foreground",
                id === "danger" && "text-err hover:text-err"
              )}
              key={id}
              onClick={() => setSection(id)}
              type="button"
            >
              {label(id)}
            </button>
          )
        })}
      </nav>

      <div
        aria-label={label(section)}
        className="min-w-0"
        key={section}
        role="region"
      >
        {section === "general" ? (
          <SettingsCard
            description={t("settings.generalDescription")}
            title={t("settings.general")}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (nameDirty) saveName()
              }}
            >
              <SettingsRow
                description={t("settings.nameHint")}
                htmlFor="settings-name"
                label={t("networks.name")}
              >
                <Input
                  disabled={!isAdmin}
                  id="settings-name"
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                  value={name}
                />
              </SettingsRow>
              <UnsavedChangesBar
                onDiscard={() => setName(network.name)}
                onSave={saveName}
                saving={update.isPending}
                show={nameDirty && isAdmin}
              />
            </form>
            <SettingsRow
              description={t("settings.networkNameHint")}
              label={t("networks.networkName")}
            >
              <div className="flex h-10 items-center gap-2 rounded-lg bg-surface-2 px-3 ring-1 ring-line">
                <CopyInline
                  label={t("network.copyName", { name: network.networkName })}
                  value={network.networkName}
                />
              </div>
            </SettingsRow>
            <SettingsRow
              description={t("settings.cidrHint")}
              label={t("networks.table.range")}
            >
              <div className="flex h-10 items-center rounded-lg bg-surface-2 px-3 font-mono text-sm ring-1 ring-line">
                {network.ipv4Cidr}
              </div>
            </SettingsRow>
          </SettingsCard>
        ) : null}

        {section === "connectivity" ? (
          <SettingsCard
            description={t("settings.connectivityDescription")}
            title={t("settings.sections.connectivity")}
          >
            <SettingsRow
              description={t("settings.hubsRowHint")}
              label={t("settings.hubsRow")}
            >
              <div className="flex flex-col gap-3">
                <p className="text-xs text-fg-3">
                  {t("settings.hubHint")}{" "}
                  <Link
                    className="font-medium text-brand-text hover:underline"
                    href={`/networks/${network.id}`}
                  >
                    {t("network.tabs.devices")}
                  </Link>
                </p>
                <NetworkPeersCard embedded networkId={network.id} />
              </div>
            </SettingsRow>

            <SettingsRow
              description={t("settings.relayRowHint")}
              label={t("settings.relayRow")}
            >
              <NetworkRendezvousCard embedded network={network} />
            </SettingsRow>

            <SettingsRow
              description={t("settings.directOnlyHint")}
              label={t("settings.directOnlyRow")}
            >
              <div className="flex flex-col gap-2">
                <SwitchRowBody
                  checked={network.p2pOnly}
                  disabled={!isAdmin || update.isPending}
                  label={t("settings.directOnlyRow")}
                  offLabel={t("settings.directOnlyOff")}
                  onCheckedChange={(checked) =>
                    applyPatch(
                      { p2pOnly: checked },
                      { p2pOnly: network.p2pOnly }
                    )
                  }
                  onLabel={t("settings.directOnlyOn")}
                />
                {network.p2pOnly ? (
                  <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-fg-2 ring-1 ring-warn-line">
                    {t("rendezvous.p2pOnlyWarning")}
                  </p>
                ) : null}
              </div>
            </SettingsRow>

            <div className="border-t border-line px-4 py-4 sm:px-5 sm:py-5">
              <details className="rounded-lg ring-1 ring-line">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-[13px] font-medium hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
                  <ChevronDownIcon
                    aria-hidden="true"
                    className="size-4 text-fg-3"
                  />
                  {t("settings.advanced")} · {t("settings.routesRow")}
                </summary>
                <div className="border-t border-line px-3 py-3">
                  <p className="mb-3 text-xs text-fg-3">
                    {t("settings.routesHint")}
                  </p>
                  <NetworkRoutesCard embedded networkId={network.id} />
                </div>
              </details>
            </div>
          </SettingsCard>
        ) : null}

        {section === "dns" ? (
          <SettingsCard
            description={t("settings.dnsDescription")}
            title={t("settings.sections.dns")}
          >
            <SettingsRow
              description={t("settings.magicDnsRowHint")}
              label={t("settings.magicDnsRow")}
            >
              <SwitchRowBody
                checked={network.magicDnsEnabled}
                disabled={!isAdmin || update.isPending}
                label={t("settings.magicDnsRow")}
                offLabel={t("magicDns.off")}
                onCheckedChange={(checked) =>
                  applyPatch(
                    { magicDnsEnabled: checked },
                    { magicDnsEnabled: network.magicDnsEnabled }
                  )
                }
                onLabel={t("magicDns.on")}
              />
            </SettingsRow>

            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (zoneDirty && zoneValid) saveZone()
              }}
            >
              <SettingsRow
                description={t("settings.zoneHint", {
                  zone: network.magicDnsZone,
                })}
                htmlFor="settings-zone"
                label={t("settings.zoneRow")}
              >
                <div className="flex flex-col gap-2">
                  <Input
                    aria-describedby={
                      zoneValid ? undefined : "settings-zone-error"
                    }
                    aria-invalid={!zoneValid}
                    aria-label={t("settings.zoneRow")}
                    className="max-w-72 font-mono"
                    disabled={!isAdmin}
                    id="settings-zone"
                    maxLength={200}
                    onChange={(event) => setZone(event.target.value)}
                    value={zone}
                  />
                  {!zoneValid ? (
                    <p
                      className="text-xs text-err"
                      id="settings-zone-error"
                      role="alert"
                    >
                      {t("settings.zoneMinHint")}
                    </p>
                  ) : (
                    <p className="text-xs text-fg-3">
                      {t("settings.zoneChangeHint")}
                    </p>
                  )}
                </div>
              </SettingsRow>
              <UnsavedChangesBar
                disabled={!zoneValid}
                onDiscard={() => setZone(network.magicDnsZone)}
                onSave={saveZone}
                saving={update.isPending}
                show={zoneDirty && isAdmin}
              />
            </form>

            <SettingsRow
              description={t("settings.namesRowHint")}
              label={t("settings.namesRow")}
            >
              <NetworkMagicDnsCard embedded networkId={network.id} />
            </SettingsRow>
          </SettingsCard>
        ) : null}

        {section === "security" ? (
          <NetworkSecuritySettings network={network} />
        ) : null}

        {section === "invites" ? (
          <SettingsCard
            description={t("settings.invitesDescription")}
            title={t("settings.sections.invites")}
          >
            <SettingsRow
              description={t("settings.inviteExistingHidden")}
              label={t("invites.listTitle")}
            >
              <div className="flex flex-col gap-3">
                {data.invites.length === 0 ? (
                  <p className="text-[13px] text-fg-3">
                    {t("settings.invitesEmpty")}
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-lg ring-1 ring-line">
                    {data.invites.map((invite) => (
                      <InviteRow
                        invite={invite}
                        key={invite.id}
                        onRevoke={
                          isAdmin ? () => setRevokeTarget(invite) : undefined
                        }
                      />
                    ))}
                  </div>
                )}
                <div>
                  <Button
                    onClick={data.openAddDevice}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <PlusIcon className="size-4" />
                    {t("settings.inviteCreate")}
                  </Button>
                </div>
              </div>
            </SettingsRow>
          </SettingsCard>
        ) : null}

        {section === "danger" ? (
          isAdmin ? (
            <SettingsCard
              description={t("settings.dangerDescription")}
              title={t("settings.sections.danger")}
              tone="danger"
            >
              <SettingsRow
                description={t("settings.dangerHint", {
                  count: network.deviceCounts.approved,
                })}
                label={t("settings.danger")}
              >
                <Button
                  onClick={() => setDeleteOpen(true)}
                  type="button"
                  variant="destructive"
                >
                  <TrashIcon className="size-4" />
                  {t("settings.deleteNetwork")}
                </Button>
              </SettingsRow>
            </SettingsCard>
          ) : (
            <SettingsCard
              description={t("settings.dangerDescription")}
              title={t("settings.sections.danger")}
            >
              <SettingsRow label={t("settings.danger")}>
                <p className="text-[13px] text-fg-3">{t("common.forbidden")}</p>
              </SettingsRow>
            </SettingsCard>
          )
        ) : null}
      </div>

      <Dialog
        onOpenChange={(open) => {
          setDeleteOpen(open)
          if (!open) setDeleteName("")
        }}
        open={deleteOpen}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t("settings.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("settings.deleteBody", {
                count: network.deviceCounts.approved,
              })}
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">
              {t("settings.deleteTypeLabel")}
            </span>
            <Input
              autoFocus
              onChange={(event) => setDeleteName(event.target.value)}
              placeholder={network.name}
              value={deleteName}
            />
            <span className="text-xs text-fg-3">
              {t("settings.deleteTypeHint", { name: network.name })}
            </span>
          </label>
          <DialogFooter>
            <Button onClick={() => setDeleteOpen(false)} variant="outline">
              {t("common.cancel")}
            </Button>
            <Button
              disabled={remove.isPending || deleteName.trim() !== network.name}
              onClick={() => remove.mutate({ networkId: network.id })}
              variant="destructive"
            >
              <TrashIcon className="size-4" />
              {remove.isPending
                ? t("common.loading")
                : t("settings.deleteNetwork")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => (open ? undefined : setRevokeTarget(null))}
        open={revokeTarget !== null}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t("settings.revokeTitle")}</DialogTitle>
            <DialogDescription>{t("settings.revokeBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setRevokeTarget(null)} variant="outline">
              {t("common.cancel")}
            </Button>
            <Button
              disabled={revokeInvite.isPending}
              onClick={() =>
                revokeTarget &&
                revokeInvite.mutate({ inviteId: revokeTarget.id })
              }
              variant="destructive"
            >
              {revokeInvite.isPending
                ? t("common.loading")
                : t("invites.revoke")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function InviteRow({
  invite,
  onRevoke,
}: {
  invite: ListInvites200Item
  onRevoke?: () => void
}) {
  const { t, i18n } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-3.5 py-2.5 first:border-t-0">
      <span className="grid size-9 flex-none place-items-center rounded-[9px] bg-surface-2 text-fg-2 ring-1 ring-line">
        <LinkIcon aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">
            {invite.label || t("invites.title")}
          </span>
          <Chip
            variant={
              invite.status === "active"
                ? "ok"
                : invite.status === "revoked"
                  ? "err"
                  : "warn"
            }
          >
            {t(`invites.status.${invite.status}`)}
          </Chip>
        </div>
        <p className="mt-0.5 text-xs text-fg-3">
          {invite.maxUses === null
            ? t("settings.inviteUsesUnlimited", { used: invite.uses })
            : t("settings.inviteUses", {
                used: invite.uses,
                max: invite.maxUses,
              })}
          {" · "}
          {invite.expiresAt
            ? t("settings.inviteExpires", {
                when: formatDateTime(invite.expiresAt, i18n.language),
              })
            : t("settings.inviteNoExpiry")}
          {" · "}
          {t("settings.inviteApproval")}
        </p>
      </div>
      {onRevoke && invite.status !== "revoked" ? (
        <Button onClick={onRevoke} size="sm" type="button" variant="ghost">
          <KeyRoundIcon className="size-4" />
          {t("invites.revoke")}
        </Button>
      ) : null}
    </div>
  )
}
