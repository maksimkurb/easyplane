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
import { portsSummary } from "@/lib/access-policy"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SubjectTokenList } from "@/components/access/access-chips"
import {
  isGeneratedRuleName,
  ruleDisplayTitle,
  subjectVisibleText,
} from "@/components/access/access-rule-summary"
import { cn } from "@/lib/utils"

function subjectLine(
  values: string[],
  side: "from" | "to",
  subjects: AccessSubjects,
  t: TFunction
): string {
  return values
    .map((subject) => subjectVisibleText(subject, subjects, side, t))
    .join(", ")
}

/**
 * The row is one big button whose accessible name must contain every visible
 * fragment in reading order: heading, action, both subject groups, ports, the
 * disabled state and any error. The truncated summary keeps the full list here.
 * The purpose ("Edit rule N") goes last so the name still starts with the
 * visible heading.
 */
function ruleVisibleName(
  rule: AccessRule,
  subjects: AccessSubjects,
  title: string,
  label: string,
  error: string | undefined,
  t: TFunction
): string {
  const action =
    rule.action === "allow" ? t("accessA.rules.allow") : t("accessA.rules.deny")
  return [
    title,
    action,
    subjectLine(rule.from, "from", subjects, t) || t("accessA.preview.anyone"),
    subjectLine(rule.to, "to", subjects, t) || t("accessA.preview.anywhere"),
    portsSummary(rule, t),
    rule.enabled === false ? t("accessA.rules.off") : null,
    error ?? null,
    label,
  ]
    .filter(Boolean)
    .join(" ")
}

/**
 * One rule in the ordered list, in two calm lines:
 * `Title  ● Allow`
 * `source → destination · TCP 445, 548`
 *
 * The row chrome is deliberately quiet: the drag handle appears on hover or
 * keyboard focus (always on touch), the order number is gone, and a disabled
 * rule is simply dimmed with its switch off.
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
  const storedName = rule.name?.trim()
  const name =
    storedName && !isGeneratedRuleName(storedName) ? storedName : undefined
  // Every row gets a heading. Without a human name it is the plain-language
  // summary, so unnamed rules no longer look like a different kind of row.
  const title = ruleDisplayTitle(rule, subjects, t)
  const purpose = t("accessA.rules.edit", { rule: index + 1 })
  const visibleName = ruleVisibleName(rule, subjects, title, purpose, error, t)
  const dimmed = rule.enabled === false
  const action =
    rule.action === "allow" ? t("accessA.rules.allow") : t("accessA.rules.deny")
  const fullSummary = [
    subjectLine(rule.from, "from", subjects, t) || t("accessA.preview.anyone"),
    "→",
    subjectLine(rule.to, "to", subjects, t) || t("accessA.preview.anywhere"),
    "·",
    portsSummary(rule, t),
  ].join(" ")

  return (
    <div
      className={cn(
        "group/rule relative grid min-h-[52px] min-w-0 grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-1 px-1 py-1.5 max-sm:min-h-14",
        highlighted && "bg-brand-soft/70 shadow-[inset_3px_0_0_var(--brand)]"
      )}
      data-disabled={dimmed ? "true" : undefined}
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
        className="grid size-6 cursor-grab place-items-center rounded-md text-fg-3 opacity-0 transition-opacity group-hover/rule:opacity-100 group-focus-within/rule:opacity-100 hover:bg-surface-2 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing disabled:cursor-default [@media(pointer:coarse)]:opacity-100"
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

      <button
        aria-label={visibleName}
        className={cn(
          "flex min-w-0 cursor-pointer flex-col gap-0.5 text-left focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
          dimmed && "opacity-60"
        )}
        data-testid={`rule-open-${index}`}
        onClick={onOpen}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="min-w-0 flex-1 truncate text-[13.5px] leading-[18px] font-semibold"
            title={title}
          >
            {title}
          </span>
          <span
            className={cn(
              "inline-flex flex-none items-center gap-1 text-[11.5px] leading-4 font-semibold",
              rule.action === "allow" ? "text-ok" : "text-err"
            )}
          >
            <span
              aria-hidden="true"
              className="size-1.5 flex-none rounded-full bg-current"
            />
            {action}
          </span>
        </span>

        <span
          className="flex min-w-0 items-center gap-1 text-[12.5px] leading-[17px] text-fg-3"
          title={fullSummary}
        >
          <span className="min-w-0 truncate">
            <SubjectTokenList
              side="from"
              subjects={subjects}
              values={rule.from}
            />
            <ArrowRightIcon
              aria-hidden="true"
              className="mx-1 inline size-3 flex-none align-[-1px] text-fg-3"
            />
            <SubjectTokenList side="to" subjects={subjects} values={rule.to} />
          </span>
          <span aria-hidden="true" className="flex-none text-fg-3">
            ·
          </span>
          <span className="flex-none pl-0.5 whitespace-nowrap tabular-nums">
            {portsSummary(rule, t, 2)}
          </span>
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

      <span
        className={cn(
          "flex flex-none items-center gap-0.5 sm:gap-1",
          dimmed && "opacity-60"
        )}
      >
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

        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={
                name
                  ? t("accessA.rules.actionsNamed", { name })
                  : t("accessA.rules.actions", { rule: index + 1 })
              }
              className="grid size-7 cursor-pointer place-items-center rounded-lg text-fg-3 outline-none hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 max-sm:size-11"
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
              <DropdownMenuItem
                disabled={!canMoveUp}
                onClick={() => onMove(-1)}
              >
                <ArrowUpIcon aria-hidden="true" />
                {t("accessA.rules.moveUp")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canMoveDown}
                onClick={() => onMove(1)}
              >
                <ArrowDownIcon aria-hidden="true" />
                {t("accessA.rules.moveDown")}
              </DropdownMenuItem>
              <DropdownMenuItem destructive onClick={onDelete}>
                <Trash2Icon aria-hidden="true" />
                {t("accessA.rules.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </span>
    </div>
  )
}
