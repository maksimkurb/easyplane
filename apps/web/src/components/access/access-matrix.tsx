import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  ChevronDownIcon,
  EyeIcon,
  ShieldCheckIcon,
  ShieldXIcon,
  SparklesIcon,
} from "lucide-react"

import type {
  AccessChain,
  AccessChainName,
  AccessRule,
  AccessSubjects,
} from "@/lib/access-policy"
import {
  computeAccessMatrix,
  type MatrixCell,
} from "@/components/access/access-rule-summary"
import { cn } from "@/lib/utils"

function CellGlyph({ status }: { status: MatrixCell["status"] }) {
  if (status === "allow")
    return <ShieldCheckIcon aria-hidden="true" className="size-4 text-ok" />
  if (status === "deny")
    return <ShieldXIcon aria-hidden="true" className="size-4 text-err" />
  if (status === "partial")
    return <SparklesIcon aria-hidden="true" className="size-4 text-warn" />
  return (
    <span aria-hidden="true" className="text-fg-3">
      ·
    </span>
  )
}

function cellText(cell: MatrixCell, t: (key: string) => string): string {
  if (cell.status === "allow") return t("accessA.matrix.allowed")
  if (cell.status === "deny") return t("accessA.matrix.denied")
  if (cell.status === "partial") return t("accessA.matrix.partial")
  if (cell.status === "self") return t("accessA.matrix.self")
  return t("accessA.matrix.empty")
}

/**
 * Read-only "who can reach whom" overview for advanced users. Rows are tag or
 * user-group sources, columns are destinations. It is a plain table so screen
 * readers get the same pair information as the glyphs.
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
  const matrix = computeAccessMatrix(subjects, rules, chains)
  const hasEntities = matrix.rows.length > 0

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
        <EyeIcon aria-hidden="true" className="size-4 flex-none text-fg-3" />
        <span className="min-w-0 flex-1">{t("accessA.matrix.title")}</span>
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            "size-4 flex-none text-fg-3 transition-transform",
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
          ) : hasEntities ? (
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <table className="w-full min-w-max border-separate border-spacing-0 text-[12.5px]">
                <caption className="sr-only">
                  {t("accessA.matrix.title")}
                </caption>
                <thead>
                  <tr>
                    <th
                      className="sticky left-0 z-10 bg-card px-2 py-1.5 text-left font-medium text-fg-3"
                      scope="col"
                    >
                      {t("accessA.matrix.from")}
                    </th>
                    {matrix.cols.map((entity) => (
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
                  {matrix.rows.map((source, rowIndex) => (
                    <tr key={source.key}>
                      <th
                        className="sticky left-0 z-10 max-w-32 truncate bg-card px-2 py-1.5 text-left font-medium text-fg-2"
                        scope="row"
                        title={source.label}
                      >
                        {source.label}
                      </th>
                      {matrix.cols.map((destination, colIndex) => {
                        const cell = matrix.cells[rowIndex]![colIndex]!
                        const rulesText =
                          cell.rules.length > 0
                            ? t("accessA.matrix.byRules", {
                                rules: cell.rules.join(", "),
                              })
                            : cell.usesDefault
                              ? t("accessA.matrix.byDefault")
                              : t("accessA.matrix.noDevices")
                        const description = `${t("accessA.matrix.pair", {
                          from: source.label,
                          to: destination.label,
                        })}: ${cellText(cell, t)}. ${rulesText}`
                        return (
                          <td
                            aria-label={description}
                            className={cn(
                              "border-t border-line px-2 py-1.5 text-center",
                              cell.status === "allow" && "bg-ok-soft/50",
                              cell.status === "deny" && "bg-err-soft/45",
                              cell.status === "partial" && "bg-warn-soft/50"
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
          ) : (
            <p className="pb-2 text-[13px] text-fg-2">
              {t("accessA.matrix.empty")}
            </p>
          )}
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
              <SparklesIcon aria-hidden="true" className="size-3.5 text-warn" />
              {t("accessA.matrix.partial")}
            </span>
          </p>
        </div>
      ) : null}
    </section>
  )
}
