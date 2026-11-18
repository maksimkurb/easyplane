import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CopyIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react"

import type { AccessRule, AccessSubjects } from "@/lib/access-policy"
import { portsSummary, subjectChip } from "@/lib/access-policy"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { AllowDenyPill, SubjectChips } from "@/components/access/access-chips"
import { cn } from "@/lib/utils"

function ruleAria(
  rule: AccessRule,
  subjects: AccessSubjects,
  t: TFunction
): string {
  const from = rule.from
    .map((subject) => subjectChip(subject, subjects, "from").label)
    .join(", ")
  const to = rule.to
    .map((subject) => subjectChip(subject, subjects, "to").label)
    .join(", ")
  return t("accessA.rules.sentence", {
    from,
    to,
    ports: portsSummary(rule, t),
  })
}

/**
 * One line of the ordered rule list. It reads as a sentence:
 * `[#] [Allow] from → to · ports [switch] [⋯]`.
 */
export function RuleRow({
  rule,
  index,
  subjects,
  canEdit,
  busy,
  highlighted = false,
  error,
  canMoveUp,
  canMoveDown,
  onOpen,
  onToggle,
  onDuplicate,
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
  highlighted?: boolean
  error?: string
  canMoveUp: boolean
  canMoveDown: boolean
  onOpen: () => void
  onToggle: (enabled: boolean) => void
  onDuplicate: () => void
  onDelete: () => void
  onMove: (direction: -1 | 1) => void
  onDragStart: () => void
  onDrop: () => void
}) {
  const { t } = useTranslation()
  const name = rule.name?.trim()
  const aria = ruleAria(rule, subjects, t)
  const label = name
    ? t("accessA.rules.editNamed", { rule: index + 1, name })
    : t("accessA.rules.edit", { rule: index + 1 })
  const dimmed = rule.enabled === false

  return (
    <div
      className={cn(
        "group/rule relative grid min-h-[52px] min-w-0 grid-cols-[20px_minmax(0,1fr)_44px_40px] items-start gap-x-1 px-2 py-1.5 sm:min-h-[52px] sm:grid-cols-[24px_22px_minmax(0,1fr)_40px_40px] sm:items-center sm:gap-x-1.5 sm:px-1",
        dimmed && "opacity-90",
        highlighted && "bg-brand-soft/70 shadow-[inset_3px_0_0_var(--brand)]"
      )}
      data-highlighted={highlighted ? "true" : undefined}
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
        aria-label={`${label}. ${aria}`}
        className="flex min-w-0 cursor-pointer flex-col gap-1 text-left focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        data-testid={`rule-open-${index}`}
        onClick={onOpen}
        type="button"
      >
        {name ? (
          <span
            className={cn(
              "max-w-full truncate text-[13.5px] leading-[18px] font-semibold",
              dimmed && "opacity-55"
            )}
          >
            {name}
          </span>
        ) : null}
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            <AllowDenyPill
              action={rule.action}
              className={cn(
                "h-5 min-w-[48px] px-1.5 sm:h-6 sm:min-w-[52px]",
                dimmed && "opacity-55"
              )}
            />
            <SubjectChips
              className={cn("min-w-0", dimmed && "opacity-55")}
              side="from"
              subjects={subjects}
              values={rule.from}
            />
            <ArrowRightIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 flex-none text-fg-3",
                dimmed && "opacity-55"
              )}
            />
          </span>
          <SubjectChips
            className={cn("min-w-0", dimmed && "opacity-55")}
            side="to"
            subjects={subjects}
            values={rule.to}
          />
          <span
            className={cn(
              "inline-flex min-h-5 max-w-full items-center rounded-[7px] bg-surface-2 px-2 py-0.5 text-[12.5px] leading-[18px] [overflow-wrap:anywhere] shadow-[inset_0_0_0_1px_var(--line)] sm:min-h-6",
              dimmed && "opacity-55"
            )}
          >
            {portsSummary(rule, t)}
          </span>
          {dimmed ? (
            <span className="inline-flex h-[18px] flex-none items-center rounded-full bg-surface-3 px-1.5 text-[12px] leading-[18px] font-semibold text-fg-2">
              {t("accessA.rules.off")}
            </span>
          ) : null}
        </span>
        {error ? (
          <span
            aria-live="polite"
            className="text-[12px] leading-[18px] text-err"
          >
            {error}
          </span>
        ) : null}
      </button>

      <span className="grid place-items-center">
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
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={
              name
                ? t("accessA.rules.actionsNamed", { name })
                : t("accessA.rules.actions", { rule: index + 1 })
            }
            className="grid size-8 cursor-pointer place-items-center justify-self-end rounded-lg text-fg-3 outline-none hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 sm:justify-self-center"
            disabled={busy}
            data-testid={`rule-menu-${index}`}
          >
            <MoreHorizontalIcon aria-hidden="true" className="size-[18px]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={onOpen}>
              <PencilIcon aria-hidden="true" />
              {t("accessA.rules.editAction")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>
              <CopyIcon aria-hidden="true" />
              {t("accessA.rules.duplicate")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canMoveUp} onClick={() => onMove(-1)}>
              <ArrowUpIcon aria-hidden="true" />
              {t("accessA.rules.moveUp")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canMoveDown} onClick={() => onMove(1)}>
              <ArrowDownIcon aria-hidden="true" />
              {t("accessA.rules.moveDown")}
            </DropdownMenuItem>
            <DropdownMenuItem destructive onClick={onDelete}>
              <Trash2Icon aria-hidden="true" />
              {t("accessA.rules.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span />
      )}
    </div>
  )
}
