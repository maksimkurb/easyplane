import { useState, type ComponentProps } from "react"
import { useTranslation } from "react-i18next"

import type { AccessRule, AccessSubjects } from "@/lib/access-policy"
import { ruleIsSavable } from "@/lib/access-policy"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { RuleForm, type RuleFieldErrors } from "@/components/access/rule-editor"
import { localRuleErrors } from "@/components/access/access-rule-summary"
import { useIsMobile } from "@/hooks/use-mobile"

function sameRule(left: AccessRule, right: AccessRule): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Rule editor sheet: right-hand panel on desktop, full-screen sheet on phone. */
export function RuleSheet({
  open,
  onOpenChange,
  rule,
  index,
  subjects,
  networkId,
  canEdit,
  busy,
  errors,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rule: AccessRule
  index: number | null
  subjects: AccessSubjects
  networkId: string
  canEdit: boolean
  busy: boolean
  errors?: RuleFieldErrors
  onSave: (rule: AccessRule) => void
}) {
  const { t } = useTranslation()
  const isPhone = useIsMobile(640)
  const [draft, setDraft] = useState(rule)
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  const [discardOpen, setDiscardOpen] = useState(false)

  const dirty = index === null || !sameRule(draft, rule)
  const local = localRuleErrors(draft, t)
  const serverErrors = Object.fromEntries(
    Object.entries(errors ?? {}).filter(([key]) => !touched.has(key))
  ) as RuleFieldErrors
  const merged: RuleFieldErrors = { ...serverErrors, ...local }
  const valid = ruleIsSavable(draft) && Object.keys(merged).length === 0

  const update = (patch: Partial<AccessRule>) => {
    setTouched((current) => {
      const next = new Set(current)
      for (const key of Object.keys(patch)) next.add(key)
      return next
    })
    setDraft((current) => ({ ...current, ...patch }))
  }

  const requestClose = () => {
    if (canEdit && dirty) {
      setDiscardOpen(true)
      return
    }
    onOpenChange(false)
  }

  return (
    <>
      <Sheet
        onOpenChange={(next) => {
          if (!next) requestClose()
        }}
        open={open}
      >
        {open ? (
          <SheetContent
            className={
              isPhone
                ? "inset-y-0 h-auto max-h-none w-full gap-0 rounded-none p-0"
                : "w-full gap-0 p-0 sm:max-w-[560px]"
            }
            data-testid="rule-sheet"
            showCloseButton={false}
            side={isPhone ? "bottom" : "right"}
          >
            <SheetHeader className="flex-none border-b border-line px-4 py-3">
              <SheetTitle className="text-base leading-[22px]">
                {index === null
                  ? t("accessA.rules.newTitle")
                  : t("accessA.rules.editTitle", { rule: index + 1 })}
              </SheetTitle>
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
              <RuleForm
                disabled={!canEdit || busy}
                errors={merged}
                index={index ?? -1}
                networkId={networkId}
                onChange={update}
                rule={draft}
                showErrors
                subjects={subjects}
              />
            </div>

            <SheetFooter className="m-0 grid flex-none grid-cols-2 gap-2 border-t border-line bg-card p-4">
              <Button
                disabled={busy}
                onClick={requestClose}
                type="button"
                variant="outline"
              >
                {t("common.cancel")}
              </Button>
              {canEdit ? (
                <Button
                  disabled={busy || !valid || !dirty}
                  onClick={() => onSave(draft)}
                  type="button"
                >
                  {t("accessA.rules.saveRule")}
                </Button>
              ) : (
                <Button onClick={() => onOpenChange(false)} type="button">
                  {t("common.close")}
                </Button>
              )}
            </SheetFooter>
          </SheetContent>
        ) : null}
      </Sheet>

      <Dialog onOpenChange={setDiscardOpen} open={discardOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t("accessA.rules.discardTitle")}</DialogTitle>
            <DialogDescription>
              {t("accessA.rules.discardBody")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              autoFocus
              onClick={() => setDiscardOpen(false)}
              type="button"
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                setDiscardOpen(false)
                onOpenChange(false)
              }}
              type="button"
              variant="destructive"
            >
              {t("accessA.rules.discard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export type RuleSheetProps = ComponentProps<typeof RuleSheet>
