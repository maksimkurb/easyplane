import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  MoreHorizontalIcon,
  PencilIcon,
  QrCodeIcon,
  TagIcon,
  TrashIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  useDeleteWireguardClient,
  useListTags,
  useRenameWireguardClient,
  useSetWireguardClientTags,
} from "@/api/generated/easyplane"
import type { ListWireguardClients200Item } from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { WireguardConfigDialog } from "@/components/device/wireguard-config-dialog"
import {
  WireguardBadge,
  WireguardIcon,
} from "@/components/device/wireguard-badge"
import { ConfirmDialog } from "@/components/device/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Chip, Dot } from "@/components/ui/chip"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,

  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import type { useWireguardConfigDialogState as useWireguardConfigDialogStateType } from "@/hooks/use-wireguard"
import { tagLabel } from "@/lib/device-status"

export function WireguardStatus({
  client,
  className,
}: {
  client: ListWireguardClients200Item
  className?: string
}) {
  const { t } = useTranslation()
  const label = t(`wireguard.status.${client.state}`)
  const online = client.state === "online"
  return (
    <span className={className}>
      <span className="flex items-center gap-1.5">
        <Dot online={online} />
        <span className="text-[13px]">{label}</span>
      </span>
      {client.state === "online" && client.endpoint ? (
        <span className="block max-w-full truncate font-mono text-xs text-fg-3">
          {t("wireguard.lastEndpoint", { endpoint: client.endpoint })}
        </span>
      ) : client.state === "error" && client.error ? (
        <span className="block max-w-full truncate text-xs text-err">
          {client.error}
        </span>
      ) : null}
    </span>
  )
}

