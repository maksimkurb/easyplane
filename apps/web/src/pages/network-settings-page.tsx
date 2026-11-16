import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useLocation } from "wouter"
import { EyeIcon, KeyRoundIcon, TrashIcon } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  getGetNetworkQueryKey,
  getListInvitesQueryKey,
  getListNetworksQueryKey,
  useDeleteNetwork,
  useRevealNetworkSecret,
  useRevokeInvite,
  useRotateNetworkSecret,
  useUpdateNetwork,
} from "@/api/generated/easyplane"
import { useAuth } from "@/auth/auth-context"
import { NetworkAccessCard } from "@/components/network-access-card"
import { NetworkMagicDnsCard } from "@/components/network-magic-dns-card"
import { NetworkPeersCard } from "@/components/network-peers-card"
import { NetworkRendezvousCard } from "@/components/network-rendezvous-card"
import { NetworkRoutesCard } from "@/components/network-routes-card"
import { NetworkShell, type NetworkShellData } from "@/components/network/network-shell"
import { CopyButton } from "@/components/copy-button"
import { CopyInline } from "@/components/shared/copy-inline"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { Input } from "@/components/ui/input"
import { formatDateTime } from "@/lib/format"

export function NetworkSettingsPage({ networkId }: { networkId: string }) {
  return (
    <NetworkShell networkId={networkId} tab="settings">
      {(data) => <SettingsTab data={data} />}
    </NetworkShell>
  )
}

