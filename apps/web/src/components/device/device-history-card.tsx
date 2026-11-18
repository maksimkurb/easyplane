import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import {
  ChevronDownIcon,
  ChevronUpIcon,
  HistoryIcon,
  PlusIcon,
  RotateCcwIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  getGetDeviceQueryKey,
  getListDeviceRevisionsQueryKey,
  getListDevicesQueryKey,
  useCreateDeviceRevision,
  useRollbackDeviceRevision,
} from "@/api/generated/easyplane"
import type {
  GetDevice200,
  ListDeviceRevisions200Item,
} from "@/api/generated/model"
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
import { formatDateTime, formatRelativeTime } from "@/lib/format"

const INITIAL_REVISIONS = 5

/**
 * Revision history. Each saved config is a revision; the chip only marks the
 * two that matter operationally (the one the device runs and the one queued for
 * the next push). Older rows are a quiet log a beginner can ignore.
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
  const [expanded, setExpanded] = useState(false)
  const latest = revisions[0]
  const shown = expanded ? revisions : revisions.slice(0, INITIAL_REVISIONS)

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: getGetDeviceQueryKey(device.id),
    })
    await queryClient.invalidateQueries({
      queryKey: getListDeviceRevisionsQueryKey(device.id),
    })
    await queryClient.invalidateQueries({ queryKey: getListDevicesQueryKey() })
  }

  const rollback = useRollbackDeviceRevision({
    mutation: {
      onSuccess: async (_response, variables) => {
        toast.success(
          t("devices.detail.rolledBack", { revision: variables.revision })
        )
        await refresh()
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const changeLabel = (revision: ListDeviceRevisions200Item) => {
    if (revision.source === "approval")
      return t("device.history.change.approval")
    if (revision.source === "rollback") {
      return t("device.history.change.rollback", {
        revision: revision.rollbackOfRevision ?? "?",
      })
    }
    const note = revision.note?.trim()
    if (!note) return t("device.history.change.manual")
    // The policy compiler used to write raw "policy vN" notes; describe them.
    const policy = /^policy\b(?:\s*v?(\d+))?/i.exec(note)
    if (policy) {
      return policy[1]
        ? t("device.history.change.policy", { version: policy[1] })
        : t("device.history.change.policyShort")
    }
    return note
  }

  return (
    <section className="rounded-xl bg-card shadow-sm ring-1 ring-line">
      <div className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-base leading-6 font-semibold tracking-[-0.006em]">
            {t("devices.detail.history")}
          </h2>
          <p className="text-[13px] text-fg-3">{t("device.history.hint")}</p>
        </div>
        {canManage && device.state === "approved" ? (
          <Button
            className="max-sm:w-full max-sm:justify-center"
            onClick={() => setNewOpen(true)}
            size="sm"
            title={t("device.history.newHint")}
            variant="outline"
          >
            <PlusIcon className="size-4" />
            {t("device.history.new")}
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
            <span>{t("device.history.revision")}</span>
            <span>{t("device.history.changeLabel")}</span>
            <span>{t("devices.detail.createdBy")}</span>
            <span>{t("audit.when")}</span>
            <span />
          </div>
          {shown.map((revision) => {
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
                  <p className="text-[13px] break-words">
                    {changeLabel(revision)}
                  </p>
                  <p
                    className="text-xs break-words text-fg-3 md:hidden"
                    title={formatDateTime(revision.createdAt, i18n.language)}
                  >
                    {revision.createdByEmail ?? t("devices.detail.system")}
                    {" · "}
                    {formatRelativeTime(revision.createdAt, i18n.language)}
                  </p>
                </div>
                <span className="hidden truncate text-[13px] text-fg-2 md:block">
                  {revision.createdByEmail ?? t("devices.detail.system")}
                </span>
                <span
                  className="hidden text-[13px] whitespace-nowrap text-fg-3 md:block"
                  title={formatDateTime(revision.createdAt, i18n.language)}
                >
                  {formatRelativeTime(revision.createdAt, i18n.language)}
                </span>
                <span className="flex justify-end">
                  {running ? (
                    <Chip variant="ok">{t("devices.detail.running")}</Chip>
                  ) : notApplied ? (
                    <Chip variant="warn">{t("devices.detail.notApplied")}</Chip>
                  ) : canManage ? (
                    <Button
                      className="text-fg-3 hover:text-foreground"
                      disabled={rollback.isPending}
                      onClick={() =>
                        rollback.mutate({
                          deviceId: device.id,
                          revision: revision.revision,
                        })
                      }
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

          {revisions.length > INITIAL_REVISIONS ? (
            <div className="border-t border-line px-4 py-2 sm:px-5">
              <Button
                onClick={() => setExpanded((value) => !value)}
                size="sm"
                variant="ghost"
              >
                {expanded ? (
                  <ChevronUpIcon className="size-4" />
                ) : (
                  <ChevronDownIcon className="size-4" />
                )}
                {expanded
                  ? t("device.history.showFewer")
                  : t("device.history.showAll", { count: revisions.length })}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {latest ? (
        <details className="border-t border-line px-4 py-2.5 text-xs text-fg-3 sm:px-5">
          <summary className="flex cursor-pointer items-center gap-2">
            <HistoryIcon aria-hidden="true" className="size-3.5" />
            {t("device.history.technical")}
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
            <DialogTitle>{t("device.history.new")}</DialogTitle>
            <DialogDescription>{t("device.history.newHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">
                {t("devices.detail.note")}
              </span>
              <Input
                onChange={(event) => setNote(event.target.value)}
                placeholder={t("device.history.notePlaceholder")}
                value={note}
              />
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
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button disabled={createRevision.isPending} type="submit">
              {createRevision.isPending
                ? t("common.loading")
                : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