/** Rename dialog shared by the network list and the hub card. */
function RenameDialog({
  client,
  open,
  onOpenChange,
  onDone,
}: {
  client: ListWireguardClients200Item
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(client.name)
  const rename = useRenameWireguardClient({
    mutation: {
      onSuccess: async () => {
        toast.success(t("wireguard.saved"))
        await onDone()
        onOpenChange(false)
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  return (
    <Dialog
      onOpenChange={(next) => {
        if (next) setName(client.name)
        onOpenChange(next)
      }}
      open={open}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t("wireguard.renameTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5 py-1">
          <Label htmlFor={`wg-name-${client.id}`}>{t("wireguard.name")}</Label>
          <Input
            aria-describedby={`wg-name-hint-${client.id}`}
            className="h-11 sm:h-10"
            id={`wg-name-${client.id}`}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
          <p
            className="text-xs text-pretty text-fg-3"
            id={`wg-name-hint-${client.id}`}
          >
            {t("wireguard.nameHint")}
          </p>
          <p className="text-xs text-pretty text-fg-3">
            {t("wireguard.renameHint")}
          </p>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            {t("common.cancel")}
          </Button>
          <Button
            disabled={rename.isPending || name.trim() === ""}
            onClick={() =>
              rename.mutate({ clientId: client.id, data: { name: name.trim() } })
            }
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Tag picker for a WireGuard client (same tags as devices, same policy). */
function TagsDialog({
  client,
  open,
  onOpenChange,
  onDone,
}: {
  client: ListWireguardClients200Item
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string[]>(client.tags)
  const tags = useListTags({ query: { enabled: open } })
  const save = useSetWireguardClientTags({
    mutation: {
      onSuccess: async () => {
        toast.success(t("wireguard.saved"))
        await onDone()
        onOpenChange(false)
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  return (
    <Dialog
      onOpenChange={(next) => {
        if (next) setSelected(client.tags)
        onOpenChange(next)
      }}
      open={open}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>
            {t("wireguard.tagsTitle", { name: client.name })}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-2.5 py-2">
          {(tags.data?.data ?? []).length === 0 ? (
            <p className="text-sm text-fg-3">{t("wireguard.noTags")}</p>
          ) : (
            (tags.data?.data ?? []).map((tag) => (
              <label
                className="flex min-h-11 items-center gap-2.5 text-sm sm:min-h-8"
                key={tag.id}
              >
                <Checkbox
                  checked={selected.includes(tag.name)}
                  onCheckedChange={(checked) =>
                    setSelected((current) =>
                      checked === true
                        ? [...current, tag.name]
                        : current.filter((entry) => entry !== tag.name)
                    )
                  }
                />
                <span className="flex items-center gap-1.5 font-mono text-xs">
                  <TagIcon aria-hidden="true" className="size-3 text-fg-3" />
                  {tagLabel(tag.name)}
                </span>
                <span className="ml-auto text-xs text-fg-3">
                  {tag.deviceCount}
                </span>
              </label>
            ))
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            {t("common.cancel")}
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate({ clientId: client.id, data: { tags: selected } })
            }
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** One client row: name, kind badge, address, tags, live status and actions. */
export function WireguardClientRow({
  client,
  onShowConfig,
  onChanged,
  compact = false,
}: {
  client: ListWireguardClients200Item
  onShowConfig: (client: ListWireguardClients200Item) => void
  onChanged: () => Promise<void>
  /** Hub card variant: no hub name, tighter layout. */
  compact?: boolean
}) {
  const { t } = useTranslation()
  const { canManage, isAdmin } = useAuth()
  const [renameOpen, setRenameOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const remove = useDeleteWireguardClient({
    mutation: {
      onSuccess: async () => {
        toast.success(t("wireguard.deleted"))
        await onChanged()
        setDeleteOpen(false)
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  return (
    <div className="relative grid min-h-16 grid-cols-[minmax(0,1fr)_auto_44px] items-center gap-x-2 gap-y-2 px-4 py-2.5 transition-colors hover:bg-surface-2/70 md:gap-x-4 md:px-5">
      <div className="flex min-w-0 items-center gap-3.5">
        <span className="grid size-9 flex-none place-items-center rounded-[9px] bg-surface-2 text-fg-2 ring-1 ring-line">
          <WireguardIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate font-semibold">{client.name}</span>
            <WireguardBadge />
            {client.tags.length > 0 ? (
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {client.tags.map((tag) => (
                  <Chip
                    className="text-xs"
                    key={tag}
                    title={tagLabel(tag)}
                    variant="tag"
                  >
                    <TagIcon aria-hidden="true" className="size-3" />
                    {tagLabel(tag)}
                  </Chip>
                ))}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-3">
            <span className="font-mono">{client.virtualIpv4}</span>
            {compact || !client.hubHostname ? null : (
              <span className="max-w-full truncate">
                {t("wireguard.hubLabel", { hub: client.hubHostname })}
              </span>
            )}
            {client.state === "unknown" ? (
              <span className="max-w-full truncate">
                {t("wireguard.statusNever")}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <WireguardStatus
        client={client}
        className="w-[104px] min-w-0 justify-self-end text-right sm:w-auto sm:max-w-[180px] lg:justify-self-start lg:text-left"
      />

      <div className="relative z-10 flex justify-end">
        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  aria-label={t("wireguard.actions.menu", {
                    name: client.name,
                  })}
                  className="grid size-11 cursor-pointer place-items-center rounded-lg text-fg-2 hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none lg:size-9"
                  type="button"
                />
              }
            >
              <MoreHorizontalIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {isAdmin ? (
                <DropdownMenuItem onClick={() => onShowConfig(client)}>
                  <QrCodeIcon />
                  {t("wireguard.actions.config")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                <PencilIcon />
                {t("wireguard.actions.rename")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTagsOpen(true)}>
                <TagIcon />
                {t("wireguard.actions.tags")}
              </DropdownMenuItem>
              <DropdownMenuItem
                destructive
                disabled={remove.isPending}
                onClick={() => setDeleteOpen(true)}
              >
                <TrashIcon />
                {t("wireguard.actions.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : isAdmin ? (
          <button
            aria-label={t("wireguard.actions.config")}
            className="grid size-11 cursor-pointer place-items-center rounded-lg text-fg-2 hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none lg:size-9"
            onClick={() => onShowConfig(client)}
            type="button"
          >
            <QrCodeIcon className="size-4" />
          </button>
        ) : null}
      </div>

      <RenameDialog
        client={client}
        onDone={onChanged}
        onOpenChange={setRenameOpen}
        open={renameOpen}
      />
      <TagsDialog
        client={client}
        onDone={onChanged}
        onOpenChange={setTagsOpen}
        open={tagsOpen}
      />
      <ConfirmDialog
        confirmLabel={t("common.remove")}
        description={t("wireguard.deleteConfirm")}
        destructive
        onConfirm={() => remove.mutate({ clientId: client.id })}
        onOpenChange={setDeleteOpen}
        open={deleteOpen}
        pending={remove.isPending}
        title={t("wireguard.deleteTitle")}
      />
    </div>
  )
}

export function WireguardConfigDialogHost({
  state,
}: {
  state: ReturnType<typeof useWireguardConfigDialogStateType>
}) {
  return (
    <WireguardConfigDialog
      client={state.target}
      config={state.config}
      error={state.error}
      loading={state.loading}
      onOpenChange={state.onOpenChange}
      onRetry={state.retry}
      open={state.open}
    />
  )
}

export function WireguardClientListSkeleton() {
  return (
    <div className="space-y-2 p-4">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  )
}
