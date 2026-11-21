import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "wouter"
import {
  DownloadIcon,
  FileUpIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { exportNetworkConfig } from "@/api/generated/easyplane"
import type { GetNetwork200 } from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { CopyInline } from "@/components/shared/copy-inline"
import { PageContainer } from "@/components/layout/page-container"
import { Button } from "@/components/ui/button"
import { Chip, Dot } from "@/components/ui/chip"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { downloadTextFile } from "@/lib/download"

export type NetworkTab = "devices" | "map" | "access" | "settings"

const TABS: {
  id: NetworkTab
  labelKey: string
  path: (id: string) => string
}[] = [
  {
    id: "devices",
    labelKey: "network.tabs.devices",
    path: (id) => `/networks/${id}`,
  },
  {
    id: "map",
    labelKey: "network.tabs.map",
    path: (id) => `/networks/${id}/map`,
  },
  {
    id: "access",
    labelKey: "network.tabs.access",
    path: (id) => `/networks/${id}/access`,
  },
  {
    id: "settings",
    labelKey: "network.tabs.settings",
    path: (id) => `/networks/${id}/settings`,
  },
]

/**
 * The network header: name, copyable EasyTier name, CIDR, online count, one
 * primary action (Add device) and the four sections as tabs. The tabs are
 * links so every section has a URL and the back button works.
 */
export function NetworkHero({
  network,
  active,
  online,
  total,
  waiting,
  deviceCount,
  devicesLoading = false,
  onAddDevice,
}: {
  network: GetNetwork200
  active: NetworkTab
  online: number
  total: number
  waiting: number
  deviceCount: number
  /** While the device list loads, counts show a placeholder instead of 0. */
  devicesLoading?: boolean
  onAddDevice: () => void
}) {
  const { t } = useTranslation()
  const { canManage, isAdmin } = useAuth()
  const [, navigate] = useLocation()
  const [exporting, setExporting] = useState(false)

  const copy = (value: string, message: string) => {
    void navigator.clipboard
      .writeText(value)
      .then(() => toast.success(message))
      .catch(() => toast.error(t("common.copyFailed")))
  }

  const exportConfig = async () => {
    setExporting(true)
    try {
      const response = await exportNetworkConfig(network.id, { format: "toml" })
      downloadTextFile(
        `${network.networkName}.toml`,
        response.data.content,
        "application/toml;charset=utf-8"
      )
      toast.success(t("networks.actions.exported"))
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("networks.actions.exportFailed")
      )
    } finally {
      setExporting(false)
    }
  }

  const openDangerZone = () => {
    navigate(`/networks/${network.id}/settings?danger=1`)
    window.setTimeout(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })
    }, 150)
  }

  return (
    <section className="border-b border-line bg-card">
      <PageContainer className="pt-6 sm:pt-7">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 sm:flex-nowrap">
          <div className="min-w-0 flex-1">
            <h1
              className="truncate text-[22px] leading-7 font-semibold tracking-[-0.018em] sm:text-2xl sm:leading-8"
              id="page-title"
            >
              {network.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-fg-3">
              {network.networkName !== network.name ? (
                <CopyInline
                  label={t("network.copyName", { name: network.networkName })}
                  value={network.networkName}
                />
              ) : null}
              <span className="font-mono text-xs whitespace-nowrap">
                {network.ipv4Cidr}
              </span>
              {devicesLoading ? (
                <Skeleton className="h-4 w-24" />
              ) : (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <Dot online={online > 0} />
                  {t("networks.onlineOf", { online, total })}
                </span>
              )}
            </div>
          </div>

          <div className="flex w-full gap-2 sm:w-auto sm:flex-none">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label={t("network.actions")}
                    className="flex-none"
                    size="icon"
                    variant="outline"
                  />
                }
              >
                <MoreHorizontalIcon className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onClick={() =>
                    copy(network.networkName, t("network.nameCopied"))
                  }
                >
                  {t("network.copyNameAction")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    copy(network.ipv4Cidr, t("network.cidrCopied"))
                  }
                >
                  {t("network.copyCidr")}
                </DropdownMenuItem>
                {isAdmin ? (
                  <>
                    <MenuSeparator />
                    <DropdownMenuItem
                      disabled={exporting}
                      onClick={() => void exportConfig()}
                    >
                      <DownloadIcon />
                      {t("networks.actions.export")}
                    </DropdownMenuItem>
                    <DropdownMenuItem render={<Link href="/networks/import" />}>
                      <FileUpIcon />
                      {t("networks.actions.import")}
                    </DropdownMenuItem>
                    <MenuSeparator />
                    <DropdownMenuItem destructive onClick={openDangerZone}>
                      <Trash2Icon />
                      {t("networks.actions.delete")}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            {canManage ? (
              <Button
                className="flex-1 justify-center sm:flex-none"
                onClick={onAddDevice}
              >
                <PlusIcon className="size-4" />
                {t("network.addDevice")}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="relative">
          <nav
            aria-label={t("network.tabs.label")}
            className="mt-4 -mx-4 flex [scrollbar-width:none] gap-1 overflow-x-auto px-4 sm:mx-0 sm:mt-5 sm:px-0 [&::-webkit-scrollbar]:hidden"
          >
            {TABS.map((tab) => {
              const current = tab.id === active
              return (
                <Link
                  aria-current={current ? "page" : undefined}
                  className={`flex h-11 flex-none items-center gap-1.5 border-b-2 px-2 font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none sm:gap-2 sm:px-3 ${
                    current
                      ? "border-foreground text-foreground"
                      : "border-transparent text-fg-3 hover:text-foreground"
                  }`}
                  href={tab.path(network.id)}
                  key={tab.id}
                >
                  {t(tab.labelKey)}
                  {tab.id === "devices" ? (
                    devicesLoading ? (
                      <Skeleton className="h-5 w-6 rounded-[10px]" />
                    ) : waiting > 0 ? (
                      <Chip variant="warn">
                        {t("network.waiting", { count: waiting })}
                      </Chip>
                    ) : (
                      <span className="inline-grid h-5 min-w-5 place-items-center rounded-[10px] bg-surface-2 px-1.5 text-xs font-medium text-fg-2">
                        {deviceCount}
                      </span>
                    )
                  ) : null}
                </Link>
              )
            })}
          </nav>
          {/* A fade marks that the tab strip scrolls sideways on phones. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-card to-transparent sm:hidden"
          />
        </div>
      </PageContainer>
    </section>
  )
}

function MenuSeparator() {
  return <div aria-hidden="true" className="-mx-1.5 my-1.5 h-px bg-line" />
}
