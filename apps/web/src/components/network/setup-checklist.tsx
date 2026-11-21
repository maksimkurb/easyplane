import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowRightIcon,
  CheckIcon,
  CircleIcon,
  PlusIcon,
  XIcon,
} from "lucide-react"

import type { GetNetwork200, ListDevices200Item } from "@/api/generated/model"
import { LinkButton } from "@/components/shared/link-button"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { cn } from "@/lib/utils"

const DISMISS_KEY = "easyplane-setup-dismissed"

function readDismissed(networkId: string): boolean {
  try {
    return window.localStorage.getItem(`${DISMISS_KEY}:${networkId}`) === "1"
  } catch {
    return false
  }
}

function writeDismissed(networkId: string): void {
  try {
    window.localStorage.setItem(`${DISMISS_KEY}:${networkId}`, "1")
  } catch {
    // Private browsing may block storage; the card simply returns next visit.
  }
}

/**
 * Guided "zero to working network" checklist shown above the network tabs.
 *
 * Steps are derived from real data, so the card cannot ask for something that
 * is already done. Once the three required steps are done only the optional
 * ones remain; when every step is done the card disappears on its own. It can
 * also be dismissed, and the dismissal is remembered per network.
 */
export function SetupChecklist({
  network,
  devices,
  openAddDevice,
}: {
  network: GetNetwork200
  devices: ListDevices200Item[]
  openAddDevice: () => void
}) {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(() => readDismissed(network.id))

  const approved = devices.filter((device) => device.state === "approved")
  const pending = devices.filter((device) => device.state === "pending")
  const firstApproved = approved[0]

  const steps = useMemo(() => {
    const added = devices.length > 0
    const approveDone = approved.length > 0 && pending.length === 0
    const secondDone = approved.length >= 2
    const hubDone = devices.some((device) => device.isHub)
    const accessDone =
      network.policyVersion > 0 || network.policyMode !== "open"
    const requiredDone = added && approveDone && secondDone

    return {
      requiredDone,
      allDone: requiredDone && hubDone && accessDone,
      entries: [
        {
          id: "first",
          done: added,
          optional: false,
          action: !added ? (
            <Button onClick={openAddDevice} size="sm" type="button">
              <PlusIcon className="size-4" />
              {t("setup.steps.first.action")}
            </Button>
          ) : null,
        },
        {
          id: "approve",
          done: approveDone,
          optional: false,
          action:
            approveDone || added === false ? null : (
              <LinkButton
                href={`/networks/${network.id}`}
                size="sm"
                variant="outline"
              >
                {pending.length > 0
                  ? t("setup.steps.approve.action")
                  : t("setup.steps.approve.waiting")}
                <ArrowRightIcon className="size-4" />
              </LinkButton>
            ),
        },
        {
          id: "second",
          done: secondDone,
          optional: false,
          action: !secondDone ? (
            <Button
              onClick={openAddDevice}
              size="sm"
              type="button"
              variant="outline"
            >
              <PlusIcon className="size-4" />
              {t("setup.steps.second.action")}
            </Button>
          ) : null,
        },
        {
          id: "hub",
          done: hubDone,
          optional: true,
          action: !hubDone ? (
            firstApproved ? (
              <LinkButton
                href={`/devices/${firstApproved.id}`}
                size="sm"
                variant="outline"
              >
                {t("setup.steps.hub.action")}
                <ArrowRightIcon className="size-4" />
              </LinkButton>
            ) : (
              <Button
                onClick={openAddDevice}
                size="sm"
                type="button"
                variant="outline"
              >
                {t("setup.steps.hub.action")}
              </Button>
            )
          ) : null,
        },
        {
          id: "access",
          done: accessDone,
          optional: true,
          action: !accessDone ? (
            <LinkButton
              href={`/networks/${network.id}/access`}
              size="sm"
              variant="outline"
            >
              {t("setup.steps.access.action")}
              <ArrowRightIcon className="size-4" />
            </LinkButton>
          ) : null,
        },
      ] as const,
    }
  }, [
    approved.length,
    devices,
    network.id,
    network.policyMode,
    network.policyVersion,
    openAddDevice,
    pending.length,
    t,
    firstApproved,
  ])

  if (dismissed || steps.allDone) return null

  // Once the required path is done, keep the card focused on what is left.
  const visible = steps.requiredDone
    ? steps.entries.filter((entry) => entry.optional)
    : steps.entries
  if (visible.length === 0) return null

  const doneCount = steps.entries.filter((entry) => entry.done).length
  const total = steps.entries.length

  const dismiss = () => {
    writeDismissed(network.id)
    setDismissed(true)
  }

  return (
    <section
      aria-labelledby="setup-checklist-title"
      className="mb-4 overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-line"
    >
      <div className="flex items-start gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <span
          aria-hidden="true"
          className="mt-0.5 grid size-8 flex-none place-items-center rounded-lg bg-brand-soft text-brand-text ring-1 ring-line"
        >
          <CheckIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            className="text-[15px] leading-5 font-semibold tracking-[-0.006em]"
            id="setup-checklist-title"
          >
            {steps.requiredDone ? t("setup.optionalTitle") : t("setup.title")}
          </h2>
          <p className="mt-0.5 text-xs text-fg-3">
            {t("setup.progress", { done: doneCount, total })}
          </p>
          <div
            aria-hidden="true"
            className="mt-2 h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-surface-3"
          >
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-300"
              style={{ width: `${Math.round((doneCount / total) * 100)}%` }}
            />
          </div>
        </div>
        <Button
          aria-label={t("setup.dismiss")}
          onClick={dismiss}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      <ol className="divide-y divide-line">
        {visible.map((entry) => {
          const title = t(`setup.steps.${entry.id}.title`)
          const number =
            steps.entries.findIndex((item) => item.id === entry.id) + 1
          return (
            <li
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-5"
              key={entry.id}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-5 flex-none place-items-center rounded-full sm:mt-0",
                  entry.done
                    ? "bg-ok-soft text-ok"
                    : "bg-surface-2 text-fg-3 ring-1 ring-line"
                )}
              >
                {entry.done ? (
                  <CheckIcon className="size-3.5" />
                ) : (
                  <CircleIcon className="size-2 fill-current" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "text-[13px] font-medium",
                      entry.done && "text-fg-3 line-through decoration-fg-3/40"
                    )}
                  >
                    {number}. {title}
                  </span>
                  {entry.optional ? (
                    <Chip className="h-[18px] px-1.5 text-xs">
                      {t("setup.optional")}
                    </Chip>
                  ) : null}
                  {entry.done ? (
                    <span className="text-xs font-medium text-ok">
                      {t("setup.done")}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs leading-4 text-fg-3">
                  {t(`setup.steps.${entry.id}.body`)}
                </p>
              </div>
              {entry.action && !entry.done ? (
                <div className="flex flex-none [&>*]:w-full sm:[&>*]:w-auto">
                  {entry.action}
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
