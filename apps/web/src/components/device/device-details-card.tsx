import type { ReactNode } from "react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { PencilIcon, TagIcon } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  getGetDeviceQueryKey,
  getListDevicesQueryKey,
  useListUsers,
  useSetDeviceOwner,
} from "@/api/generated/easyplane"
import type { GetDevice200 } from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { DeviceRenameDialog } from "@/components/device/device-rename-dialog"
import { DeviceTagsDialog } from "@/components/device/device-tags-dialog"
import { CopyInline } from "@/components/shared/copy-inline"
import { Chip } from "@/components/ui/chip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { deviceName, osLabel } from "@/lib/device-presentation"
import { deviceSecondaryHostname, tagLabel } from "@/lib/device-status"
import { formatDate } from "@/lib/format"

/**
 * Identity card: owner, tags, DNS name, addresses, system and IDs. Fields the
 * API cannot provide yet (nothing here today) are shown as "—", never faked.
 */
export function DeviceDetailsCard({
  device,
  publicIp,
}: {
  device: GetDevice200
  publicIp: string | null
}) {
  const { t, i18n } = useTranslation()
  const { isAdmin, canManage } = useAuth()
  const queryClient = useQueryClient()
  const [renameOpen, setRenameOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const users = useListUsers({ query: { enabled: isAdmin } })
  const owner = users.data?.data.find((user) => user.id === device.ownerUserId)

  const setOwner = useSetDeviceOwner({
    mutation: {
      onSuccess: async () => {
        toast.success(t("devices.ownerSaved"))
        await queryClient.invalidateQueries({
          queryKey: getGetDeviceQueryKey(device.id),
        })
        await queryClient.invalidateQueries({
          queryKey: getListDevicesQueryKey(),
        })
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const name = deviceName(device)
  const secondaryHostname = deviceSecondaryHostname(device)

  return (
    <section className="rounded-xl bg-card shadow-sm ring-1 ring-line">
      <div className="px-4 pt-4 pb-1 sm:px-5">
        <h2 className="text-base leading-6 font-semibold tracking-[-0.006em]">
          {t("devices.detail.details")}
        </h2>
      </div>
      <dl className="grid grid-cols-[110px_minmax(0,1fr)] px-4 pb-3 sm:px-5">
        <Field label={t("devices.detail.owner")}>
          {isAdmin ? (
            <Select
              items={[
                { value: "__none", label: t("devices.detail.noOwner") },
                ...(users.data?.data ?? []).map((user) => ({
                  value: user.id,
                  label: user.displayName || user.email,
                })),
              ]}
              onValueChange={(value) =>
                value &&
                setOwner.mutate({
                  deviceId: device.id,
                  data: { userId: value === "__none" ? null : value },
                })
              }
              value={device.ownerUserId ?? "__none"}
            >
              <SelectTrigger
                aria-label={t("devices.detail.owner")}
                className="h-8 max-w-full border-0 bg-transparent px-1 font-normal shadow-none hover:bg-surface-2"
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">
                  {t("devices.detail.noOwner")}
                </SelectItem>
                {(users.data?.data ?? []).map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.displayName || user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="truncate">
              {owner?.displayName || owner?.email || "—"}
            </span>
          )}
        </Field>

        <Field label={t("policy.tags")}>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            {device.tags.length === 0 ? (
              <span className="text-fg-3">—</span>
            ) : (
              device.tags.map((tag) => (
                <Chip key={tag} title={tagLabel(tag)} variant="tag">
                  <TagIcon aria-hidden="true" className="size-3" />
                  {tagLabel(tag)}
                </Chip>
              ))
            )}
            {canManage ? (
              <button
                aria-label={t("devices.menu.tags")}
                className="grid size-7 cursor-pointer place-items-center rounded-md text-fg-3 hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => setTagsOpen(true)}
                type="button"
              >
                <PencilIcon className="size-3.5" />
              </button>
            ) : null}
          </span>
        </Field>

        <Field label={t("magicDns.name")}>
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate font-mono text-xs">
              {device.magicDnsName ??
                `${device.dnsName ?? name}.${device.magicDnsZone}`}
            </span>
            {canManage ? (
              <button
                aria-label={t("devices.menu.rename")}
                className="grid size-7 flex-none cursor-pointer place-items-center rounded-md text-fg-3 hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => setRenameOpen(true)}
                type="button"
              >
                <PencilIcon className="size-3.5" />
              </button>
            ) : null}
          </span>
        </Field>

        <Field label={t("devices.virtualIp")}>
          <span className="font-mono text-xs">{device.virtualIpv4 ?? "—"}</span>
        </Field>

        <Field label={t("devices.detail.publicIp")}>
          <span className="truncate font-mono text-xs">{publicIp || "—"}</span>
        </Field>

        <Field label={t("devices.detail.system")}>
          <span className="truncate" title={osLabel(device.os)}>
            {osLabel(device.os)}
            {device.easytierVersion
              ? ` · EasyTier ${device.easytierVersion}`
              : ""}
          </span>
        </Field>

        {secondaryHostname ? (
          <Field label={t("devices.hostname")}>
            <span className="truncate font-mono text-xs">
              {secondaryHostname}
            </span>
          </Field>
        ) : null}

        <Field mono label={t("devices.machineId")}>
          <CopyInline
            className="-ml-1.5"
            label={t("devices.copyMachineId")}
            value={device.machineId}
          />
        </Field>

        <Field label={t("devices.detail.joined")}>
          <span>
            {formatDate(device.approvedAt ?? device.createdAt, i18n.language)}
          </span>
        </Field>
      </dl>

      <DeviceRenameDialog
        currentName={device.dnsName ?? name}
        deviceId={device.id}
        networkId={device.networkId}
        onOpenChange={setRenameOpen}
        open={renameOpen}
        zone={device.magicDnsZone}
      />
      <DeviceTagsDialog
        currentTags={device.tags}
        deviceId={device.id}
        deviceName={name}
        onOpenChange={setTagsOpen}
        open={tagsOpen}
      />
    </section>
  )
}

function Field({
  label,
  children,
  mono,
}: {
  label: string
  children: ReactNode
  mono?: boolean
}) {
  return (
    <>
      <dt className="flex min-h-10 items-center border-t border-line py-1.5 text-[13px] text-fg-3 first:border-t-0">
        {label}
      </dt>
      <dd
        className={`flex min-h-10 min-w-0 items-center gap-2 border-t border-line py-1.5 first:border-t-0 ${
          mono ? "font-mono text-xs" : "text-sm"
        }`}
      >
        {children}
      </dd>
    </>
  )
}
