import { useEffect, useState, type ComponentProps } from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  CopyIcon,
  Trash2Icon,
} from "lucide-react"

import type { AccessRule, AccessSubjects } from "@/lib/access-policy"
import { ruleIsSavable } from "@/lib/access-policy"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { PortsFields } from "@/components/access/ports-fields"
import { RuleFields, type RuleFieldErrors } from "@/components/access/rule-editor"
import { SubjectPickerList } from "@/components/access/subject-picker"

type SheetView = "edit" | "ports" | "from" | "to"

function RuleSheetContent({
  rule,
  index,
  subjects,
  networkId,
  canEdit,
  busy,
  errors,
  canMoveUp,
  canMoveDown,
  onClose,
  onSave,
  onMove,
  onDuplicate,
  onDelete,
}: {
  rule: AccessRule
  index: number
  subjects: AccessSubjects
  networkId: string
  canEdit: boolean
  busy: boolean
  errors?: RuleFieldErrors
  canMoveUp: boolean
  canMoveDown: boolean
  onClose: () => void
  onSave: (rule: AccessRule) => void
  onMove: (direction: -1 | 1) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(rule)
  const [view, setView] = useState<SheetView>("edit")
  const [submitted, setSubmitted] = useState(false)
  const full = view === "ports"

  const update = (patch: Partial<AccessRule>) =>
    setDraft((current) => ({ ...current, ...patch }))

  useEffect(() => {
    if (!submitted || busy) return
    const hasErrors = Boolean(errors && Object.keys(errors).length > 0)
    if (!hasErrors) onClose()
  }, [busy, errors, onClose, submitted])

  const title =
    view === "ports"
      ? t("accessA.ports.label")
      : view === "from"
        ? t("accessA.rules.from")
        : view === "to"
          ? t("accessA.rules.to")
          : t("accessA.rules.editTitle", { rule: index + 1 })

  return (
    <SheetContent
      className={
        full
          ? "max-h-none gap-0 p-0 data-[side=bottom]:rounded-t-2xl"
          : "max-h-[calc(100dvh-48px)] gap-0 p-0 data-[side=bottom]:rounded-t-2xl"
      }
      data-testid="rule-sheet"
      showCloseButton={false}
      side="bottom"
      style={full ? { height: "calc(100dvh - 28px)" } : undefined}
    >
      <div className="mx-auto mt-2 h-1.5 w-10 flex-none rounded-full bg-line-2" />
      <div className="flex min-h-[52px] flex-none items-center gap-1 px-2 py-1">
        {view === "edit" ? null : (
          <Button
            aria-label={t("nav.back")}
            onClick={() => setView("edit")}
            size="icon-lg"
            type="button"
            variant="ghost"
          >
            <ChevronLeftIcon className="size-5" />
          </Button>
        )}
        {view === "edit" && canEdit ? (
          <>
            <span aria-hidden="true" className="w-2" />
            <SheetHeader className="min-w-0 flex-1 gap-0 p-0">
              <SheetTitle className="truncate text-base leading-[22px]">{title}</SheetTitle>
            </SheetHeader>
            <Button
              aria-label={t("accessA.rules.moveUp")}
              className="size-10"
              disabled={busy || !canMoveUp}
              onClick={() => {
                onMove(-1)
                onClose()
              }}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ArrowUpIcon className="size-5" />
            </Button>
            <Button
              aria-label={t("accessA.rules.moveDown")}
              className="size-10"
              disabled={busy || !canMoveDown}
              onClick={() => {
                onMove(1)
                onClose()
              }}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ArrowDownIcon className="size-5" />
            </Button>
            <Button
              aria-label={t("accessA.rules.duplicate")}
              className="size-10"
              disabled={busy}
              onClick={() => {
                onDuplicate()
                onClose()
              }}
              size="icon"
              type="button"
              variant="ghost"
            >
              <CopyIcon className="size-5" />
            </Button>
            <Button
              aria-label={t("accessA.rules.delete")}
              className="size-10 text-err"
              disabled={busy}
              onClick={() => {
                onDelete()
                onClose()
              }}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Trash2Icon className="size-5" />
            </Button>
          </>
        ) : (
          <SheetHeader className="min-w-0 flex-1 gap-0 p-0">
            <SheetTitle className="truncate text-base leading-[22px]">{title}</SheetTitle>
          </SheetHeader>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 pt-1 pb-3">
        {view === "edit" ? (
          <RuleFields
            disabled={!canEdit || busy}
            errors={errors}
            index={index}
            networkId={networkId}
            onChange={update}
            onOpenPicker={(side) => setView(side)}
            onOpenPorts={() => setView("ports")}
            presentation="sheet"
            rule={draft}
            subjects={subjects}
          />
        ) : null}
        {view === "ports" ? (
          <PortsFields
            disabled={!canEdit || busy}
            errors={{
              ...(errors?.ports ? { ports: errors.ports } : {}),
              ...(errors?.sourcePorts ? { sourcePorts: errors.sourcePorts } : {}),
              ...(errors?.protocol ? { protocol: errors.protocol } : {}),
            }}
            onChange={update}
            rule={draft}
            testIdPrefix="sheet"
          />
        ) : null}
        {view === "from" || view === "to" ? (
          <SubjectPickerList
            fieldLabel={view === "from" ? t("accessA.rules.from") : t("accessA.rules.to")}
            onChange={(values) => {
              update(view === "from" ? { from: values } : { to: values })
              setView("edit")
            }}
            side={view}
            subjects={subjects}
            values={view === "from" ? draft.from : draft.to}
          />
        ) : null}
      </div>

      {view === "edit" ? (
        <SheetFooter className={`m-0 grid flex-none gap-2 border-t border-line bg-card p-4 ${canEdit ? "grid-cols-[1fr_1.4fr]" : "grid-cols-1"}`}>
          <Button onClick={onClose} type="button" variant="outline">
            {t("common.cancel")}
          </Button>
          {canEdit ? (
            <Button
              disabled={busy || !ruleIsSavable(draft)}
              onClick={() => {
                setSubmitted(true)
                onSave(draft)
              }}
              type="button"
            >
              {t("accessA.rules.saveRule")}
            </Button>
          ) : (
            <Button onClick={onClose} type="button">
              {t("common.close")}
            </Button>
          )}
        </SheetFooter>
      ) : null}
      {view === "ports" ? (
        <SheetFooter className="m-0 flex-none border-t border-line bg-card p-4">
          <Button onClick={() => setView("edit")} type="button">
            {t("common.done")}
          </Button>
        </SheetFooter>
      ) : null}
    </SheetContent>
  )
}

export function RuleSheet({
  open,
  onOpenChange,
  ...props
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
} & Omit<ComponentProps<typeof RuleSheetContent>, "onClose">) {
  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      {open ? (
        <RuleSheetContent key={`${props.index}`} {...props} onClose={() => onOpenChange(false)} />
      ) : null}
    </Sheet>
  )
}
