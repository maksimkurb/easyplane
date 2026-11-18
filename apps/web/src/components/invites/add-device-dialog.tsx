import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { QRCodeSVG } from "qrcode.react"
import {
  CheckIcon,
  CopyIcon,
  InfoIcon,
  LinkIcon,
  MonitorIcon,
  RouterIcon,
  ShieldIcon,
  SmartphoneIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  getGetNetworkQueryKey,
  getListDevicesQueryKey,
  getListInvitesQueryKey,
  useApproveDevice,
  useCreateInvite,
  useListDevices,
} from "@/api/generated/easyplane"
import type { CreateInvite201, GetNetwork200 } from "@/api/generated/model"
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Segmented } from "@/components/ui/segmented"
import { Sheet, SheetContent, SheetHeader } from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"
import { buildInviteUrl } from "@/lib/invite-command"
import { cn } from "@/lib/utils"
import { useQueryClient } from "@tanstack/react-query"

type Uses = "1" | "5" | "unlimited" | "custom"
type Expiry = "1d" | "7d" | "never" | "custom"
type DeviceType = "computer" | "router" | "phone"
type Platform = "native" | "docker"
type Step = 1 | 2

// Linux, macOS and Windows run the same command; only Docker differs.
const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "native", label: "Linux · macOS · Windows" },
  { id: "docker", label: "Docker" },
]

const MAX_EXPIRY_HOURS = 8760
const MAX_USES = 10000

function localDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function hoursFromLocal(value: string): number {
  const time = Date.parse(value)
  if (Number.isNaN(time)) return Number.NaN
  return Math.ceil((time - Date.now()) / 3_600_000)
}

/**
 * Two-step add-device flow. Step 1 asks what the device is and how the invite
 * may be used; step 2 shows only the instructions that device needs and waits
 * for it to connect. Nothing is rendered before the invite exists, so there
 * are no placeholder commands or empty QR codes.
 */
