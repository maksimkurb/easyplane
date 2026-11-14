import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useParams } from "wouter"
import { QRCodeSVG } from "qrcode.react"
import {
  ArrowLeftIcon,
  EyeIcon,
  KeyRoundIcon,
  PlusIcon,
  ShieldIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import {
  getGetNetworkQueryKey,
  getListInvitesQueryKey,
  useCreateInvite,
  useGetNetwork,
  useListDevices,
  useListInvites,
  useRevealNetworkSecret,
  useRevokeInvite,
} from "@/api/generated/easyplane"
import type { CreateInvite201 } from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { CopyButton } from "@/components/copy-button"
import { DeviceStatusBadges, InviteStatusBadge } from "@/components/device-status"
import { NetworkMagicDnsCard } from "@/components/network-magic-dns-card"
import { NetworkRoutesCard } from "@/components/network-routes-card"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/shared/field"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { buildEasytierCommand, buildInviteUrl } from "@/lib/invite-command"
import { useQueryClient } from "@tanstack/react-query"

export function NetworkDetailPage() {
  const { t } = useTranslation()
  const { id = "" } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const { isAdmin, canManage, config } = useAuth()
  const [secret, setSecret] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [created, setCreated] = useState<CreateInvite201 | null>(null)
  const [label, setLabel] = useState("")
  const [maxUses, setMaxUses] = useState("")
  const [expiresInHours, setExpiresInHours] = useState("24")
  const [hostname, setHostname] = useState("")

  const networkQuery = useGetNetwork(id)
  const devicesQuery = useListDevices({ networkId: id })
  const invitesQuery = useListInvites(id)
  const revealSecret = useRevealNetworkSecret()
  const revokeInvite = useRevokeInvite({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListInvitesQueryKey(id) })
      },
    },
  })
  const createInvite = useCreateInvite({
    mutation: {
      onSuccess: async (response) => {
        setCreated(response.data)
        setInviteOpen(false)
        setLabel("")
        await queryClient.invalidateQueries({ queryKey: getListInvitesQueryKey(id) })
        await queryClient.invalidateQueries({ queryKey: getGetNetworkQueryKey(id) })
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : t("common.error"))
      },
    },
  })

  const network = networkQuery.data?.data
  const loadedPolicyVersion = network?.policyVersion ?? 0
  const devices = devicesQuery.data?.data ?? []
  const invites = invitesQuery.data?.data ?? []
  const baseUrl = config?.publicConfigServerUrl ?? window.location.origin

  if (networkQuery.isLoading) {
    return <Skeleton className="h-64 w-full" />
  }
  if (!network) {
    return <p className="text-sm text-muted-foreground">{t("common.notFound")}</p>
  }

  return (
    <>
      <PageHeader
        actions={
          <div className="flex flex-wrap gap-2">
            {isAdmin ? (
              <Button
                disabled={revealSecret.isPending}
                onClick={() =>
                  void revealSecret.mutateAsync({ networkId: network.id }).then((response) => {
                    setSecret(response.data.secret)
                  })
                }
                variant="outline"
              >
                <EyeIcon className="size-4" />
                {t("networks.reveal")}
              </Button>
            ) : null}
            {canManage ? (
              <Button onClick={() => setInviteOpen(true)}>
                <PlusIcon className="size-4" />
                {t("invites.create")}
              </Button>
            ) : null}
          </div>
        }
        description={network.networkName}
        title={
          <span className="flex items-center gap-2">
            <Link className="text-muted-foreground hover:text-foreground" href="/networks">
              <ArrowLeftIcon className="size-5" />
            </Link>
            {network.name}
          </span>
        }
      />

      <div className="grid gap-4">
        <SectionCard
          action={
            <Link href={`/networks/${network.id}/policy`}>
              <Button size="sm" variant="outline">
                <ShieldIcon className="size-4" />
                {t("policy.title")}
              </Button>
            </Link>
          }
          description={t("policy.cardHint")}
          title={
            loadedPolicyVersion > 0
              ? t("policy.activeVersion", { version: loadedPolicyVersion })
              : t("policy.noPolicy")
          }
        >
          <p className="text-sm text-muted-foreground">
            {loadedPolicyVersion > 0 ? t("policy.cardActive") : t("policy.cardInactive")}
          </p>
        </SectionCard>

        <SectionCard title={t("networks.networkName")}>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t("networks.networkName")}</dt>
              <dd className="flex items-center gap-2">
                <code className="truncate rounded bg-muted px-1.5 py-0.5 text-xs">
                  {network.networkName}
                </code>
                <CopyButton value={network.networkName} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("networks.cidr")}</dt>
              <dd className="font-mono text-xs">{network.ipv4Cidr}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">{t("networks.secret")}</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <code className="truncate rounded bg-muted px-1.5 py-0.5 text-xs">
                  {secret ?? t("networks.secretHidden")}
                </code>
                {secret ? <CopyButton value={secret} /> : null}
              </dd>
              {secret ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("networks.revealWarning")}
                </p>
              ) : null}
            </div>
          </dl>
        </SectionCard>

        <SectionCard
          description={t("devices.description")}
          title={`${t("networks.devices")} (${devices.length})`}
        >
          {devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("devices.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("devices.hostname")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                    <TableHead>{t("devices.virtualIp")}</TableHead>
                    <TableHead>{t("devices.desiredRevision")}</TableHead>
                    <TableHead>{t("devices.appliedRevision")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {devices.map((device) => (
                    <TableRow key={device.id}>
                      <TableCell>
                        <Link
                          className="font-medium hover:underline"
                          href={`/devices/${device.id}`}
                        >
                          {device.hostname || device.machineId.slice(0, 8)}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {device.easytierVersion || t("common.none")}
                        </div>
                      </TableCell>
                      <TableCell>
                        <DeviceStatusBadges
                          online={device.online}
                          state={device.state}
                          sync={device.sync}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {device.virtualIpv4 ?? t("common.none")}
                      </TableCell>
                      <TableCell>{device.desiredRevision ?? t("common.none")}</TableCell>
                      <TableCell>{device.appliedRevision ?? t("common.none")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>

        <NetworkMagicDnsCard networkId={network.id} />

        <NetworkRoutesCard networkId={network.id} />

        <SectionCard
          description={t("invites.description")}
          title={`${t("invites.title")} (${invites.length})`}
        >
          {invites.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("invites.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("invites.label")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                    <TableHead>{t("invites.uses")}</TableHead>
                    <TableHead>{t("invites.expires")}</TableHead>
                    <TableHead className="text-right">{t("common.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invites.map((invite) => (
                    <TableRow key={invite.id}>
                      <TableCell>{invite.label || t("common.none")}</TableCell>
                      <TableCell>
                        <InviteStatusBadge status={invite.status} />
                      </TableCell>
                      <TableCell>
                        {invite.uses}
                        {invite.maxUses === null ? " / ∞" : ` / ${invite.maxUses}`}
                      </TableCell>
                      <TableCell className="text-xs">
                        {invite.expiresAt
                          ? new Date(invite.expiresAt).toLocaleString()
                          : t("common.none")}
                      </TableCell>
                      <TableCell className="text-right">
                        {canManage && invite.status !== "revoked" ? (
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
                            <Trash2Icon className="size-4" />
                            {t("invites.revoke")}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>
      </div>

      <Dialog onOpenChange={setInviteOpen} open={inviteOpen}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              createInvite.mutate({
                networkId: network.id,
                data: {
                  label: label || undefined,
                  maxUses: maxUses === "" ? null : Number(maxUses),
                  expiresInHours:
                    expiresInHours === "" ? null : Number(expiresInHours),
                },
              })
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("invites.createTitle")}</DialogTitle>
              <DialogDescription>{t("invites.description")}</DialogDescription>
            </DialogHeader>
            <FieldGroup className="gap-4 py-4">
              <Field className="gap-2">
                <FieldLabel htmlFor="invite-label">{t("invites.label")}</FieldLabel>
                <Input
                  id="invite-label"
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="laptop"
                  value={label}
                />
              </Field>
              <Field className="gap-2">
                <FieldLabel htmlFor="invite-max-uses">{t("invites.maxUses")}</FieldLabel>
                <Input
                  id="invite-max-uses"
                  min={1}
                  onChange={(event) => setMaxUses(event.target.value)}
                  placeholder="∞"
                  type="number"
                  value={maxUses}
                />
                <FieldDescription>{t("invites.maxUsesHint")}</FieldDescription>
              </Field>
              <Field className="gap-2">
                <FieldLabel htmlFor="invite-expiry">
                  {t("invites.expiresInHours")}
                </FieldLabel>
                <Input
                  id="invite-expiry"
                  min={1}
                  onChange={(event) => setExpiresInHours(event.target.value)}
                  type="number"
                  value={expiresInHours}
                />
                <FieldDescription>{t("invites.expiresInHoursHint")}</FieldDescription>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button onClick={() => setInviteOpen(false)} type="button" variant="outline">
                {t("common.cancel")}
              </Button>
              <Button disabled={createInvite.isPending} type="submit">
                {createInvite.isPending ? t("common.loading") : t("common.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <InviteCreatedDialog
        created={created}
        hostname={hostname}
        onClose={() => setCreated(null)}
        onHostnameChange={setHostname}
        baseUrl={baseUrl}
      />
    </>
  )
}

function InviteCreatedDialog({
  created,
  baseUrl,
  hostname,
  onHostnameChange,
  onClose,
}: {
  created: CreateInvite201 | null
  baseUrl: string
  hostname: string
  onHostnameChange: (value: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  if (!created) return null
  const url = buildInviteUrl(baseUrl, created.token)
  const command = buildEasytierCommand({
    base: baseUrl,
    token: created.token,
    hostname,
  })

  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onClose())} open>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-5" />
            {t("invites.created")}
          </DialogTitle>
          <DialogDescription>{created.invite.label || t("invites.title")}</DialogDescription>
        </DialogHeader>

        <Alert>
          <AlertDescription>{t("invites.tokenWarning")}</AlertDescription>
        </Alert>

        <div className="grid gap-5 py-2 sm:grid-cols-[auto_minmax(0,1fr)]">
          <div className="mx-auto rounded-lg bg-white p-3 shadow-sm">
            <QRCodeSVG size={180} value={url} />
          </div>
          <div className="min-w-0 space-y-4">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {t("invites.url")}
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">
                  {url}
                </code>
                <CopyButton value={url} />
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {t("invites.command")}
              </p>
              <div className="flex items-start gap-2">
                <pre className="min-w-0 flex-1 overflow-x-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
                  {command}
                </pre>
                <CopyButton value={command} />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  aria-label={t("devices.hostname")}
                  className="h-8 max-w-48"
                  onChange={(event) => onHostnameChange(event.target.value)}
                  placeholder="my-device"
                  value={hostname}
                />
                <span className="text-xs text-muted-foreground">
                  {t("devices.hostname")}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("invites.android")}</p>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>{t("common.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
