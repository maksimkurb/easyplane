import {
  CheckIcon,
  FileUpIcon,
  LanguagesIcon,
  LogOutIcon,
  MonitorIcon,
  MonitorSmartphoneIcon,
  MoonIcon,
  SunIcon,
  UserCheckIcon,
  WaypointsIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { useLocation } from "wouter"

import { useAuth } from "@/auth/auth-context"
import { LiveStatus } from "@/components/live-status"
import { useLanguage } from "@/components/language-provider"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Language } from "@/i18n"
import { initials } from "@/lib/initials"

const LANGUAGES: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ru", label: "Русский" },
]

const THEMES = [
  { value: "light", labelKey: "common.themeLight", icon: SunIcon },
  { value: "dark", labelKey: "common.themeDark", icon: MoonIcon },
  { value: "system", labelKey: "common.themeSystem", icon: MonitorIcon },
] as const

/**
 * Account menu: who is signed in, the destinations that are not part of one
 * network (all devices, topology, pending approvals), language, theme and sign
 * out. The redesign keeps all of this behind one avatar in the top bar.
 */
export function AccountMenu() {
  const { t } = useTranslation()
  const { me, logout, isAdmin } = useAuth()
  const { language, setLanguage } = useLanguage()
  const { theme, setTheme } = useTheme()
  const [, navigate] = useLocation()

  const user = me?.user
  const label = user?.displayName || user?.email || ""

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            aria-label={t("account.menuLabel")}
            className="grid size-10 flex-none cursor-pointer place-items-center rounded-full focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            type="button"
          />
        }
      >
        {user ? (
          <span className="grid size-8 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand-text">
            {initials(user.displayName, user.email)}
          </span>
        ) : (
          <span className="grid size-8 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-fg-2">
            ?
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        {user ? (
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold">{label}</p>
            {user.email !== label ? (
              <p className="truncate text-xs text-fg-3">{user.email}</p>
            ) : null}
            <p className="mt-0.5 text-xs text-fg-3">{t(`roles.${user.role}`)}</p>
          </div>
        ) : null}

        <MenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/devices")}>
          <MonitorSmartphoneIcon />
          {t("nav.items.devices")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/topology")}>
          <WaypointsIcon />
          {t("nav.items.topology")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/pending")}>
          <UserCheckIcon />
          {t("nav.items.pending")}
        </DropdownMenuItem>
        {isAdmin ? (
          <DropdownMenuItem onClick={() => navigate("/networks/import")}>
            <FileUpIcon />
            {t("nav.items.importNetwork")}
          </DropdownMenuItem>
        ) : null}

        <MenuSeparator />
        <p className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium tracking-wide text-fg-3 uppercase">
          <LanguagesIcon className="size-3.5" />
          {t("common.language")}
        </p>
        {LANGUAGES.map((entry) => (
          <DropdownMenuItem
            closeOnClick={false}
            key={entry.value}
            onClick={() => setLanguage(entry.value)}
          >
            <span className="flex-1">{entry.label}</span>
            {language === entry.value ? <CheckIcon className="text-brand-text" /> : null}
          </DropdownMenuItem>
        ))}

        <MenuSeparator />
        <p className="px-3 py-1 text-[11px] font-medium tracking-wide text-fg-3 uppercase">
          {t("common.theme")}
        </p>
        {THEMES.map((entry) => {
          const Icon = entry.icon
          return (
            <DropdownMenuItem
              closeOnClick={false}
              key={entry.value}
              onClick={() => setTheme(entry.value)}
            >
              <Icon />
              <span className="flex-1">{t(entry.labelKey)}</span>
              {theme === entry.value ? <CheckIcon className="text-brand-text" /> : null}
            </DropdownMenuItem>
          )
        })}

        <MenuSeparator />
        <div className="px-3 py-1.5">
          <LiveStatus />
        </div>
        <Button
          className="mt-1 w-full justify-start text-fg-2"
          onClick={() => void logout()}
          size="sm"
          variant="ghost"
        >
          <LogOutIcon />
          {t("auth.signOut")}
        </Button>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MenuSeparator() {
  return <div aria-hidden="true" className="my-1.5 -mx-1.5 h-px bg-line" />
}
