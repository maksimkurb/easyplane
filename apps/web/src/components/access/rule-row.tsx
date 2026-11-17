import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import {
  ArrowRightIcon,
  GripVerticalIcon,
  Trash2Icon,
} from "lucide-react"

import type { AccessRule, AccessSubjects } from "@/lib/access-policy"
import { subjectChip, portsSummary } from "@/lib/access-policy"
import { Switch } from "@/components/ui/switch"
import { SubjectChips } from "@/components/access/access-chips"
import { cn } from "@/lib/utils"

function ruleAria(rule: AccessRule, subjects: AccessSubjects, t: TFunction): string {
  const from = rule.from.map((subject) => subjectChip(subject, subjects, "from").label).join(", ")
  const to = rule.to.map((subject) => subjectChip(subject, subjects, "to").label).join(", ")
  return t("accessA.rules.sentence", {
    from,
    to,
    ports: portsSummary(rule, t),
  })
}

export function RuleRow({
  rule,
  index,
  subjects,
  canEdit,
  busy,
  expanded,
  onOpen,
  onToggle,
  onDelete,
  onMove,
  onDragStart,
  onDrop,
}: {
  rule: AccessRule
  index: number
  subjects: AccessSubjects
  canEdit: boolean
  busy: boolean
  expanded?: boolean
  onOpen: () => void
  onToggle: (enabled: boolean) => void
  onDelete: () => void
  onMove: (direction: -1 | 1) => void
  onDragStart: () => void
  onDrop: () => void
}) {
  const { t } = useTranslation()
  const name = rule.name?.trim()
  const aria = ruleAria(rule, subjects, t)
  const label = name ? t("accessA.rules.editNamed", { rule: index + 1, name }) : t("accessA.rules.edit", { rule: index + 1 })

  return (
    <div
      className={cn(
        "group/rule relative grid min-h-[52px] min-w-0 grid-cols-[20px_minmax(0,1fr)_44px] items-start gap-x-1 px-2 py-1.5 sm:min-h-[48px] sm:grid-cols-[24px_20px_minmax(0,1fr)_40px_44px] sm:items-center sm:gap-x-1.5 sm:px-1",
        rule.enabled === false && "opacity-90",
        expanded && "bg-surface-2/40"
      )}
      data-testid={`rule-row-${index}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
    >
      <button
        aria-label={t("accessA.rules.drag", { rule: index + 1 })}
        className="relative mt-0.5 grid size-6 cursor-grab place-items-center rounded-md text-fg-3 hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing max-sm:hidden sm:mt-0"
        disabled={!canEdit}
        draggable={canEdit}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move"
          onDragStart()
        }}
        onKeyDown={(event) => {
          if (!event.altKey) return
          if (event.key === "ArrowUp") {
            event.preventDefault()
            onMove(-1)
          }
          if (event.key === "ArrowDown") {
            event.preventDefault()
            onMove(1)
          }
        }}
        type="button"
      >
        <GripVerticalIcon aria-hidden="true" className="size-4" />
      </button>

      <span className="mt-1 text-center text-[12.5px] leading-5 font-medium text-fg-3 tabular-nums sm:mt-0">
        {index + 1}
      </span>

      <button
        aria-expanded={expanded}
        aria-label={`${label}. ${aria}`}
        className="flex min-w-0 cursor-pointer flex-col gap-0.5 text-left focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={onOpen}
        type="button"
      >
        {name ? (
          <span
            className={cn(
              "max-w-full truncate text-[13.5px] leading-[18px] font-semibold",
              rule.enabled === false && "opacity-55"
            )}
          >
            {name}
          </span>
        ) : null}
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            <span
              className={cn(
                "inline-flex h-6 min-w-[46px] flex-none items-center justify-center rounded-[7px] px-1.5 text-[12.5px] leading-4 font-semibold sm:min-w-[52px] sm:px-2",
                rule.action === "allow" ? "bg-ok-soft text-ok" : "bg-err-soft text-err",
                rule.enabled === false && "opacity-55"
              )}
            >
              {rule.action === "allow" ? t("accessA.rules.allow") : t("accessA.rules.deny")}
            </span>
            <SubjectChips
              className={cn("min-w-0", rule.enabled === false && "opacity-55")}
              side="from"
              subjects={subjects}
              values={rule.from}
            />
            <ArrowRightIcon
              aria-hidden="true"
              className={cn("size-3.5 flex-none text-fg-3", rule.enabled === false && "opacity-55")}
            />
          </span>
          <SubjectChips
            className={cn("min-w-0", rule.enabled === false && "opacity-55")}
            side="to"
            subjects={subjects}
            values={rule.to}
          />
          <span
            className={cn(
              "inline-flex min-h-6 max-w-full items-center rounded-[7px] bg-surface-2 px-2 py-0.5 text-[12.5px] leading-[18px] shadow-[inset_0_0_0_1px_var(--line)] [overflow-wrap:anywhere]",
              rule.enabled === false && "opacity-55"
            )}
          >
            {portsSummary(rule, t)}
          </span>
          {rule.enabled === false ? (
            <span className="inline-flex h-[18px] flex-none items-center rounded-full bg-surface-3 px-1.5 text-[12px] leading-[18px] font-semibold text-fg-2">
              {t("accessA.rules.off")}
            </span>
          ) : null}
        </span>
      </button>

      <span className="hidden sm:grid sm:place-items-center">
        <Switch
          aria-label={
            name
              ? `${t("accessA.rules.enabled")}: ${name}`
              : `${t("accessA.rules.enabled")}, ${t("accessA.rules.edit", { rule: index + 1 })}`
          }
          checked={rule.enabled}
          disabled={!canEdit || busy}
          onCheckedChange={onToggle}
          size="sm"
        />
      </span>

      {canEdit ? (
        <button
          aria-label={t("accessA.rules.remove")}
          className="relative z-10 mt-0.5 grid size-8 justify-self-end rounded-lg text-fg-3 hover:bg-err-soft hover:text-err focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none after:absolute after:-inset-1.5 sm:mt-0 sm:justify-self-center"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
          type="button"
        >
          <Trash2Icon aria-hidden="true" className="size-[18px]" />
        </button>
      ) : (
        <span />
      )}
    </div>
  )
}
