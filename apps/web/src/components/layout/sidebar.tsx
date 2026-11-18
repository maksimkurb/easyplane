import { useEffect, useState } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  HistoryIcon,
  LogOutIcon,
  MenuIcon,
  MonitorSmartphoneIcon,
  NetworkIcon,
  UserCheckIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "wouter"

import { useListDevices, useListNetworks } from "@/api/generated/easyplane"
import { useAuth } from "@/auth/auth-context"
import { AccountMenu } from "@/components/layout/account-menu"
import { BrandMark } from "@/components/layout/brand-mark"
import { LanguageSelector } from "@/components/language-selector"
import { ThemeSelector } from "@/components/theme-selector"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { initials } from "@/lib/initials"
import { cn } from "@/lib/utils"

const COLLAPSE_KEY = "easyplane-sidebar-collapsed"

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1"
  } catch {
    return false
  }
}

function isActiveHref(location: string, href: string): boolean {
  if (href === "/networks") {
    return (
      location === "/" ||
      location === "/networks" ||
      location.startsWith("/networks/")
    )
  }
  return location === href || location.startsWith(`${href}/`)
}

/**
 * Desktop navigation. It answers the three questions the audit found hidden in
 * the avatar menu: which networks exist, which devices are waiting, and where
 * the account controls live. Networks are sub-items so a beginner can jump
 * straight into the only network without learning the URL structure.
 *
 * The bar collapses to icons (and remembers it) for people who want the extra
 * width for the map or the policy editor. Under `lg` the same list is rendered
 * inside the phone sheet by `MobileNavSheet`.
 */
export function Sidebar() {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(readCollapsed)

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0")
    } catch {
      // Private mode can refuse storage; the session still works without it.
    }
  }, [collapsed])

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen flex-none flex-col border-r border-line bg-sidebar text-sidebar-foreground lg:flex",
        collapsed ? "w-[76px]" : "w-64"
      )}
    >
      <div
        className={cn(
          "flex h-14 flex-none items-center border-b border-line",
          collapsed ? "justify-center gap-1 px-1.5" : "gap-2 px-3"
        )}
      >
        <Link
          aria-label={t("brand.logoAlt")}
          className="flex min-w-0 items-center gap-2.5 rounded-md text-[15px] font-semibold focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          href="/networks"
        >
          <BrandMark />
          {collapsed ? null : <span className="truncate">EasyPlane</span>}
        </Link>
        {collapsed ? null : <span className="flex-1" />}
        <button
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
          className="grid size-7 flex-none cursor-pointer place-items-center rounded-md text-fg-3 hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? t("nav.expand") : t("nav.collapse")}
          type="button"
        >
          {collapsed ? (
            <ChevronRightIcon className="size-4" />
          ) : (
            <ChevronLeftIcon className="size-4" />
          )}
        </button>
      </div>

      <nav
        aria-label={t("nav.sidebar")}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-3"
      >
        <SidebarNav collapsed={collapsed} />
      </nav>

      <div className="flex-none border-t border-line p-2">
        <AccountMenu collapsed={collapsed} variant="sidebar" />
      </div>
    </aside>
  )
}

