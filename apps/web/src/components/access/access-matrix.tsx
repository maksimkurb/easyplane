import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import {
  ChevronDownIcon,
  EyeIcon,
  ShieldCheckIcon,
  ShieldXIcon,
} from "lucide-react"

import type {
  AccessChain,
  AccessChainName,
  AccessRule,
  AccessSubjects,
} from "@/lib/access-policy"
import { stripSubjectKind } from "@/lib/access-policy"
import {
  computeAccessMatrix,
  subjectDisplayLabel,
  type MatrixCell,
} from "@/components/access/access-rule-summary"
import { Segmented } from "@/components/ui/segmented"
import { cn } from "@/lib/utils"

type Scope = "tags" | "groups"

/**
 * "Partly allowed" used to be a warning sparkle repeated in almost every cell,
 * which reads as an alarm without saying anything. A neutral half circle plus a
 * legend says the same thing quietly.
 */
function PartialGlyph({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2.5 rounded-full bg-[linear-gradient(90deg,var(--fg-2)_50%,transparent_50%)] ring-1 ring-fg-2",
        className
      )}
    />
  )
}

function CellGlyph({ status }: { status: MatrixCell["status"] }) {
  if (status === "allow")
    return <ShieldCheckIcon aria-hidden="true" className="size-4 text-ok" />
  if (status === "deny")
    return <ShieldXIcon aria-hidden="true" className="size-4 text-err" />
  if (status === "partial") return <PartialGlyph />
  return (
    <span aria-hidden="true" className="text-fg-2">
      ·
    </span>
  )
}

/**
 * The summary names what an allow rule actually lets a tag reach. The tags×tags
 * table can only say "partly" when a rule points at one device inside the tag,
 * which is useless as a first answer.
 */
function summaryTargets(
  entity: { kind: "tag" | "group"; label: string },
  rules: AccessRule[],
  subjects: AccessSubjects,
  t: TFunction
): string[] {
  const seen = new Set<string>()
  for (const rule of rules) {
    if (rule.enabled === false || rule.action !== "allow") continue
    const matches = rule.from.some((subject) => {
      if (subject === "*") return true
      const { kind, name } = stripSubjectKind(subject)
      return (
        kind === entity.kind &&
        name.toLowerCase() === entity.label.toLowerCase()
      )
    })
    if (!matches) continue
    for (const destination of rule.to) {
      seen.add(subjectDisplayLabel(destination, subjects, "to", t))
    }
  }
  return [...seen]
}

function cellText(cell: MatrixCell, t: (key: string) => string): string {
  if (cell.status === "allow") return t("accessA.matrix.allowed")
  if (cell.status === "deny") return t("accessA.matrix.denied")
  if (cell.status === "partial") return t("accessA.matrix.partial")
  if (cell.status === "self") return t("accessA.matrix.self")
  return t("accessA.matrix.empty")
}

/**
 * Read-only "who can reach whom" overview. The default view is the tag matrix
 * with a plain-language summary above it; user groups are one switch away so the
 * table stays at 12x12 instead of a wall of half-filled cells. On a phone the
 * table scrolls sideways with an edge hint rather than collapsing into noise.
 */
