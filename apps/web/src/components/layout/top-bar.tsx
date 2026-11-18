import { ChevronLeftIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "wouter"

import { AccountMenu } from "@/components/layout/account-menu"
import { BrandMark } from "@/components/layout/brand-mark"
import { MobileNavSheet } from "@/components/layout/sidebar"
import { PageContainer } from "@/components/layout/page-container"
import { useBreadcrumbs } from "@/lib/use-breadcrumbs"

/**
 * The phone/tablet bar. Desktop navigation lives in the persistent sidebar,
 * so this bar only carries what a small screen needs: a way to open the same
 * destinations, a back button, the current page and the account menu.
 */
export function TopBar() {
  const { t } = useTranslation()
  const [location] = useLocation()
  const { crumbs, back } = useBreadcrumbs()
  const current = crumbs[crumbs.length - 1]
  const isHome = location === "/" || location === "/networks"

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-card lg:hidden">
      <PageContainer className="flex h-14 items-center gap-1 sm:gap-2">
        <MobileNavSheet />

        {!isHome ? (
          <Link
            aria-label={t("nav.back")}
            className="grid size-10 flex-none place-items-center rounded-lg text-fg-2 hover:bg-surface-2 hover:text-foreground"
            href={back}
          >
            <ChevronLeftIcon className="size-5" />
          </Link>
        ) : null}

        {isHome ? (
          <Link
            aria-label={t("brand.logoAlt")}
            className="flex min-w-0 items-center gap-2.5 px-0.5 text-[15px] font-semibold"
            href="/networks"
          >
            <BrandMark />
            <span className="whitespace-nowrap">EasyPlane</span>
          </Link>
        ) : (
          <span className="min-w-0 flex-1 truncate px-1 text-base font-semibold">
            {current?.label ?? t("brand.logoAlt")}
          </span>
        )}

        <span className="hidden flex-1 sm:block" />

        <AccountMenu />
      </PageContainer>
    </header>
  )
}