function SettingsTab({ data }: { data: NetworkShellData }) {
  const { t, i18n } = useTranslation()
  const { isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const [, navigate] = useLocation()
  const network = data.network
  const [name, setName] = useState(network.name)
  const [secret, setSecret] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const update = useUpdateNetwork({
    mutation: {
      onSuccess: async () => {
        toast.success(t("settings.saved"))
        await queryClient.invalidateQueries({ queryKey: getGetNetworkQueryKey(network.id) })
        await queryClient.invalidateQueries({ queryKey: getListNetworksQueryKey() })
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  const reveal = useRevealNetworkSecret({
    mutation: {
      onSuccess: (response) => setSecret(response.data.secret),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  const rotate = useRotateNetworkSecret({
    mutation: {
      onSuccess: async (response) => {
        setSecret(response.data.secret)
        toast.success(t("access.rotateDone"))
        await queryClient.invalidateQueries({ queryKey: getGetNetworkQueryKey(network.id) })
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  const revokeInvite = useRevokeInvite({
    mutation: {
      onSuccess: async () => {
        toast.success(t("invites.revoked"))
        await queryClient.invalidateQueries({ queryKey: getListInvitesQueryKey(network.id) })
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  const remove = useDeleteNetwork({
    mutation: {
      onSuccess: async () => {
        toast.success(t("settings.deleted"))
        await queryClient.invalidateQueries({ queryKey: getListNetworksQueryKey() })
        navigate("/networks")
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-xl bg-card px-4 shadow-sm ring-1 ring-line sm:px-5">
        <SettingsSection
          description={t("settings.generalHint")}
          title={t("settings.general")}
        >
          <div className="flex max-w-[520px] flex-col gap-4">
            <form
              className="flex flex-col gap-1.5"
              onSubmit={(event) => {
                event.preventDefault()
                update.mutate({ networkId: network.id, data: { name: name.trim() } })
              }}
            >
              <label className="text-[13px] font-medium" htmlFor="settings-name">
                {t("networks.name")}
              </label>
              <div className="flex gap-2">
                <Input
                  disabled={!isAdmin}
                  id="settings-name"
                  onChange={(event) => setName(event.target.value)}
                  required
                  value={name}
                />
                {isAdmin ? (
                  <Button
                    disabled={update.isPending || name.trim() === "" || name === network.name}
                    type="submit"
                    variant="outline"
                  >
                    {t("common.save")}
                  </Button>
                ) : null}
              </div>
            </form>

            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">{t("networks.networkName")}</span>
              <div className="flex h-10 items-center gap-2 rounded-lg bg-surface-2 px-3 ring-1 ring-line">
                <CopyInline
                  label={t("network.copyName", { name: network.networkName })}
                  value={network.networkName}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">{t("networks.table.range")}</span>
              <div className="flex h-10 items-center rounded-lg bg-surface-2 px-3 font-mono text-sm ring-1 ring-line">
                {network.ipv4Cidr}
              </div>
              <p className="text-xs text-fg-3">{t("settings.cidrLocked")}</p>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          description={t("settings.secretHint")}
          title={t("networks.secret")}
        >
          <div className="flex max-w-[520px] flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex h-10 w-full min-w-0 items-center overflow-hidden rounded-lg bg-surface-2 px-3 font-mono text-sm tracking-[0.2em] text-fg-3 ring-1 ring-line sm:w-auto sm:flex-1">
                <span className="truncate">{secret ?? "••••••••••••••••"}</span>
              </code>
              {isAdmin ? (
                <>
                  <Button
                    disabled={reveal.isPending}
                    onClick={() => reveal.mutate({ networkId: network.id })}
                    variant="outline"
                  >
                    <EyeIcon className="size-4" />
                    {t("networks.reveal")}
                  </Button>
                  <Button
                    disabled={rotate.isPending}
                    onClick={() => {
                      if (window.confirm(t("networks.rotateConfirm"))) {
                        rotate.mutate({ networkId: network.id })
                      }
                    }}
                    variant="ghost"
                  >
                    <KeyRoundIcon className="size-4" />
                    {t("settings.rotate")}
                  </Button>
                </>
              ) : null}
            </div>
            {secret ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-warn-soft px-3 py-2 ring-1 ring-warn-line">
                <p className="min-w-0 flex-1 text-xs text-fg-2">
                  {t("networks.revealWarning")}
                </p>
                <CopyButton value={secret} />
              </div>
            ) : null}
            <p className="text-xs text-fg-3">{t("settings.rotateHint")}</p>
          </div>
        </SettingsSection>

      </section>

      <NetworkPeersCard networkId={network.id} />

      <NetworkMagicDnsCard networkId={network.id} />

      <NetworkRoutesCard networkId={network.id} />

      <NetworkAccessCard network={network} />

      <NetworkRendezvousCard network={network} />

      <section className="rounded-xl bg-card px-4 shadow-sm ring-1 ring-line sm:px-5">
        <SettingsSection description={t("settings.invitesHint")} title={t("invites.title")}>
          {data.invites.length === 0 ? (
            <p className="text-[13px] text-fg-3">{t("invites.empty")}</p>
          ) : (
            <div className="overflow-hidden rounded-lg ring-1 ring-line">
              {data.invites.map((invite) => (
                <div
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-3.5 py-2.5 first:border-t-0"
                  key={invite.id}
                >
                  <span className="grid size-9 flex-none place-items-center rounded-[9px] bg-surface-2 text-fg-2 ring-1 ring-line">
                    <KeyRoundIcon className="size-4" />
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
                      {t("settings.inviteUses", {
                        used: invite.uses,
                        max: invite.maxUses ?? "∞",
                      })}
                      {" · "}
                      {invite.expiresAt
                        ? t("settings.inviteExpires", {
                            when: formatDateTime(invite.expiresAt, i18n.language),
                          })
                        : t("addDevice.neverExpires")}
                      {" · "}
                      {t("addDevice.approvalShort")}
                    </p>
                  </div>
                  {invite.status !== "revoked" && isAdmin ? (
                    <Button
                      disabled={revokeInvite.isPending}
                      onClick={() => {
                        if (window.confirm(t("invites.revokeConfirm"))) {
                          revokeInvite.mutate({ inviteId: invite.id })
                        }
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      {t("invites.revoke")}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-fg-3">{t("invites.tokenWarning")}</p>
          <div className="mt-3">
            <Button onClick={data.openAddDevice} size="sm" variant="outline">
              {t("invites.create")}
            </Button>
          </div>
        </SettingsSection>
      </section>

      {isAdmin ? (
        <section className="rounded-xl bg-card px-4 shadow-sm ring-1 ring-line sm:px-5">
          <SettingsSection
            description={t("settings.dangerHint", {
              count: network.deviceCounts.approved,
            })}
            title={t("settings.danger")}
            titleClassName="text-err"
          >
            {confirmDelete ? (
              <div className="flex flex-col gap-3 rounded-xl bg-err-soft px-4 py-3 ring-1 ring-err-line">
                <p className="text-[13px] text-fg-2">
                  {t("settings.deleteConfirm", { name: network.name })}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setConfirmDelete(false)} variant="outline">
                    {t("common.cancel")}
                  </Button>
                  <Button
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ networkId: network.id })}
                    variant="destructive"
                  >
                    <TrashIcon className="size-4" />
                    {t("common.delete")}
                  </Button>
                </div>
              </div>
            ) : (
              <Button onClick={() => setConfirmDelete(true)} variant="destructive">
                <TrashIcon className="size-4" />
                {t("settings.deleteNetwork", { name: network.name })}
              </Button>
            )}
          </SettingsSection>
        </section>
      ) : null}
    </div>
  )
}

function SettingsSection({
  title,
  description,
  children,
  titleClassName,
}: {
  title: string
  description?: string
  children: React.ReactNode
  titleClassName?: string
}) {
  return (
    <div className="grid gap-3 border-t border-line py-6 first:border-t-0 first:pt-5 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] md:gap-6">
      <div className="min-w-0">
        <h2
          className={`text-base leading-6 font-semibold tracking-[-0.006em] ${titleClassName ?? ""}`}
        >
          {title}
        </h2>
        {description ? <p className="mt-1 text-[13px] text-fg-3">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>

    </div>
  )
}