export function AccessMatrix({
  subjects,
  rules,
  chains,
  enforced = true,
}: {
  subjects: AccessSubjects
  rules: AccessRule[]
  chains: Record<AccessChainName, AccessChain>
  enforced?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<Scope>("tags")
  const matrix = computeAccessMatrix(subjects, rules, chains)
  const hasGroups = subjects.userGroups.length > 0
  const activeScope = scope === "groups" && !hasGroups ? "tags" : scope
  const entityKind = activeScope === "tags" ? "tag" : "group"
  const entries = matrix.rows
    .map((entity, index) => ({ entity, index }))
    .filter(({ entity }) => entity.kind === entityKind)
  const targets = entries.map(({ entity }) => entity)
  const rows = entries.map(({ entity, index }) => ({
    entity,
    cells: entries.map(
      ({ index: targetIndex }) => matrix.cells[index]![targetIndex]!
    ),
  }))
  const hasEntities = rows.length > 0

  return (
    <section
      className="min-w-0 rounded-xl bg-card shadow-sm ring-1 ring-line"
      data-testid="access-matrix"
    >
      <button
        aria-expanded={open}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none max-sm:min-h-12"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <EyeIcon aria-hidden="true" className="size-4 flex-none text-fg-2" />
        <span className="min-w-0 flex-1">{t("accessA.matrix.title")}</span>
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            "size-4 flex-none text-fg-2 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open ? (
        <div className="border-t border-line px-2 pb-3 sm:px-3">
          <p className="py-2 text-[12.5px] leading-[18px] text-fg-2">
            {t("accessA.matrix.hint")}
          </p>
          {!enforced ? (
            <p className="pb-2 text-[13px] text-fg-2">
              {t("accessA.matrix.openMode")}
            </p>
          ) : !hasEntities ? (
            <p className="pb-2 text-[13px] text-fg-2">
              {t("accessA.matrix.empty")}
            </p>
          ) : (
            <>
              {hasGroups ? (
                <Segmented
                  className="mb-2 [&>button]:h-9 max-sm:[&>button]:h-11"
                  label={t("accessA.matrix.scope")}
                  onValueChange={(value) => setScope(value)}
                  options={[
                    {
                      value: "tags" as const,
                      label: t("accessA.matrix.scopeTags"),
                    },
                    {
                      value: "groups" as const,
                      label: t("accessA.matrix.scopeGroups"),
                    },
                  ]}
                  value={activeScope}
                />
              ) : null}

              <ul className="mb-2 flex min-w-0 flex-col gap-0.5">
                {rows.map(({ entity }) => {
                  const reachable = summaryTargets(entity, rules, subjects, t)
                  return (
                    <li
                      className="min-w-0 text-[12.5px] leading-[18px] text-fg-2"
                      key={entity.key}
                    >
                      {reachable.length > 0
                        ? t("accessA.matrix.reaches", {
                            from: entity.label,
                            to: reachable.join(", "),
                          })
                        : t("accessA.matrix.reachesNone", {
                            from: entity.label,
                          })}
                    </li>
                  )
                })}
              </ul>

              <div className="relative -mx-2 sm:-mx-3">
                <div
                  aria-label={t("accessA.matrix.title")}
                  className="overflow-x-auto overscroll-x-contain px-2 pb-1 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset sm:px-3"
                  role="region"
                  tabIndex={0}
                >
                  <table className="w-full min-w-max border-separate border-spacing-0 text-[12.5px]">
                    <caption className="sr-only">
                      {t("accessA.matrix.title")}
                    </caption>
                    <thead>
                      <tr>
                        <th
                          className="sticky left-0 z-10 bg-card px-2 py-1.5 text-left font-medium text-fg-2"
                          scope="col"
                        >
                          {t("accessA.matrix.from")}
                        </th>
                        {targets.map((entity) => (
                          <th
                            className="max-w-28 truncate px-2 py-1.5 text-center align-bottom font-medium text-fg-2"
                            key={entity.key}
                            scope="col"
                            title={entity.label}
                          >
                            {entity.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((source) => (
                        <tr key={source.entity.key}>
                          <th
                            className="sticky left-0 z-10 max-w-32 truncate bg-card px-2 py-1.5 text-left font-medium text-fg-2"
                            scope="row"
                            title={source.entity.label}
                          >
                            {source.entity.label}
                          </th>
                          {targets.map((destination, colIndex) => {
                            const cell = source.cells[colIndex]!
                            const rulesText =
                              cell.rules.length > 0
                                ? t("accessA.matrix.byRules", {
                                    rules: cell.rules.join(", "),
                                  })
                                : cell.usesDefault
                                  ? t("accessA.matrix.byDefault")
                                  : t("accessA.matrix.noDevices")
                            const description = `${t("accessA.matrix.pair", {
                              from: source.entity.label,
                              to: destination.label,
                            })}: ${cellText(cell, t)}. ${rulesText}`
                            return (
                              <td
                                aria-label={description}
                                className={cn(
                                  "border-t border-line px-2 py-1.5 text-center",
                                  cell.status === "allow" && "bg-ok-soft/50",
                                  cell.status === "deny" && "bg-err-soft/45"
                                )}
                                key={destination.key}
                                title={description}
                              >
                                <span className="inline-flex items-center justify-center">
                                  <CellGlyph status={cell.status} />
                                </span>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.length > 3 ? (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-card to-transparent sm:hidden"
                  />
                ) : null}
              </div>
              {rows.length > 3 ? (
                <p className="mt-1 text-[12px] leading-[18px] text-fg-2 sm:hidden">
                  {t("accessA.matrix.scrollHint")}
                </p>
              ) : null}
            </>
          )}
          {enforced && hasEntities ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-2">
            <span className="inline-flex items-center gap-1">
              <ShieldCheckIcon
                aria-hidden="true"
                className="size-3.5 text-ok"
              />
              {t("accessA.matrix.allowed")}
            </span>
            <span className="inline-flex items-center gap-1">
              <ShieldXIcon aria-hidden="true" className="size-3.5 text-err" />
              {t("accessA.matrix.denied")}
            </span>
            <span className="inline-flex items-center gap-1">
              <PartialGlyph className="ring-fg-2" />
              {t("accessA.matrix.partialLegend")}
            </span>
          </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
