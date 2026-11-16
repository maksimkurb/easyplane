import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { HistoryIcon, PlusIcon, RotateCcwIcon } from "lucide-react"
import { toast } from "sonner"

import {
  getGetDeviceQueryKey,
  getListDeviceRevisionsQueryKey,
  getListDevicesQueryKey,
  useCreateDeviceRevision,
  useRollbackDeviceRevision,
} from "@/api/generated/easyplane"
import type { GetDevice200, ListDeviceRevisions200Item } from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { formatRelativeTime } from "@/lib/format"

/**
 * Revision history. Each save is a revision; the push status is derived from
 * the device's desired/applied revisions, so the "Running" chip always means
 * "this is what the client reported applying".
 */
export function DeviceHistoryCard({
  device,
  revisions,
}: {
  device: GetDevice200
  revisions: ListDeviceRevisions200Item[]
}) {
  const { t, i18n } = useTranslation()
  const { canManage } = useAuth()
  const queryClient = useQueryClient()
  const [newOpen, setNewOpen] = useState(false)
  const latest = revisions[0]

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: getGetDeviceQueryKey(device.id) })
    await queryClient.invalidateQueries({ queryKey: getListDeviceRevisionsQueryKey(device.id) })
    await queryClient.invalidateQueries({ queryKey: getListDevicesQueryKey() })
  }

  const rollback = useRollbackDeviceRevision({
    mutation: {
      onSuccess: async (_response, variables) => {
        toast.success(t("devices.detail.rolledBack", { revision: variables.revision }))
        await refresh()
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const changeLabel = (revision: ListDeviceRevisions200Item) => {
    if (revision.source === "approval") return t("devices.detail.change.approval")
    if (revision.source === "rollback") {
      return t("devices.detail.change.rollback", {
        revision: revision.rollbackOfRevision ?? "?",
      })
    }
    return revision.note || t("devices.detail.change.manual")
  }

  return (
    <section className="rounded-xl bg-card shadow-sm ring-1 ring-line">
      <div className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-base leading-6 font-semibold tracking-[-0.006em]">
            {t("devices.detail.history")}
          </h2>
          <p className="text-[13px] text-fg-3">{t("devices.detail.historyHint")}</p>
        </div>
        {canManage && device.state === "approved" ? (
          <Button
            className="max-sm:w-full max-sm:justify-center"
            onClick={() => setNewOpen(true)}
            size="sm"
            variant="outline"
          >
            <PlusIcon className="size-4" />
            {t("devices.detail.newRevision")}
          </Button>
        ) : null}
      </div>

      {revisions.length === 0 ? (
        <p className="border-t border-line px-4 py-5 text-[13px] text-fg-3 sm:px-5">
          {t("common.empty")}
        </p>
      ) : (
        <div>
          <div
            aria-hidden="true"
            className="hidden h-10 grid-cols-[56px_minmax(0,1fr)_minmax(120px,160px)_110px_120px] items-center gap-4 border-t border-line px-5 text-xs font-medium text-fg-3 md:grid"
          >
            <span>#</span>
            <span>{t("devices.detail.change.label")}</span>
            <span>{t("devices.detail.createdBy")}</span>
            <span>{t("audit.when")}</span>
            <span />
          </div>
          {revisions.map((revision) => {
            const running = device.appliedRevision === revision.revision
            const notApplied =
              !running &&
              device.desiredRevision === revision.revision &&
              device.desiredRevision !== device.appliedRevision
            return (
              <div
                className="grid min-h-14 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2.5 md:grid-cols-[56px_minmax(0,1fr)_minmax(120px,160px)_110px_120px] md:gap-4 md:px-5"
                key={revision.id}
              >
                <span className="font-medium">{revision.revision}</span>
                <div className="min-w-0">
                  <p className="text-[13px] break-words">{changeLabel(revision)}</p>
                  <p className="text-xs break-words text-fg-3 md:hidden">
                    {revision.createdByEmail ?? t("devices.detail.system")}
                    {" · "}
                    {formatRelativeTime(revision.createdAt, i18n.language)}
                  </p>
                </div>
                <span className="hidden truncate text-[13px] text-fg-2 md:block">
                  {revision.createdByEmail ?? t("devices.detail.system")}
                </span>
                <span className="hidden text-[13px] whitespace-nowrap text-fg-3 md:block">
                  {formatRelativeTime(revision.createdAt, i18n.language)}
                </span>
                <span className="flex justify-end">
                  {running ? (
                    <Chip variant="ok">{t("devices.detail.running")}</Chip>
                  ) : notApplied ? (
                    <Chip variant="warn">{t("devices.detail.notApplied")}</Chip>
                  ) : canManage ? (
                    <Button
                      disabled={rollback.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            t("devices.detail.rollbackConfirm", {
                              revision: revision.revision,
                            })
                          )
                        ) {
                          rollback.mutate({
                            deviceId: device.id,
                            revision: revision.revision,
                          })
                        }
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      <RotateCcwIcon className="size-4" />
                      {t("devices.detail.rollback")}
                    </Button>
                  ) : null}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {latest ? (
        <details className="border-t border-line px-4 py-2.5 text-xs text-fg-3 sm:px-5">
          <summary className="flex cursor-pointer items-center gap-2">
            <HistoryIcon aria-hidden="true" className="size-3.5" />
            {t("devices.detail.config")}
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-surface-2 p-3 text-[11px] whitespace-pre-wrap">
            {JSON.stringify(latest.config, null, 2)}
          </pre>
        </details>
      ) : null}

      <NewRevisionDialog
        deviceId={device.id}
        initial={latest?.config}
        onOpenChange={setNewOpen}
        onSaved={refresh}
        open={newOpen}
      />
    </section>
  )
}

function NewRevisionDialog({
  deviceId,
  initial,
  open,
  onOpenChange,
  onSaved,
}: {
  deviceId: string
  initial?: Record<string, unknown>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [noTun, setNoTun] = useState(initial?.noTun === true)
  const [note, setNote] = useState("")

  const createRevision = useCreateDeviceRevision({
    mutation: {
      onSuccess: async () => {
        toast.success(t("devices.detail.revisionCreated"))
        setNote("")
        onOpenChange(false)
        await onSaved()
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  return (
    <Dialog
      onOpenChange={(next) => {
        if (next) {
          setNoTun(initial?.noTun === true)
          setNote("")
        }
        onOpenChange(next)
      }}
      open={open}
    >
      <DialogContent size="sm">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            createRevision.mutate({
              deviceId,
              data: {
                config: { ...(initial ?? {}), noTun },
                note: note || undefined,
              },
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("devices.detail.newRevision")}</DialogTitle>
            <DialogDescription>{t("devices.detail.editHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">{t("devices.detail.note")}</span>
              <Input onChange={(event) => setNote(event.target.value)} value={note} />
            </label>
            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox
                checked={noTun}
                onCheckedChange={(checked) => setNoTun(checked === true)}
              />
              {t("devices.detail.noTun")}
            </label>
          </div>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
              {t("common.cancel")}
            </Button>
            <Button disabled={createRevision.isPending} type="submit">
              {createRevision.isPending ? t("common.loading") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
