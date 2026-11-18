import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useLocation } from "wouter"
import { ChevronDownIcon, SparklesIcon } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  getListNetworksQueryKey,
  useCreateNetwork,
  useListNetworks,
} from "@/api/generated/easyplane"
import { useAuth } from "@/auth/auth-context"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

type FieldError =
  | "nameRequired"
  | "rangeRequired"
  | "rangeInvalid"
  | "rangeNotPrivate"
  | "rangeTooSmall"
  | "rangeOverlap"

type ParsedRange = {
  start: number
  end: number
}

function parseRange(value: string): ParsedRange | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(
    value.trim()
  )
  if (!match) return null
  const octets = match.slice(1, 5).map(Number)
  const prefix = Number(match[5])
  if (octets.some((octet) => octet > 255) || prefix < 0 || prefix > 32) {
    return null
  }
  const base =
    ((octets[0]! << 24) |
      (octets[1]! << 16) |
      (octets[2]! << 8) |
      octets[3]!) >>>
    0
  const size = 2 ** (32 - prefix)
  const start = base - (base % size)
  return { start, end: start + size - 1 }
}

function isPrivateRange(start: number): boolean {
  const first = start >>> 24
  const second = (start >>> 16) & 0xff
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

/** A /24 that no existing network uses, in a private range. */
function suggestRange(existing: string[], avoid?: string): string {
  const candidates: string[] = []
  for (let third = 144; third <= 254; third += 1) {
    candidates.push(`10.${third}.144.0/24`)
  }
  for (let third = 0; third <= 254; third += 1) {
    candidates.push(`192.168.${third}.0/24`)
  }
  const used = existing
    .map((cidr) => parseRange(cidr))
    .filter((range): range is ParsedRange => range !== null)

  return (
    candidates.find((candidate) => {
      if (candidate === avoid) return false
      const range = parseRange(candidate)
      if (!range) return false
      return !used.some(
        (entry) => range.start <= entry.end && entry.start <= range.end
      )
    }) ?? "10.144.144.0/24"
  )
}

function validateRange(
  value: string,
  existing: Array<{ name: string; ipv4Cidr: string }>
): FieldError | null {
  if (value.trim() === "") return "rangeRequired"
  const range = parseRange(value)
  if (!range) return "rangeInvalid"
  if (32 - Math.log2(range.end - range.start + 1) > 30) {
    return "rangeTooSmall"
  }
  if (!isPrivateRange(range.start)) return "rangeNotPrivate"
  for (const network of existing) {
    const other = parseRange(network.ipv4Cidr)
    if (!other) continue
    if (range.start <= other.end && other.start <= range.end) {
      return "rangeOverlap"
    }
  }
  return null
}

function NewNetworkWizard({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { config } = useAuth()
  const queryClient = useQueryClient()
  const [, navigate] = useLocation()
  const networksQuery = useListNetworks()
  const existing = networksQuery.data?.data ?? []

  const [step, setStep] = useState<1 | 2>(1)
  // `null` means "use the best suggestion", so the suggestion can follow the
  // network list when it finishes loading without a setState-in-effect.
  const [nameInput, setNameInput] = useState<string | null>(null)
  const [cidrInput, setCidrInput] = useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const reviewHeading = useRef<HTMLHeadingElement>(null)

  const suggestedName = config?.orgName
    ? t("newNetwork.suggestion", { org: config.orgName })
    : t("newNetwork.defaultSuggestion")
  const name = nameInput ?? suggestedName
  const cidr =
    cidrInput ?? suggestRange(existing.map((network) => network.ipv4Cidr))

  const rangeError = validateRange(cidr, existing)
  const nameError = name.trim() === "" ? "nameRequired" : null
  const canContinue = nameError === null && rangeError === null

  const overlappingName =
    rangeError === "rangeOverlap"
      ? existing.find((network) => {
          const range = parseRange(cidr)
          const other = parseRange(network.ipv4Cidr)
          return (
            range !== null &&
            other !== null &&
            range.start <= other.end &&
            other.start <= range.end
          )
        })?.name
      : undefined

  const createNetwork = useCreateNetwork({
    mutation: {
      onSuccess: async (response) => {
        toast.success(t("newNetwork.created"))
        await queryClient.invalidateQueries({
          queryKey: getListNetworksQueryKey(),
        })
        onOpenChange(false)
        navigate(`/networks/${response.data.id}?addDevice=1`)
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  useEffect(() => {
    if (step === 2) reviewHeading.current?.focus()
  }, [step])

  const errorText = (error: FieldError, fieldName?: string) =>
    t(`newNetwork.error.${error}`, { name: fieldName ?? overlappingName ?? "" })

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t("newNetwork.title")}</DialogTitle>
          <DialogDescription>{t("newNetwork.description")}</DialogDescription>
        </DialogHeader>

        <ol
          aria-label={t("newNetwork.stepLabel", { current: step, total: 2 })}
          className="flex items-center gap-2 text-xs font-medium"
        >
          {step === 1 ? (
            <li aria-current="step" className="text-foreground">
              1. {t("newNetwork.stepBasics")}
            </li>
          ) : (
            <li className="text-fg-3">1. {t("newNetwork.stepBasics")}</li>
          )}
          <li aria-hidden="true" className="h-px flex-1 bg-line" />
          {step === 2 ? (
            <li aria-current="step" className="text-foreground">
              2. {t("newNetwork.stepReview")}
            </li>
          ) : (
            <li className="text-fg-3">2. {t("newNetwork.stepReview")}</li>
          )}
        </ol>

        {step === 1 ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                className="text-[13px] font-medium"
                htmlFor="new-network-name"
              >
                {t("newNetwork.name")}
              </label>
              <Input
                aria-describedby={
                  nameError ? "new-network-name-error" : undefined
                }
                aria-invalid={nameError !== null}
                autoFocus
                id="new-network-name"
                maxLength={120}
                onChange={(event) => setNameInput(event.target.value)}
                placeholder={t("newNetwork.namePlaceholder")}
                value={name}
              />
              {nameError ? (
                <span
                  className="text-xs text-err"
                  id="new-network-name-error"
                  role="alert"
                >
                  {errorText(nameError)}
                </span>
              ) : (
                <span className="text-xs text-fg-3">
                  {t("newNetwork.nameHint")}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                className="text-[13px] font-medium"
                htmlFor="new-network-range"
              >
                {t("newNetwork.range")}
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  aria-describedby={
                    rangeError ? "new-network-range-error" : undefined
                  }
                  aria-invalid={rangeError !== null}
                  className="font-mono sm:flex-1"
                  id="new-network-range"
                  onChange={(event) => setCidrInput(event.target.value)}
                  value={cidr}
                />
                <Button
                  className="max-sm:w-full"
                  onClick={() =>
                    setCidrInput(
                      suggestRange(
                        existing.map((network) => network.ipv4Cidr),
                        cidr
                      )
                    )
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <SparklesIcon className="size-4" />
                  {t("newNetwork.suggest")}
                </Button>
              </div>
              {rangeError ? (
                <span
                  className="text-xs text-err"
                  id="new-network-range-error"
                  role="alert"
                >
                  {errorText(rangeError, overlappingName)}
                </span>
              ) : (
                <span className="text-xs text-fg-3">
                  {t("newNetwork.rangeHint")}
                </span>
              )}
            </div>

            <div className="overflow-hidden rounded-lg ring-1 ring-line">
              <button
                aria-expanded={advancedOpen}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => setAdvancedOpen((current) => !current)}
                type="button"
              >
                <ChevronDownIcon
                  aria-hidden="true"
                  className={`size-4 text-fg-3 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                />
                {t("newNetwork.advanced")}
              </button>
              {advancedOpen ? (
                <div className="border-t border-line px-3 py-3">
                  <dl className="grid gap-2 text-xs">
                    <div>
                      <dt className="text-fg-3">
                        {t("newNetwork.networkName")}
                      </dt>
                      <dd className="font-mono">{t("newNetwork.generated")}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-3">{t("newNetwork.secret")}</dt>
                      <dd className="font-mono">{t("newNetwork.generated")}</dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-xs text-fg-3">
                    {t("newNetwork.advancedHint")}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <h3
                className="text-[15px] font-semibold outline-none"
                ref={reviewHeading}
                tabIndex={-1}
              >
                {t("newNetwork.reviewTitle")}
              </h3>
              <p className="mt-0.5 text-xs text-fg-3">
                {t("newNetwork.reviewHint")}
              </p>
            </div>
            <dl className="overflow-hidden rounded-lg ring-1 ring-line">
              <div className="flex items-start gap-3 border-b border-line px-3 py-2.5">
                <dt className="w-28 flex-none text-xs text-fg-3">
                  {t("newNetwork.name")}
                </dt>
                <dd className="min-w-0 text-[13px] font-medium break-words">
                  {name.trim()}
                </dd>
              </div>
              <div className="flex items-start gap-3 border-b border-line px-3 py-2.5">
                <dt className="w-28 flex-none text-xs text-fg-3">
                  {t("newNetwork.range")}
                </dt>
                <dd className="min-w-0 font-mono text-[13px]">{cidr.trim()}</dd>
              </div>
              <div className="flex items-start gap-3 px-3 py-2.5">
                <dt className="w-28 flex-none text-xs text-fg-3">
                  {t("newNetwork.networkName")}
                </dt>
                <dd className="min-w-0 text-[13px] break-words">
                  {t("newNetwork.generated")}
                </dd>
              </div>
              <div className="flex items-start gap-3 border-t border-line px-3 py-2.5">
                <dt className="w-28 flex-none text-xs text-fg-3">
                  {t("newNetwork.secret")}
                </dt>
                <dd className="min-w-0 text-[13px] break-words">
                  {t("newNetwork.generated")}
                </dd>
              </div>
            </dl>
          </div>
        )}

        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            {t("common.cancel")}
          </Button>
          {step === 2 ? (
            <Button
              disabled={createNetwork.isPending}
              onClick={() => setStep(1)}
              type="button"
              variant="ghost"
            >
              {t("newNetwork.back")}
            </Button>
          ) : null}
          {step === 1 ? (
            <Button
              disabled={!canContinue}
              onClick={() => setStep(2)}
              type="button"
            >
              {t("newNetwork.next")}
            </Button>
          ) : (
            <Button
              disabled={createNetwork.isPending || !canContinue}
              onClick={() =>
                createNetwork.mutate({
                  data: { name: name.trim(), ipv4Cidr: cidr.trim() },
                })
              }
              type="button"
            >
              {createNetwork.isPending
                ? t("common.loading")
                : t("newNetwork.create")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Suggestion needs the organisation name from /api/config; the wizard reads
// it from the auth context once when it mounts.
export function NewNetworkDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  // Mounting only while open resets the wizard and lets suggestions use the
  // network list that is already in the cache.
  if (!open) return null
  return <NewNetworkWizard onOpenChange={onOpenChange} open={open} />
}
