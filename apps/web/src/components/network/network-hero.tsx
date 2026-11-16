import { useTranslation } from "react-i18next"
import { Link } from "wouter"
import { HistoryIcon, MoreHorizontalIcon, PlusIcon, SettingsIcon } from "lucide-react"
import { toast } from "sonner"

import type { GetNetwork200 } from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { CopyInline } from "@/components/shared/copy-inline"
import { PageContainer } from "@/components/layout/page-container"
import { Button } from "@/components/ui/button"
import { Chip, Dot } from "@/components/ui/chip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type NetworkTab = "devices" | "map" | "access" | "settings"

const TABS: { id: NetworkTab; labelKey: string; path: (id: string) => string }[] = [
  { id: "devices", labelKey: "network.tabs.devices", path: (id) => `/networks/${id}` },
  { id: "map", labelKey: "network.tabs.map", path: (id) => `/networks/${id}/map` },
  { id: "access", labelKey: "network.tabs.access", path: (id) => `/networks/${id}/access` },
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
  onAddDevice,
}: {
  network: GetNetwork200
  active: NetworkTab
  online: number
  total: number
  waiting: number
  deviceCount: number
  onAddDevice: () => void
}) {
  const { t } = useTranslation()
  const { canManage, isAdmin } = useAuth()

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
              <CopyInline
                label={t("network.copyName", { name: network.networkName })}
                value={network.networkName}
              />
              <span className="font-mono text-xs whitespace-nowrap">{network.ipv4Cidr}</span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <Dot online={online > 0} />
                {t("networks.onlineOf", { online, total })}
              </span>
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
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(network.networkName)
                      .then(() => toast.success(t("network.nameCopied")))
                      .catch(() => undefined)
                  }}
                >
                  {t("network.copyNameAction")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(network.ipv4Cidr)
                      .then(() => toast.success(t("network.cidrCopied")))
                      .catch(() => undefined)
                  }
                >
                  {t("network.copyCidr")}
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link href={`/networks/${network.id}`} />}>
                  {t("network.tabs.devices")}
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link href={`/networks/${network.id}/map`} />}>
                  {t("network.tabs.map")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  render={<Link href={`/networks/${network.id}/access`} />}
                >
                  {t("network.tabs.access")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  render={<Link href={`/networks/${network.id}/settings`} />}
                >
                  <SettingsIcon />
                  {t("network.tabs.settings")}
                </DropdownMenuItem>
                {isAdmin ? (
                  <DropdownMenuItem render={<Link href="/audit" />}>
                    <HistoryIcon />
                    {t("nav.items.audit")}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            {canManage ? (
              <Button className="flex-1 justify-center sm:flex-none" onClick={onAddDevice}>
                <PlusIcon className="size-4" />
                {t("network.addDevice")}
              </Button>
            ) : null}
          </div>
        </div>

        <nav
          aria-label={t("network.tabs.label")}
          className="-mx-4 mt-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:mt-5 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {TABS.map((tab) => {
            const current = tab.id === active
            return (
              <Link
                aria-current={current ? "page" : undefined}
                className={`flex h-11 flex-none items-center gap-2 border-b-2 px-3 font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
                  current
                    ? "border-foreground text-foreground"
                    : "border-transparent text-fg-3 hover:text-foreground"
                }`}
                href={tab.path(network.id)}
                key={tab.id}
              >
                {t(tab.labelKey)}
                {tab.id === "devices" ? (
                  waiting > 0 ? (
                    <Chip variant="warn">{t("network.waiting", { count: waiting })}</Chip>
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
      </PageContainer>
    </section>
  )
}
