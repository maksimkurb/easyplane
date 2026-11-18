import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"

import type {
  AccessChain,
  AccessChainName,
  AccessRule,
  AccessSubjects,
} from "@/lib/access-policy"
import { defaultAccessRule } from "@/lib/access-policy"
import { Button } from "@/components/ui/button"
import {
  DefaultActionsPanel,
  DefaultActionsRow,
} from "@/components/access/default-actions"
import type { RuleFieldErrors } from "@/components/access/rule-editor"
import { RuleRow } from "@/components/access/rule-row"
import { RuleSheet } from "@/components/access/rule-sheet"
import { AccessMatrix } from "@/components/access/access-matrix"

export type RuleErrors = Record<number, RuleFieldErrors>

type Editing = { index: number | null; rule: AccessRule }

export function AccessRules({
  rules,
  subjects,
  networkId,
  chains,
  canEdit,
  busy,
  errors,
  generalError,
  highlightIndex,
  enforced = true,
  onChangeRule,
  onSaveRule,
  onDeleteRule,
  onUndoDelete,
  onMoveRule,
  onReorderRule,
  onDuplicateRule,
  onCreateRule,
  onChangeChain,
}: {
  rules: AccessRule[]
  subjects: AccessSubjects
  networkId: string
  chains: Record<AccessChainName, AccessChain>
  canEdit: boolean
  busy: boolean
  errors: RuleErrors
  generalError?: string
  highlightIndex?: number | null
  enforced?: boolean
  onChangeRule: (index: number, patch: Partial<AccessRule>) => void
  onSaveRule: (index: number, rule: AccessRule) => void
  onDeleteRule: (index: number) => void
  onUndoDelete: (index: number, rule: AccessRule) => void
  onMoveRule: (index: number, direction: -1 | 1) => void
  onReorderRule: (from: number, to: number) => void
  onDuplicateRule: (index: number) => void
  onCreateRule: (rule: AccessRule) => void
  onChangeChain: (name: AccessChainName, patch: Partial<AccessChain>) => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  const dragIndex = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (highlightIndex === null || highlightIndex === undefined) return
    const row = listRef.current?.querySelector<HTMLElement>(
      '[data-highlighted="true"]'
    )
    row?.scrollIntoView?.({ block: "nearest" })
  }, [highlightIndex])

  const openNew = () => {
    setEditing({ index: null, rule: defaultAccessRule() })
  }

  const removeRule = (index: number) => {
    const rule = rules[index]
    if (!rule) return
    onDeleteRule(index)
    toast.success(t("accessA.rules.deleted"), {
      action: {
        label: t("common.undo"),
        onClick: () => onUndoDelete(index, rule),
      },
    })
  }

  return (
    <section className="flex min-w-0 flex-col gap-2" data-testid="rules-card">
      <div className="min-w-0 rounded-xl bg-card shadow-sm ring-1 ring-line">
        <div className="flex flex-wrap items-start gap-2 px-3 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] leading-5 font-semibold">
              {t("accessA.rules.title")}
            </h2>
            <p className="mt-0.5 text-[12.5px] leading-[18px] text-fg-2">
              {t("accessA.rules.order")}
            </p>
          </div>
          {canEdit ? (
            <Button
              data-testid="add-rule"
              disabled={busy}
              onClick={openNew}
              size="sm"
              type="button"
              variant="outline"
            >
              <PlusIcon aria-hidden="true" />
              {t("accessA.rules.add")}
            </Button>
          ) : null}
        </div>

        {generalError ? (
          <p
            aria-live="assertive"
            className="border-t border-err-line bg-err-soft px-3 py-2 text-[12.5px] leading-[18px] text-err"
            role="alert"
          >
            {generalError}
          </p>
        ) : null}

        <div
          className="min-w-0 divide-y divide-line border-t border-line"
          ref={listRef}
        >
          {rules.length === 0 ? (
            <p className="px-3 py-3 text-sm text-fg-3">
              {t("accessA.rules.empty")}
            </p>
          ) : null}
          {rules.map((rule, index) => (
            <RuleRow
              busy={busy}
              canEdit={canEdit}
              canMoveDown={index < rules.length - 1}
              canMoveUp={index > 0}
              error={
                errors[index]
                  ? Object.values(errors[index]!).find(Boolean)
                  : undefined
              }
              highlighted={highlightIndex === index}
              index={index}
              key={index}
              onDelete={() => removeRule(index)}
              onDragStart={() => {
                dragIndex.current = index
              }}
              onDrop={() => {
                const from = dragIndex.current
                dragIndex.current = null
                if (from !== null && from !== index) onReorderRule(from, index)
              }}
              onDuplicate={() => onDuplicateRule(index)}
              onMove={(direction) => onMoveRule(index, direction)}
              onOpen={() => setEditing({ index, rule })}
              onToggle={(enabled) => onChangeRule(index, { enabled })}
              rule={rule}
              subjects={subjects}
            />
          ))}

          {canEdit ? (
            <button
              className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-3 text-left text-[13px] font-medium text-fg-2 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none max-sm:min-h-12"
              data-testid="add-rule-row"
              disabled={busy}
              onClick={openNew}
              type="button"
            >
              <PlusIcon aria-hidden="true" className="size-4" />
              {t("accessA.rules.add")}
            </button>
          ) : null}
        </div>

        <DefaultActionsRow
          chains={chains}
          disabled={!canEdit || busy}
          expanded={defaultsOpen}
          onChange={onChangeChain}
          onToggleAdvanced={() => setDefaultsOpen((current) => !current)}
        />
        {defaultsOpen ? (
          <DefaultActionsPanel
            chains={chains}
            disabled={!canEdit || busy}
            onChange={onChangeChain}
          />
        ) : null}
      </div>

      <AccessMatrix
        chains={chains}
        enforced={enforced}
        rules={rules}
        subjects={subjects}
      />

      {editing ? (
        <RuleSheet
          busy={busy}
          canEdit={canEdit}
          errors={editing.index !== null ? errors[editing.index] : undefined}
          index={editing.index}
          networkId={networkId}
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          onSave={(rule) => {
            if (editing.index === null) onCreateRule(rule)
            else onSaveRule(editing.index, rule)
            setEditing(null)
          }}
          open
          rule={editing.rule}
          subjects={subjects}
        />
      ) : null}
    </section>
  )
}