/** The phone entry point: a button plus a left sheet with the same list. */
export function MobileNavSheet() {
  const { t } = useTranslation()
  const { me, logout } = useAuth()
  const [open, setOpen] = useState(false)

  const user = me?.user
  const label = user?.displayName || user?.email || ""

  return (
    <>
      <button
        aria-expanded={open}
        aria-label={t("nav.openMenu")}
        className="grid size-10 flex-none cursor-pointer place-items-center rounded-lg text-fg-2 hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => setOpen(true)}
        type="button"
      >
        <MenuIcon className="size-5" />
      </button>

      <Sheet onOpenChange={setOpen} open={open}>
        <SheetContent
          className="w-[86vw] max-w-[320px] gap-0 p-0"
          showCloseButton={false}
          side="left"
        >
          <SheetHeader className="flex-row items-center gap-2 border-b border-line p-3">
            <SheetTitle className="sr-only">{t("nav.menuTitle")}</SheetTitle>
            <SheetDescription className="sr-only">
              {t("nav.menuDescription")}
            </SheetDescription>
            <Link
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              href="/networks"
              onClick={() => setOpen(false)}
            >
              <BrandMark />
              <span className="truncate text-[15px] font-semibold">
                EasyPlane
              </span>
            </Link>
            <SheetClose
              render={
                <Button
                  aria-label={t("common.close")}
                  size="icon-sm"
                  variant="ghost"
                />
              }
            >
              <XIcon />
            </SheetClose>
          </SheetHeader>

          <nav
            aria-label={t("nav.sidebar")}
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-3"
          >
            <SidebarNav onNavigate={() => setOpen(false)} />
          </nav>

          <SheetFooter className="gap-3 border-t border-line p-3">
            {user ? (
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid size-8 flex-none place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand-text">
                  {initials(user.displayName, user.email)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">
                    {label || t("account.menuLabel")}
                  </p>
                  {user.email !== label ? (
                    <p className="truncate text-[11px] text-fg-3">
                      {user.email}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
            <LanguageSelector />
            <ThemeSelector />
            <Button
              className="w-full justify-start"
              onClick={() => void logout()}
              variant="ghost"
            >
              <LogOutIcon aria-hidden="true" />
              {t("auth.signOut")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}

function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean
  onNavigate?: () => void
}) {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const [location] = useLocation()
  const networksQuery = useListNetworks()
  const pendingQuery = useListDevices({ state: "pending" })
  const networks = networksQuery.data?.data ?? []
  const pendingCount = pendingQuery.data?.data.length ?? 0

  const activeNetworkId =
    location.match(/^\/networks\/(?!import(?:\/|$))([^/]+)/)?.[1] ?? null

  return (
    <div className="flex flex-col gap-1">
      <NavItem
        active={isActiveHref(location, "/networks")}
        collapsed={collapsed}
        href="/networks"
        icon={NetworkIcon}
        label={t("nav.items.networks")}
        onNavigate={onNavigate}
      />
      {collapsed || networks.length === 0 ? null : (
        <ul
          aria-label={t("nav.networkList")}
          className="mt-0.5 mb-1.5 ml-4 flex min-w-0 flex-col gap-0.5 border-l border-line pl-2.5"
        >
          {networks.map((network) => {
            const active = network.id === activeNetworkId
            return (
              <li key={network.id} className="min-w-0">
                <Link
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-8 min-w-0 items-center rounded-md px-2 text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                    active
                      ? "bg-surface-2 font-medium text-foreground"
                      : "text-fg-2 hover:bg-surface-2 hover:text-foreground"
                  )}
                  href={`/networks/${network.id}`}
                  onClick={onNavigate}
                  title={network.name}
                >
                  <span className="truncate">{network.name}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <NavItem
        active={isActiveHref(location, "/devices")}
        collapsed={collapsed}
        href="/devices"
        icon={MonitorSmartphoneIcon}
        label={t("nav.items.devices")}
        onNavigate={onNavigate}
      />
      <NavItem
        active={isActiveHref(location, "/pending")}
        badge={pendingCount}
        badgeLabel={t("nav.pendingCount", { count: pendingCount })}
        collapsed={collapsed}
        href="/pending"
        icon={UserCheckIcon}
        label={t("nav.items.pending")}
        onNavigate={onNavigate}
      />
      {isAdmin ? (
        <NavItem
          active={isActiveHref(location, "/audit")}
          collapsed={collapsed}
          href="/audit"
          icon={HistoryIcon}
          label={t("nav.items.audit")}
          onNavigate={onNavigate}
        />
      ) : null}
    </div>
  )
}

function NavItem({
  href,
  icon: Icon,
  label,
  active,
  collapsed = false,
  badge,
  badgeLabel,
  onNavigate,
}: {
  href: string
  icon: LucideIcon
  label: string
  active: boolean
  collapsed?: boolean
  badge?: number
  badgeLabel?: string
  onNavigate?: () => void
}) {
  const showBadge = !collapsed && badge !== undefined && badge > 0
  return (
    <Link
      aria-current={active ? "page" : undefined}
      aria-label={
        !collapsed && showBadge ? `${label}, ${badgeLabel}` : undefined
      }
      className={cn(
        "flex min-h-9 min-w-0 items-center rounded-lg text-[13.5px] transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
        collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
        active
          ? "bg-surface-2 font-medium text-foreground"
          : "text-fg-2 hover:bg-surface-2 hover:text-foreground"
      )}
      href={href}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
    >
      <Icon aria-hidden="true" className="size-4 flex-none" />
      {collapsed ? (
        <span className="sr-only">{label}</span>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {showBadge ? (
            <Chip className="h-5 px-1.5" variant="warn">
              {badge}
            </Chip>
          ) : null}
        </>
      )}
    </Link>
  )
}