export function AddDeviceDialog({
  network,
  open,
  onOpenChange,
}: {
  network: GetNetwork200
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const { config, canManage } = useAuth()
  const queryClient = useQueryClient()
  const isPhone = useIsMobile(640)
  const compact = useIsMobile(821)
  const baseUrl = config?.publicConfigServerUrl ?? window.location.origin
  const credentialsMode = network.access.mode === "credentials"

  const [step, setStep] = useState<Step>(1)
  const [deviceType, setDeviceType] = useState<DeviceType>("computer")
  const [installed, setInstalled] = useState<"yes" | "no">("yes")
  const [platform, setPlatform] = useState<Platform>("native")
  const [label, setLabel] = useState("")
  const [uses, setUses] = useState<Uses>("1")
  const [customUses, setCustomUses] = useState("25")
  const [expiry, setExpiry] = useState<Expiry>("7d")
  const [customExpiry, setCustomExpiry] = useState(() =>
    localDateTimeValue(new Date(Date.now() + 7 * 86_400_000))
  )
  const [expiresInHours, setExpiresInHours] = useState<number | null>(168)
  const [role, setRole] = useState<"anchor" | "member">(
    credentialsMode && network.access.anchors === 0 ? "anchor" : "member"
  )
  const [created, setCreated] = useState<CreateInvite201 | null>(null)
  const [approvedId, setApprovedId] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [optionsExpanded, setOptionsExpanded] = useState<boolean | null>(null)
  const optionsOpen = optionsExpanded ?? !compact
  const stepLabelRef = useRef<HTMLParagraphElement>(null)
  const previousStep = useRef(step)

  // Move focus to the step label when the dialog advances, so keyboard and
  // screen-reader users are told that the content changed.
  useEffect(() => {
    if (previousStep.current === step) return
    previousStep.current = step
    stepLabelRef.current?.focus()
  }, [step])

  const maxUses = useMemo(() => {
    if (uses === "unlimited") return null
    if (uses === "custom") return Number(customUses)
    return Number(uses)
  }, [uses, customUses])

  const usesInvalid =
    uses === "custom" &&
    (!Number.isInteger(maxUses) ||
      (maxUses ?? 0) < 1 ||
      (maxUses ?? 0) > MAX_USES)
  const expiryInvalid =
    expiry === "custom" &&
    (!Number.isFinite(expiresInHours) ||
      (expiresInHours ?? 0) < 1 ||
      (expiresInHours ?? 0) > MAX_EXPIRY_HOURS)

  const createInvite = useCreateInvite({
    mutation: {
      onSuccess: (response) => {
        setCreated(response.data)
        setStep(2)
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const approve = useApproveDevice({
    mutation: {
      onSuccess: async () => {
        toast.success(t("addDevice.joinedApproved"))
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListDevicesQueryKey() }),
          queryClient.invalidateQueries({
            queryKey: getGetNetworkQueryKey(network.id),
          }),
          queryClient.invalidateQueries({
            queryKey: getListInvitesQueryKey(network.id),
          }),
        ])
      },
      onError: (error) => {
        setApprovedId(null)
        toast.error(error instanceof Error ? error.message : t("common.error"))
      },
    },
  })

  // Step 2 keeps listening for a device that presents this invite. Realtime
  // events also invalidate this query, so approval shows up everywhere.
  const devicesQuery = useListDevices(
    { networkId: network.id },
    {
      query: {
        enabled: created !== null && step === 2,
        refetchInterval: created !== null && step === 2 ? 4000 : false,
      },
    }
  )
  const joinedDevice = (devicesQuery.data?.data ?? []).find(
    (device) => device.state === "pending"
  )
  const approvedDevice = approvedId
    ? (devicesQuery.data?.data ?? []).find((device) => device.id === approvedId)
    : undefined

  const url = created ? buildInviteUrl(baseUrl, created.token) : ""
  const command = created ? `easytier-core --config-server ${url}` : ""
  const dockerCommand = created
    ? `docker run -d --name easytier --restart unless-stopped --network host --cap-add NET_ADMIN --device /dev/net/tun easytier/easytier:latest --config-server ${url}`
    : ""

  const usesLabel =
    uses === "unlimited"
      ? t("addDevice.anyNumber")
      : uses === "1"
        ? t("addDevice.oneDevice")
        : t("addDevice.upTo", { count: maxUses })
  const expiryLabel =
    expiry === "never"
      ? t("addDevice.neverExpires")
      : expiry === "custom"
        ? t("addDevice.expiresOn", {
            when: new Date(customExpiry).toLocaleString(i18n.language, {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            }),
          })
        : expiry === "1d"
          ? t("addDevice.expiresIn", { duration: t("addDevice.oneDay") })
          : t("addDevice.expiresIn", { duration: t("addDevice.sevenDays") })
  const summary = `${usesLabel} · ${expiryLabel}`

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      window.setTimeout(
        () => setCopied((current) => (current === key ? null : current)),
        1500
      )
    } catch {
      // Clipboard is unavailable on insecure origins.
    }
  }

  const pickExpiry = (value: Expiry) => {
    if (created) return
    setExpiry(value)
    if (value === "never") setExpiresInHours(null)
    else if (value === "1d") setExpiresInHours(24)
    else if (value === "7d") setExpiresInHours(168)
    else setExpiresInHours(hoursFromLocal(customExpiry))
  }

  const pickCustomExpiry = (value: string) => {
    setCustomExpiry(value)
    setExpiresInHours(hoursFromLocal(value))
  }

  const close = () => {
    onOpenChange(false)
    // The token exists only in this dialog; reopening starts a fresh invite.
    window.setTimeout(() => {
      setStep(1)
      setCreated(null)
      setApprovedId(null)
      setLabel("")
      setOptionsExpanded(null)
    }, 200)
  }

  const reset = () => {
    setCreated(null)
    setApprovedId(null)
    setStep(1)
  }

  const create = () =>
    createInvite.mutate({
      networkId: network.id,
      data: {
        ...(label.trim() ? { label: label.trim() } : {}),
        maxUses,
        expiresInHours:
          expiresInHours !== null && Number.isFinite(expiresInHours)
            ? expiresInHours
            : null,
        ...(credentialsMode ? { role } : {}),
      },
    })

  const approveJoined = () => {
    if (!joinedDevice) return
    setApprovedId(joinedDevice.id)
    approve.mutate({ deviceId: joinedDevice.id, data: {} })
  }

  const footer =
    step === 1 ? (
      <>
        <span className="mr-auto hidden self-center text-xs text-fg-3 sm:block">
          {summary}
        </span>
        <Button
          className="max-sm:w-full"
          onClick={close}
          type="button"
          variant="ghost"
        >
          {t("common.cancel")}
        </Button>
        <Button
          className="max-sm:w-full"
          disabled={createInvite.isPending || usesInvalid || expiryInvalid}
          onClick={create}
          type="button"
        >
          {createInvite.isPending ? t("common.loading") : t("addDevice.create")}
        </Button>
      </>
    ) : (
      <>
        <span className="mr-auto hidden self-center text-xs text-fg-3 sm:block">
          {summary}
        </span>
        <Button
          className="max-sm:w-full"
          onClick={reset}
          type="button"
          variant="outline"
        >
          {t("addDevice.createAnother")}
        </Button>
        <Button className="max-sm:w-full" onClick={close} type="button">
          {t("common.done")}
        </Button>
      </>
    )

  const optionsPanel = (
    <aside
      aria-label={t("addDevice.inviteOptions")}
      className={cn(
        "flex flex-col rounded-xl bg-surface-2 ring-1 ring-line",
        compact && !optionsOpen ? "p-0" : "gap-4 p-4 sm:p-5"
      )}
    >
      {compact ? (
        <button
          aria-expanded={optionsOpen}
          className={cn(
            "flex min-h-16 w-full cursor-pointer items-center gap-3 px-4 text-left focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
            optionsOpen && "border-b border-line"
          )}
          onClick={() => setOptionsExpanded(!optionsOpen)}
          type="button"
        >
          <LinkIcon aria-hidden="true" className="size-4 flex-none text-fg-3" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">
              {label.trim() || t("addDevice.inviteOptions")}
            </span>
            <span className="block truncate text-xs text-fg-3">{summary}</span>
          </span>
          <span className="flex-none text-[13px] font-medium text-brand-text">
            {optionsOpen ? t("common.done") : t("addDevice.change")}
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <LinkIcon aria-hidden="true" className="size-4 text-fg-3" />
          <span className="font-medium">{t("addDevice.optionsHeading")}</span>
        </div>
      )}

      {optionsOpen ? (
        <div
          className={cn(
            "flex flex-col gap-4",
            compact && "p-4 pt-3 sm:p-5 sm:pt-4"
          )}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">
              {t("invites.label")}
            </span>
            <input
              className="h-10 w-full rounded-lg border border-line-2 bg-card px-3 text-sm outline-none focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand-soft"
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t("addDevice.labelPlaceholder")}
              value={label}
            />
            <span className="text-xs text-fg-3">
              {t("addDevice.labelHint")}
            </span>
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">
              {t("addDevice.canBeUsed")}
            </span>
            <Segmented
              fill
              label={t("addDevice.canBeUsed")}
              onValueChange={(value) => !created && setUses(value)}
              options={[
                { value: "1", label: "1" },
                { value: "5", label: "5" },
                { value: "unlimited", label: t("addDevice.noLimit") },
                { value: "custom", label: t("addDevice.custom") },
              ]}
              value={uses}
            />
            {uses === "custom" ? (
              <div className="flex items-center gap-2">
                <input
                  aria-label={t("addDevice.customUses")}
                  className="h-10 w-24 rounded-lg border border-line-2 bg-card px-3 font-mono text-sm outline-none focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand-soft"
                  inputMode="numeric"
                  min={1}
                  onChange={(event) => setCustomUses(event.target.value)}
                  type="number"
                  value={customUses}
                />
                <span className="text-sm text-fg-2">
                  {t("addDevice.devices")}
                </span>
              </div>
            ) : null}
            <span className="text-xs text-fg-3">
              {usesInvalid
                ? t("addDevice.customUsesHint")
                : uses === "1"
                  ? t("addDevice.usesOneHint")
                  : uses === "unlimited"
                    ? t("addDevice.usesUnlimitedHint")
                    : t("addDevice.usesHint", { count: maxUses })}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">
              {t("addDevice.expires")}
            </span>
            <Segmented
              fill
              label={t("addDevice.expires")}
              onValueChange={pickExpiry}
              options={[
                { value: "1d", label: t("addDevice.oneDay") },
                { value: "7d", label: t("addDevice.sevenDays") },
                { value: "never", label: t("addDevice.never") },
                { value: "custom", label: t("addDevice.custom") },
              ]}
              value={expiry}
            />
            {expiry === "custom" ? (
              <div className="flex flex-col gap-1">
                <input
                  aria-label={t("addDevice.customExpiry")}
                  className="h-10 w-full rounded-lg border border-line-2 bg-card px-3 text-sm outline-none focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand-soft"
                  onChange={(event) => pickCustomExpiry(event.target.value)}
                  type="datetime-local"
                  value={customExpiry}
                />
                <span className="text-xs text-fg-3">
                  {expiryInvalid
                    ? t("addDevice.customExpiryHint")
                    : t("addDevice.customExpiryNote")}
                </span>
              </div>
            ) : null}
          </div>

          {credentialsMode ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">
                {t("access.inviteRole")}
              </span>
              <Segmented
                fill
                label={t("access.inviteRole")}
                onValueChange={(value) => !created && setRole(value)}
                options={[
                  { value: "anchor", label: t("access.anchorBadge") },
                  { value: "member", label: t("access.memberBadge") },
                ]}
                value={role}
              />
              <span className="text-xs text-fg-3">
                {role === "anchor"
                  ? t("access.inviteAnchorHint")
                  : t("access.inviteMemberHint")}
              </span>
            </div>
          ) : null}

          <div className="h-px bg-line" />
          <p className="flex items-start gap-2 text-xs text-fg-3">
            <ShieldIcon
              aria-hidden="true"
              className="mt-0.5 size-3.5 flex-none"
            />
            <span>{t("addDevice.approvalExplain")}</span>
          </p>
        </div>
      ) : null}
    </aside>
  )

  const stepOne = (
    <div className="grid items-start gap-5 min-[821px]:grid-cols-[minmax(0,1fr)_minmax(0,300px)] min-[821px]:gap-6">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">
            {t("addDevice.deviceTypeLabel")}
          </span>
          <RadioGroup
            aria-label={t("addDevice.deviceTypeLabel")}
            className="grid-cols-1 gap-2 min-[520px]:grid-cols-3"
            onValueChange={(value) => setDeviceType(value as DeviceType)}
            value={deviceType}
          >
            <DeviceTypeCard
              hint={t("addDevice.typeComputerHint")}
              icon={<MonitorIcon className="size-4" />}
              label={t("addDevice.typeComputer")}
              value="computer"
            />
            <DeviceTypeCard
              hint={t("addDevice.typeRouterHint")}
              icon={<RouterIcon className="size-4" />}
              label={t("addDevice.typeRouter")}
              value="router"
            />
            <DeviceTypeCard
              hint={t("addDevice.typePhoneHint")}
              icon={<SmartphoneIcon className="size-4" />}
              label={t("addDevice.typePhone")}
              value="phone"
            />
          </RadioGroup>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">
            {t("addDevice.installedLabel")}
          </span>
          <Segmented
            fill
            label={t("addDevice.installedLabel")}
            onValueChange={(value) => setInstalled(value)}
            options={[
              { value: "yes", label: t("addDevice.installedYes") },
              { value: "no", label: t("addDevice.installedNo") },
            ]}
            value={installed}
          />
          <span className="text-xs text-fg-3">
            {installed === "yes"
              ? t("addDevice.installedYesHint")
              : t("addDevice.installedNoHint")}
          </span>
        </div>

        {installed === "no" && deviceType !== "phone" ? (
          <div className="flex items-start gap-3 rounded-xl bg-warn-soft px-4 py-3 ring-1 ring-warn-line">
            <InfoIcon
              aria-hidden="true"
              className="mt-0.5 size-4 flex-none text-warn"
            />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-warn">
                {t("addDevice.installUnavailableTitle")}
              </p>
              <p className="mt-0.5 text-xs text-fg-2">
                {t("addDevice.installUnavailableBody")}
              </p>
              <a
                className="mt-2 inline-flex h-8 items-center rounded-lg bg-card px-3 text-[13px] font-medium ring-1 ring-line-2 hover:bg-surface-2"
                href="https://github.com/EasyTier/EasyTier/releases"
                rel="noreferrer"
                target="_blank"
              >
                {t("addDevice.openReleases")}
              </a>
            </div>
          </div>
        ) : null}
      </div>

      {optionsPanel}
    </div>
  )

  const resultBlock = (
    <div className="flex min-w-0 flex-col gap-4">
      {installed === "no" && deviceType !== "phone" ? (
        <div className="flex items-start gap-3 rounded-xl bg-warn-soft px-4 py-3 ring-1 ring-warn-line">
          <InfoIcon
            aria-hidden="true"
            className="mt-0.5 size-4 flex-none text-warn"
          />
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-warn">
              {t("addDevice.installUnavailableTitle")}
            </p>
            <p className="mt-0.5 text-xs text-fg-2">
              {t("addDevice.installUnavailableBody")}
            </p>
            <a
              className="mt-2 inline-flex h-8 items-center rounded-lg bg-card px-3 text-[13px] font-medium ring-1 ring-line-2 hover:bg-surface-2"
              href="https://github.com/EasyTier/EasyTier/releases"
              rel="noreferrer"
              target="_blank"
            >
              {t("addDevice.openReleases")}
            </a>
          </div>
        </div>
      ) : null}
      {deviceType === "phone" ? (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] font-medium">
            {t("addDevice.resultPhone")}
          </p>
          <Step number={1}>
            <span className="flex-1">{t("addDevice.phoneStepInstall")}</span>
            <a
              className="inline-flex h-9 flex-none items-center gap-2 rounded-lg bg-card px-3 text-[13px] font-medium ring-1 ring-line-2 hover:bg-surface-2 max-sm:h-11"
              href="https://github.com/EasyTier/EasyTier/releases"
              rel="noreferrer"
              target="_blank"
            >
              {t("addDevice.getEasyTier")}
            </a>
          </Step>
          <Step number={2}>
            <div className="flex flex-1 flex-col gap-2">
              <span>{t("addDevice.phoneStepScan")}</span>
              <div
                aria-label={t("addDevice.qrLabel")}
                className="grid size-[132px] place-items-center rounded-[10px] bg-white p-2 ring-1 ring-line"
                role="img"
              >
                <QRCodeSVG size={116} value={url} />
              </div>
            </div>
          </Step>
          <Field label={t("addDevice.phoneOrLink")}>
            <CodeRow
              copied={copied === "url"}
              onCopy={() => void copy(url, "url")}
              value={url}
            />
          </Field>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {deviceType === "computer" ? (
            <div className="-mx-1 max-w-full [scrollbar-width:none] overflow-x-auto px-1 [&::-webkit-scrollbar]:hidden">
              <Segmented
                label={t("addDevice.platformLabel")}
                onValueChange={setPlatform}
                options={PLATFORMS.map((entry) => ({
                  value: entry.id,
                  label: entry.label,
                }))}
                value={platform}
              />
            </div>
          ) : null}
          <Field
            label={
              deviceType === "router"
                ? t("addDevice.resultRouter")
                : t("addDevice.resultComputer")
            }
          >
            <CodeRow
              copied={copied === "command"}
              onCopy={() =>
                void copy(
                  platform === "docker" ? dockerCommand : command,
                  "command"
                )
              }
              value={platform === "docker" ? dockerCommand : command}
            />
            <p className="text-xs text-fg-3">
              {deviceType === "router"
                ? t("addDevice.routerNote")
                : platform === "docker"
                  ? t("addDevice.dockerHint")
                  : t("addDevice.commandHint")}
            </p>
          </Field>
        </div>
      )}

      <div className="flex items-start gap-3 rounded-xl bg-warn-soft px-4 py-2.5 ring-1 ring-warn-line">
        <InfoIcon
          aria-hidden="true"
          className="mt-0.5 size-4 flex-none text-warn"
        />
        <p className="text-[13px] text-fg-2">{t("addDevice.tokenWarning")}</p>
      </div>

      <div
        aria-live="polite"
        className="min-h-[76px] rounded-xl bg-surface-2 px-4 py-3 ring-1 ring-line"
      >
        {approvedDevice || approvedId ? (
          <div className="flex items-start gap-2.5">
            <CheckIcon
              aria-hidden="true"
              className="mt-0.5 size-4 flex-none text-ok"
            />
            <div className="min-w-0">
              <p className="text-[13px] font-medium">
                {t("addDevice.stepDone")}
              </p>
              <p className="mt-0.5 text-xs text-fg-3">
                {t("addDevice.joinedApproved")}
              </p>
            </div>
          </div>
        ) : joinedDevice ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">
                {t("addDevice.joinedTitle")}
              </p>
              <p className="mt-0.5 text-xs break-words text-fg-3">
                {t("addDevice.joinedBody", {
                  hostname:
                    joinedDevice.dnsName ??
                    joinedDevice.hostname ??
                    joinedDevice.machineId.slice(0, 8),
                })}
              </p>
            </div>
            {canManage ? (
              <Button
                disabled={approve.isPending}
                onClick={approveJoined}
                size="sm"
                type="button"
              >
                {t("addDevice.joinedApprove")}
              </Button>
            ) : (
              <p className="text-xs text-fg-3">
                {t("addDevice.joinedAskAdmin")}
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-1 size-2.5 flex-none animate-pulse rounded-full bg-brand"
            />
            <div className="min-w-0">
              <p className="text-[13px] font-medium">
                {t("addDevice.waitingTitle")}
              </p>
              <p className="mt-0.5 text-xs text-fg-3">
                {t("addDevice.waitingHint")}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  const content =
    step === 1 ? (
      stepOne
    ) : (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 rounded-lg bg-ok-soft px-3 py-2 text-[13px] text-ok ring-1 ring-line">
          <CheckIcon aria-hidden="true" className="size-4 flex-none" />
          <span className="min-w-0">
            {t("addDevice.inviteLink")}
            {label.trim() ? ` · ${label.trim()}` : ""}
          </span>
        </div>
        {resultBlock}
      </div>
    )

  const header = (
    <>
      <DialogTitle className="text-lg leading-7">
        {t("addDevice.title", { network: network.name })}
      </DialogTitle>
      <DialogDescription>
        {step === 1 ? t("addDevice.description") : t("addDevice.resultTitle")}
      </DialogDescription>
      <p
        className="text-xs font-medium text-fg-3 outline-none"
        ref={stepLabelRef}
        tabIndex={-1}
      >
        {t("addDevice.stepLabel", { current: step })}
      </p>
    </>
  )

  if (isPhone) {
    return (
      <Sheet
        onOpenChange={(next) => (next ? onOpenChange(true) : close())}
        open={open}
      >
        <SheetContent
          className="max-h-[92dvh] gap-0 p-0 data-[side=bottom]:rounded-t-2xl"
          showCloseButton={false}
          side="bottom"
        >
          <div className="flex flex-none flex-col gap-1 px-4 pt-2 pb-3">
            <div
              aria-hidden="true"
              className="mx-auto mb-2 h-[5px] w-10 rounded-full bg-line-2"
            />
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <SheetHeader className="gap-1 p-0">{header}</SheetHeader>
              </div>
              <Button
                aria-label={t("common.close")}
                onClick={close}
                size="icon-sm"
                variant="ghost"
              >
                <XIcon className="size-4" />
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {content}
          </div>
          <div className="flex flex-none items-center gap-2 border-t border-line bg-card px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
            {footer}
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      open={open}
    >
      <DialogContent size="lg">
        <DialogHeader>{header}</DialogHeader>
        {content}
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeviceTypeCard({
  value,
  label,
  hint,
  icon,
}: {
  value: DeviceType
  label: string
  hint: string
  icon: React.ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line-2 bg-card p-3 transition-colors hover:bg-surface-2 has-[[data-checked]]:border-brand has-[[data-checked]]:bg-brand-soft">
      <RadioGroupItem className="mt-0.5" value={value} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm leading-5 font-medium">
          {icon}
          {label}
        </span>
        <span className="mt-0.5 block text-xs leading-4 text-fg-3">{hint}</span>
      </span>
    </label>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      {children}
    </div>
  )
}

function CodeRow({
  value,
  onCopy,
  copied,
}: {
  value: string
  onCopy: () => void
  copied: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-stretch gap-2">
      <code className="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2.5 font-mono text-xs leading-5 break-all ring-1 ring-line">
        {value}
      </code>
      <Button
        aria-label={t("common.copy")}
        className="h-auto min-h-10 flex-none"
        onClick={onCopy}
        size="icon"
        type="button"
        variant="outline"
      >
        {copied ? (
          <CheckIcon className="size-4 text-ok" />
        ) : (
          <CopyIcon className="size-4" />
        )}
      </Button>
    </div>
  )
}

function Step({
  number,
  children,
}: {
  number: number
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-6 flex-none place-items-center rounded-full bg-surface-2 text-xs font-medium text-fg-2 ring-1 ring-line">
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
        {children}
      </div>
    </div>
  )
}

// The dialog relies on the shared query cache: approving a device invalidates
// the device, network and invite queries so every open view (including the
// approvals panel behind the dialog) refreshes.
