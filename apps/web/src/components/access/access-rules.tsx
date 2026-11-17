import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { PlusIcon } from "lucide-react"

import type {
  AccessChain,
  AccessChainName,
  AccessRule,
  AccessSubjects,
} from "@/lib/access-policy"
import { useIsMobile } from "@/hooks/use-mobile"
import { Button } from "@/components/ui/button"
import {
  DefaultActionsFooter,
  DefaultActionsPanel,
  DefaultActionsSheet,
} from "@/components/access/default-actions"
import { RuleFields, type RuleFieldErrors } from "@/components/access/rule-editor"
import { RuleRow } from "@/components/access/rule-row"
import { RuleSheet } from "@/components/access/rule-sheet"

export type RuleErrors = Record<number, RuleFieldErrors>

export function AccessRules({
  rules,
  subjects,
  networkId,
  chains,
  canEdit,
  busy,
  errors,
  generalError,
  onChangeRule,
  onDeleteRule,
  onMoveRule,
  onReorderRule,
  onDuplicateRule,
  onAddRule,
  onChangeChain,
  onChangeChains,
}: {
  rules: AccessRule[]
  subjects: AccessSubjects
  networkId: string
  chains: Record<AccessChainName, AccessChain>
  canEdit: boolean
  busy: boolean
  errors: RuleErrors
  generalError?: string
  onChangeRule: (index: number, patch: Partial<AccessRule>) => void
  onDeleteRule: (index: number) => void
  onMoveRule: (index: number, direction: -1 | 1) => void
  onReorderRule: (from: number, to: number) => void
  onDuplicateRule: (index: number) => void
  onAddRule: () => void
  onChangeChain: (name: AccessChainName, patch: Partial<AccessChain>) => void
  onChangeChains: (chains: Record<AccessChainName, AccessChain>) => void
}) {
  const { t } = useTranslation()
  const isPhone = useIsMobile(640)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [sheetIndex, setSheetIndex] = useState<number | null>(null)
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  const [defaultsSheet, setDefaultsSheet] = useState(false)
  const dragIndex = useRef<number | null>(null)

  const openRule = (index: number) => {
    if (isPhone) {
      setSheetIndex(index)
      return
    }
    setExpanded((current) => (current === index ? null : index))
  }

  const activeSheetRule = sheetIndex !== null ? rules[sheetIndex] : undefined

  return (
    <section className="flex min-w-0 flex-col gap-2" data-testid="rules-card">
      <h2 className="sr-only">{t("accessA.rules.title")}</h2>
      <div className="min-w-0 rounded-xl bg-card shadow-sm ring-1 ring-line">
        {generalError ? (
          <p
            aria-live="assertive"
            className="border-b border-err-line bg-err-soft px-3 py-2 text-[12.5px] leading-[18px] text-err"
            role="alert"
          >
            {generalError}
          </p>
        ) : null}
        <div className="min-w-0 divide-y divide-line">
          {rules.length === 0 ? (
            <p className="px-3 py-3 text-sm text-fg-3">{t("accessA.rules.empty")}</p>
          ) : null}
          {rules.map((rule, index) => (
            <div className="min-w-0" key={index}>
              <RuleRow
                busy={busy}
                canEdit={canEdit}
                expanded={!isPhone && expanded === index}
                index={index}
                onDelete={() => {
                  setExpanded(null)
                  onDeleteRule(index)
                }}
                onDragStart={() => {
                  dragIndex.current = index
                }}
                onDrop={() => {
                  const from = dragIndex.current
                  dragIndex.current = null
                  if (from !== null && from !== index) {
                    onReorderRule(from, index)
                    setExpanded(null)
                  }
                }}
                onMove={(direction) => {
                  setExpanded(null)
                  onMoveRule(index, direction)
                }}
                onOpen={() => openRule(index)}
                onToggle={(enabled) => onChangeRule(index, { enabled })}
                rule={rule}
                subjects={subjects}
              />
              {!isPhone && expanded === index ? (
                <div
                  className="border-t border-line bg-surface-2/60 p-3"
                  data-testid="rule-editor"
                >
                  <RuleFields
                    disabled={!canEdit}
                    errors={errors[index]}
                    index={index}
                    networkId={networkId}
                    onChange={(patch) => onChangeRule(index, patch)}
                    presentation="inline"
                    rule={rule}
                    subjects={subjects}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <DefaultActionsFooter
          busy={busy}
          canEdit={canEdit}
          chains={chains}
          expanded={!isPhone && defaultsOpen}
          onOpen={() => {
            if (isPhone) setDefaultsSheet(true)
            else setDefaultsOpen((current) => !current)
          }}
        />
        {!isPhone && defaultsOpen ? (
          <DefaultActionsPanel
            chains={chains}
            disabled={!canEdit || busy}
            onChange={onChangeChain}
          />
        ) : null}
      </div>

      <div className="sticky bottom-3 z-20 flex justify-end max-sm:bottom-2.5">
        {canEdit ? (
          <Button
            className="h-11 rounded-full px-4 shadow-lg"
            data-testid="add-rule"
            disabled={busy}
            onClick={onAddRule}
            type="button"
          >
            <PlusIcon className="size-4" />
            {t("accessA.rules.add")}
          </Button>
        ) : null}
      </div>

      {isPhone && activeSheetRule && sheetIndex !== null ? (
        <RuleSheet
          busy={busy}
          canEdit={canEdit}
          canMoveDown={sheetIndex < rules.length - 1}
          canMoveUp={sheetIndex > 0}
          errors={errors[sheetIndex]}
          index={sheetIndex}
          networkId={networkId}
          onDelete={() => onDeleteRule(sheetIndex)}
          onDuplicate={() => onDuplicateRule(sheetIndex)}
          onMove={(direction) => onMoveRule(sheetIndex, direction)}
          onOpenChange={(open) => {
            if (!open) setSheetIndex(null)
          }}
          onSave={(rule) => onChangeRule(sheetIndex, rule)}
          open
          rule={activeSheetRule}
          subjects={subjects}
        />
      ) : null}

      {isPhone ? (
        <DefaultActionsSheet
          busy={busy}
          canEdit={canEdit}
          chains={chains}
          onOpenChange={setDefaultsSheet}
          onSave={onChangeChains}
          open={defaultsSheet}
        />
      ) : null}
    </section>
  )
}
