import { ChevronLeftIcon, HistoryIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "wouter"

import { useAuth } from "@/auth/auth-context"
import { useBreadcrumbs } from "@/lib/use-breadcrumbs"
import { AccountMenu } from "@/components/layout/account-menu"
import { PageContainer } from "@/components/layout/page-container"

export function TopBar() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const [location] = useLocation()
  const { crumbs, back } = useBreadcrumbs()
  const current = crumbs[crumbs.length - 1]
  const isHome = crumbs.length === 1 && !crumbs[0]?.href

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-card">
      <PageContainer className="flex h-14 items-center gap-1 sm:gap-3">
        <Link
          aria-label={t("brand.logoAlt")}
          className="hidden h-10 items-center gap-2.5 pr-1 text-[15px] font-semibold sm:flex"
          href="/networks"
        >
          <LogoMark />
          <span className="whitespace-nowrap">EasyPlane</span>
        </Link>

        {!isHome ? (
          <Link
            aria-label={t("nav.back")}
            className="grid size-10 flex-none place-items-center rounded-lg text-fg-2 hover:bg-surface-2 hover:text-foreground sm:hidden"
            href={back}
          >
            <ChevronLeftIcon className="size-5" />
          </Link>
        ) : null}

        <nav
          aria-label={t("nav.breadcrumb")}
          className="hidden min-w-0 items-center gap-1 text-sm sm:flex"
        >
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1
            return (
              <span className="flex min-w-0 items-center gap-1" key={`${crumb.label}-${index}`}>
                {index > 0 ? (
                  <span aria-hidden="true" className="px-1 text-lg text-line-2">
                    /
                  </span>
                ) : null}
                {crumb.href && !last ? (
                  <Link
                    className="flex h-10 min-w-0 items-center rounded-md px-1.5 text-fg-2 hover:bg-surface-2 hover:text-foreground"
                    href={crumb.href}
                  >
                    <span className="truncate">{crumb.label}</span>
                  </Link>
                ) : (
                  <span
                    aria-current={last ? "page" : undefined}
                    className="truncate px-1.5 font-medium"
                  >
                    {crumb.label}
                  </span>
                )}
              </span>
            )
          })}
        </nav>

        {/* Phones show the current page instead of the trail. */}
        <span className="min-w-0 flex-1 truncate px-1 text-base font-semibold sm:hidden">
          {current?.label}
        </span>

        <span className="hidden flex-1 sm:block" />

        {isAdmin && location !== "/audit" ? (
          <Link
            className="hidden h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-fg-2 hover:bg-surface-2 hover:text-foreground sm:flex"
            href="/audit"
          >
            <HistoryIcon className="size-4" />
            {t("nav.items.audit")}
          </Link>
        ) : null}
        <AccountMenu />
      </PageContainer>
    </header>
  )
}

function LogoMark() {
  return (
    <span className="block size-8 flex-none text-[#135f94] dark:text-[#7fb6e6]">
      <svg aria-hidden="true" className="size-full" fill="none" viewBox="0 0 512 512">
        <path
          d="M308,120 H182 Q136,120 136,166 V346 Q136,392 182,392 H308 M136,256 H348"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="50"
        />
        <circle cx="336" cy="120" fill="currentColor" r="50" />
        <circle cx="376" cy="256" fill="currentColor" r="50" />
        <circle cx="336" cy="392" fill="currentColor" r="50" />
      </svg>
    </span>
  )
}

