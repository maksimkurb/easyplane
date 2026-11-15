"use client"

import type { ComponentProps } from "react"
import {
  LogOutIcon,
  MonitorSmartphoneIcon,
  NetworkIcon,
  ScrollTextIcon,
  UserCheckIcon,
  WaypointsIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { useAuth } from "@/auth/auth-context"
import { AppBrandHeader } from "@/components/layout/app-brand-header"
import { LanguageSelector } from "@/components/language-selector"
import { LiveStatus } from "@/components/live-status"
import { NavMain } from "@/components/nav-main"
import { ThemeSelector } from "@/components/theme-selector"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { useSidebar } from "@/components/ui/sidebar-context"

export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
  const { isMobile, toggleSidebar } = useSidebar()
  const { t } = useTranslation()
  const auth = useAuth()

  const items = [
    {
      title: t("nav.items.networks"),
      url: "/networks",
      icon: NetworkIcon,
    },
    {
      title: t("nav.items.devices"),
      url: "/devices",
      icon: MonitorSmartphoneIcon,
    },
    {
      title: t("nav.items.topology"),
      url: "/topology",
      icon: WaypointsIcon,
    },
    {
      title: t("nav.items.pending"),
      url: "/pending",
      icon: UserCheckIcon,
    },
    ...(auth.isAdmin
      ? [
          {
            title: t("nav.items.audit"),
            url: "/audit",
            icon: ScrollTextIcon,
          },
        ]
      : []),
  ]

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader className={isMobile ? "border-b px-4 py-2" : "border-b"}>
        {isMobile ? (
          <AppBrandHeader onMenuClick={toggleSidebar} />
        ) : (
          <AppBrandHeader />
        )}
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={[{ title: t("nav.groups.manage"), url: "#", items }]} />
      </SidebarContent>
      <SidebarFooter className={isMobile ? "border-t px-4 py-3" : "border-t"}>
        <div className="space-y-3">
          {auth.me ? (
            <div className="px-1">
              <p className="truncate text-sm font-medium" title={auth.me.user.email}>
                {auth.me.user.displayName || auth.me.user.email}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(`roles.${auth.me.user.role}`)}
              </p>
            </div>
          ) : null}
          <LiveStatus />
          <LanguageSelector />
          <ThemeSelector />
          <Button
            className="w-full justify-start"
            onClick={() => void auth.logout()}
            variant="ghost"
          >
            <LogOutIcon /> {t("auth.signOut")}
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
