import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { QRCodeSVG } from "qrcode.react"
import { CheckIcon, CopyIcon, InfoIcon, LinkIcon, ShieldIcon } from "lucide-react"
import { toast } from "sonner"

import { useCreateInvite } from "@/api/generated/easyplane"
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
import { Segmented } from "@/components/ui/segmented"
import { buildInviteUrl } from "@/lib/invite-command"


type Uses = "1" | "5" | "unlimited" | "custom"
type Expiry = "1d" | "7d" | "never" | "custom"
type Mode = "join" | "install"
type Platform = "linux" | "macos" | "windows" | "docker" | "android"

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "linux", label: "Linux" },
  { id: "macos", label: "macOS" },
  { id: "windows", label: "Windows" },
  { id: "docker", label: "Docker" },
  { id: "android", label: "Android" },
]

const MAX_EXPIRY_HOURS = 8760
const MAX_USES = 10000

function localDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Add-device dialog. The left column is the invite (label, uses, expiry); the
 * right column is what the operator does on the device: join with a command or
 * install first. The API only exposes the fields used here.
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
  const { config } = useAuth()
  const baseUrl = config?.publicConfigServerUrl ?? window.location.origin
  const credentialsMode = network.access.mode === "credentials"

  const [label, setLabel] = useState("")
  const [uses, setUses] = useState<Uses>("1")
  const [customUses, setCustomUses] = useState("25")
  const [expiry, setExpiry] = useState<Expiry>("7d")
  const [customExpiry, setCustomExpiry] = useState(() =>
    localDateTimeValue(new Date(Date.now() + 7 * 86_400_000))
  )
  const [role, setRole] = useState<"anchor" | "member">(
    credentialsMode && network.access.anchors === 0 ? "anchor" : "member"
  )
  const [mode, setMode] = useState<Mode>("join")
  const [platform, setPlatform] = useState<Platform>("linux")
  const [created, setCreated] = useState<CreateInvite201 | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const maxUses = useMemo(() => {
    if (uses === "unlimited") return null
    if (uses === "custom") return Number(customUses)
    return Number(uses)
  }, [uses, customUses])

  // Computed in event handlers, not during render: Date.now() is impure and
  // the compiler (rightly) refuses it in the render path.
  const [expiresInHours, setExpiresInHours] = useState<number | null>(168)

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

  const usesInvalid =
    uses === "custom" &&
    (!Number.isInteger(maxUses) || (maxUses ?? 0) < 1 || (maxUses ?? 0) > MAX_USES)
  const expiryInvalid =
    expiry === "custom" &&
    (!Number.isFinite(expiresInHours) ||
      (expiresInHours ?? 0) < 1 ||
      (expiresInHours ?? 0) > MAX_EXPIRY_HOURS)

  const createInvite = useCreateInvite({
    mutation: {
      onSuccess: (response) => setCreated(response.data),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

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

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500)
    } catch {
      // Clipboard is unavailable on insecure origins.
    }
  }

  const close = () => {
    onOpenChange(false)
    // The token is only valid for this session's toast; reset on close so a
    // reopened dialog starts a fresh invite instead of showing a stale token.
    window.setTimeout(() => {
      setCreated(null)
      setLabel("")
    }, 200)
  }

  return (
    <Dialog onOpenChange={(next) => (next ? onOpenChange(true) : close())} open={open}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="text-lg leading-7">
            {t("addDevice.title", { network: network.name })}
          </DialogTitle>
          <DialogDescription>{t("addDevice.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid items-start gap-5 sm:grid-cols-[minmax(0,272px)_minmax(0,1fr)] sm:gap-6">
          <aside
            aria-label={t("addDevice.inviteLink")}
            className="flex flex-col gap-4 rounded-xl bg-surface-2 p-4 ring-1 ring-line sm:p-5"
          >
            <div className="flex items-center gap-2">
              <LinkIcon aria-hidden="true" className="size-4 text-fg-3" />
              <span className="font-medium">{t("addDevice.inviteLink")}</span>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">{t("invites.label")}</span>
              <input
                className="h-10 w-full rounded-lg border border-line-2 bg-card px-3 text-sm outline-none focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand-soft"
                disabled={created !== null}
                onChange={(event) => setLabel(event.target.value)}
                value={label}
              />
              <span className="text-xs text-fg-3">{t("addDevice.labelHint")}</span>
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">{t("addDevice.canBeUsed")}</span>
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
                    disabled={created !== null}
                    inputMode="numeric"
                    min={1}
                    onChange={(event) => setCustomUses(event.target.value)}
                    type="number"
                    value={customUses}
                  />
                  <span className="text-sm text-fg-2">{t("addDevice.devices")}</span>
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
              <span className="text-[13px] font-medium">{t("addDevice.expires")}</span>
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
                    disabled={created !== null}
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
                <span className="text-[13px] font-medium">{t("access.inviteRole")}</span>
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
                  {role === "anchor" ? t("access.inviteAnchorHint") : t("access.inviteMemberHint")}
                </span>
              </div>
            ) : null}

            <div className="h-px bg-line" />
            <p className="flex items-start gap-2 text-xs text-fg-3">
              <ShieldIcon aria-hidden="true" className="mt-0.5 size-3.5 flex-none" />
              <span>{t("addDevice.approvalNote")}</span>
            </p>
          </aside>

          <div className="flex min-w-0 flex-col gap-4">
            <div aria-label={t("addDevice.modeLabel")} className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup">
              <ModeCard
                active={mode === "join"}
                hint={t("addDevice.joinHint")}
                label={t("addDevice.join")}
                onClick={() => setMode("join")}
              />
              <ModeCard
                active={mode === "install"}
                hint={t("addDevice.installHint")}
                label={t("addDevice.install")}
                onClick={() => setMode("install")}
              />
            </div>

            {mode === "join" ? (
              <div className="flex flex-col gap-4">
                <Field label={t("addDevice.runOnDevice")}>
                  <CodeRow
                    copied={copied === "command"}
                    disabled={!created}
                    onCopy={() => void copy(command, "command")}
                    value={command || t("addDevice.createFirst")}
                  />
                  <p className="text-xs text-fg-3">{t("addDevice.commandHint")}</p>
                </Field>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div
                    aria-label={t("addDevice.qrLabel")}
                    className="grid size-[112px] flex-none place-items-center rounded-[10px] bg-white p-1.5 ring-1 ring-line"
                    role="img"
                  >
                    {created ? (
                      <QRCodeSVG size={100} value={url} />
                    ) : (
                      <span className="text-center text-[10px] text-[#16181d]">
                        {t("addDevice.qrPlaceholder")}
                      </span>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="text-[13px] font-medium">{t("addDevice.inApp")}</span>
                    <p className="-mt-0.5 text-xs text-fg-3">{t("addDevice.inAppHint")}</p>
                    <CodeRow
                      copied={copied === "url"}
                      disabled={!created}
                      onCopy={() => void copy(url, "url")}
                      value={url || t("addDevice.createFirst")}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <Segmented
                  className="max-w-full self-start overflow-x-auto"
                  label={t("addDevice.platformLabel")}
                  onValueChange={setPlatform}
                  options={PLATFORMS.map((entry) => ({
                    value: entry.id,
                    label: entry.label,
                  }))}
                  value={platform}
                />

                {platform === "android" ? (
                  <div className="flex flex-col gap-3">
                    <Step number={1}>
                      <span className="flex-1">{t("addDevice.androidStep1")}</span>
                      <a
                        className="inline-flex h-9 flex-none items-center gap-2 rounded-lg bg-card px-3 text-[13px] font-medium ring-1 ring-line-2 hover:bg-surface-2"
                        href="https://github.com/EasyTier/EasyTier/releases"
                        rel="noreferrer"
                        target="_blank"
                      >
                        {t("addDevice.getEasyTier")}
                      </a>
                    </Step>
                    <Step number={2}>
                      <div className="flex flex-1 flex-col gap-2">
                        <span>{t("addDevice.androidStep2")}</span>
                        <div
                          aria-label={t("addDevice.qrLabel")}
                          className="grid size-[112px] place-items-center rounded-[10px] bg-white p-1.5 ring-1 ring-line"
                          role="img"
                        >
                          {created ? (
                            <QRCodeSVG size={100} value={url} />
                          ) : (
                            <span className="text-center text-[10px] text-[#16181d]">
                              {t("addDevice.qrPlaceholder")}
                            </span>
                          )}
                        </div>
                      </div>
                    </Step>
                  </div>
                ) : null}

                {platform === "docker" ? (
                  <Field label={t("addDevice.runOnHost")}>
                    <CodeRow
                      copied={copied === "docker"}
                      disabled={!created}
                      onCopy={() => void copy(dockerCommand, "docker")}
                      value={dockerCommand || t("addDevice.createFirst")}
                    />
                    <p className="text-xs text-fg-3">{t("addDevice.dockerHint")}</p>
                  </Field>
                ) : null}

                {platform !== "android" && platform !== "docker" ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start gap-3 rounded-xl bg-warn-soft px-4 py-3 ring-1 ring-warn-line">
                      <InfoIcon aria-hidden="true" className="mt-0.5 size-4 flex-none text-warn" />
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-warn">
                          {t("addDevice.installUnavailableTitle")}
                        </p>
                        <p className="mt-0.5 text-xs text-fg-2">
                          {t("addDevice.installUnavailableBody")}
                        </p>
                      </div>
                    </div>
                    <Field label={t("addDevice.runOnDevice")}>
                      <CodeRow
                        copied={copied === "command"}
                        disabled={!created}
                        onCopy={() => void copy(command, "command")}
                        value={command || t("addDevice.createFirst")}
                      />
                    </Field>
                  </div>
                ) : null}
              </div>
            )}

            {created ? (
              <div className="flex items-start gap-3 rounded-xl bg-warn-soft px-4 py-2.5 ring-1 ring-warn-line">
                <InfoIcon aria-hidden="true" className="mt-0.5 size-4 flex-none text-warn" />
                <p className="text-[13px] text-fg-2">{t("addDevice.tokenWarning")}</p>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <span className="mr-auto self-center text-xs text-fg-3">
            {usesLabel} · {expiryLabel}
          </span>
          {created ? (
            <Button onClick={close}>{t("common.done")}</Button>
          ) : (
            <Button
              disabled={
                createInvite.isPending ||
                usesInvalid ||
                expiryInvalid
              }
              onClick={() =>
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
              }
            >
              {createInvite.isPending ? t("common.loading") : t("addDevice.create")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ModeCard({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      aria-checked={active}
      className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-[10px] px-3.5 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
        active
          ? "bg-brand-soft ring-2 ring-brand"
          : "bg-card ring-1 ring-line-2 hover:bg-surface-2"
      }`}
      onClick={onClick}
      role="radio"
      type="button"
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 size-[18px] flex-none rounded-full ${
          active ? "bg-card ring-[5px] ring-brand" : "ring-[1.5px] ring-line-2"
        }`}
      />
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-fg-3">{hint}</span>
      </span>
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
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
  disabled,
}: {
  value: string
  onCopy: () => void
  copied: boolean
  disabled?: boolean
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
        disabled={disabled}
        onClick={onCopy}
        size="icon"
        type="button"
        variant="outline"
      >
        {copied ? <CheckIcon className="size-4 text-ok" /> : <CopyIcon className="size-4" />}
      </Button>
    </div>
  )
}

function Step({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-6 flex-none place-items-center rounded-full bg-surface-2 text-xs font-medium text-fg-2 ring-1 ring-line">
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

/** Whole hours between a datetime-local value and now; NaN when unparsable. */
function hoursFromLocal(value: string): number {
  const time = Date.parse(value)
  if (Number.isNaN(time)) return Number.NaN
  return Math.ceil((time - Date.now()) / 3_600_000)
}
